import 'dotenv/config';
import { Client, GatewayIntentBits, Events, EmbedBuilder, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { createClient } from '@supabase/supabase-js';
import cron from 'node-cron';

// ─── Clientes ────────────────────────────────────────────────────────────────
const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ─── Estado en memoria (sesiones activas) ────────────────────────────────────
// { userId: { channelId, joinedAt } }
const activeSessions = new Map();

// Canales a ignorar (ej: AFK)
const IGNORED_CHANNELS = process.env.IGNORED_CHANNELS
  ? process.env.IGNORED_CHANNELS.split(',').map(id => id.trim())
  : [];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Guarda o actualiza el perfil del usuario en Supabase */
async function upsertUser(userId, username, displayName, avatarUrl) {
  await supabase.from('users').upsert(
    { id: userId, username, display_name: displayName, avatar_url: avatarUrl, updated_at: new Date().toISOString() },
    { onConflict: 'id' }
  );
}

/** Registra una sesión de voz finalizada */
async function saveVoiceSession(userId, channelId, channelName, joinedAt, leftAt) {
  const duration = Math.floor((leftAt - joinedAt) / 1000); // segundos
  if (duration < 10) return; // ignorar sesiones menores a 10 segundos

  await supabase.from('voice_sessions').insert({
    user_id: userId,
    channel_id: channelId,
    channel_name: channelName,
    joined_at: new Date(joinedAt).toISOString(),
    left_at: new Date(leftAt).toISOString(),
    duration_seconds: duration,
  });

  console.log(`[SESIÓN] ${userId} estuvo ${duration}s en ${channelName}`);
}

/** Obtiene el ranking del período especificado */
async function getRanking(period = 'month') {
  const now = new Date();
  let startDate;

  if (period === 'week') {
    startDate = new Date(now);
    startDate.setDate(now.getDate() - 7);
  } else {
    // mes actual
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  const { data, error } = await supabase
    .from('voice_sessions')
    .select(`
      user_id,
      duration_seconds,
      users (display_name, username, avatar_url)
    `)
    .gte('joined_at', startDate.toISOString());

  if (error) {
    console.error('Error obteniendo ranking:', error);
    return [];
  }

  // Agrupar por usuario y sumar segundos
  const totals = {};
  for (const session of data) {
    if (!totals[session.user_id]) {
      totals[session.user_id] = {
        user_id: session.user_id,
        display_name: session.users?.display_name || session.users?.username || 'Usuario',
        username: session.users?.username || '',
        avatar_url: session.users?.avatar_url || '',
        total_seconds: 0,
      };
    }
    totals[session.user_id].total_seconds += session.duration_seconds;
  }

  return Object.values(totals)
    .sort((a, b) => b.total_seconds - a.total_seconds)
    .slice(0, 10); // top 10
}

/** Formatea segundos en horas y minutos */
function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Construye el embed del ranking */
async function buildRankingEmbed(guild, period = 'month') {
  const ranking = await getRanking(period);
  const periodLabel = period === 'week' ? 'esta semana' : 'este mes';

  const medals = ['🥇', '🥈', '🥉'];
  const description = ranking.length === 0
    ? 'Nadie se conectó todavía 👻'
    : ranking.map((entry, i) => {
        const medal = medals[i] || `**${i + 1}.**`;
        const bar = '█'.repeat(Math.min(10, Math.floor((entry.total_seconds / ranking[0].total_seconds) * 10)));
        return `${medal} **${entry.display_name}** — ${formatDuration(entry.total_seconds)}\n${bar ? `\`${bar}\`` : ''}`;
      }).join('\n\n');

  return new EmbedBuilder()
    .setTitle(`🎙️ Ranking de voz ${periodLabel}`)
    .setDescription(description)
    .setColor(0x5865F2)
    .setTimestamp()
    .setFooter({ text: `Servidor: ${guild.name}` });
}

// ─── Registrar slash commands ─────────────────────────────────────────────────
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('ranking')
      .setDescription('Muestra el ranking de horas en voz')
      .addStringOption(opt =>
        opt.setName('periodo')
          .setDescription('Período a consultar')
          .addChoices(
            { name: '📅 Este mes', value: 'month' },
            { name: '📆 Esta semana', value: 'week' }
          )
      ),
    new SlashCommandBuilder()
      .setName('misporas')
      .setDescription('Ve tus propias horas de voz')
      .addStringOption(opt =>
        opt.setName('periodo')
          .setDescription('Período a consultar')
          .addChoices(
            { name: '📅 Este mes', value: 'month' },
            { name: '📆 Esta semana', value: 'week' }
          )
      ),
  ].map(cmd => cmd.toJSON());

  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(discord.user.id, process.env.GUILD_ID),
    { body: commands }
  );
  console.log('[BOT] Slash commands registrados ✓');
}

// ─── Eventos Discord ───────────────────────────────────────────────────────────

discord.once(Events.ClientReady, async (client) => {
  console.log(`[BOT] Conectado como ${client.user.tag} ✓`);
  await registerCommands();

  // ── Cron: postear ranking automático el último día del mes a las 23:00 ──
  if (process.env.RANKING_CHANNEL_ID) {
    cron.schedule('0 23 28-31 * *', async () => {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 1);
      // Solo si mañana es el día 1 (o sea, hoy es el último del mes)
      if (tomorrow.getDate() !== 1) return;

      const guild = client.guilds.cache.get(process.env.GUILD_ID);
      if (!guild) return;

      const channel = guild.channels.cache.get(process.env.RANKING_CHANNEL_ID);
      if (!channel) return;

      const embed = await buildRankingEmbed(guild, 'month');
      embed.setTitle('🏆 ¡Ranking final del mes!');
      await channel.send({ embeds: [embed] });
      console.log('[CRON] Ranking mensual posteado ✓');
    }, { timezone: 'America/Argentina/Buenos_Aires' });
  }
});

discord.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const userId = newState.id || oldState.id;
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return; // ignorar bots

  const joinedChannel = newState.channelId;
  const leftChannel = oldState.channelId;

  // Guardar/actualizar perfil del usuario
  if (member.user) {
    await upsertUser(
      userId,
      member.user.username,
      member.displayName || member.user.username,
      member.user.displayAvatarURL({ size: 128, extension: 'png' })
    );
  }

  // 1️⃣ Usuario se unió a un canal de voz
  if (joinedChannel && !IGNORED_CHANNELS.includes(joinedChannel)) {
    activeSessions.set(userId, {
      channelId: joinedChannel,
      channelName: newState.channel?.name || 'Desconocido',
      joinedAt: Date.now(),
    });
    console.log(`[ENTRADA] ${member.displayName} entró a ${newState.channel?.name}`);
  }

  // 2️⃣ Usuario salió de un canal de voz
  if (leftChannel && activeSessions.has(userId)) {
    const session = activeSessions.get(userId);
    activeSessions.delete(userId);

    // Si era un canal ignorado, no guardamos
    if (IGNORED_CHANNELS.includes(leftChannel)) return;

    await saveVoiceSession(
      userId,
      session.channelId,
      session.channelName,
      session.joinedAt,
      Date.now()
    );
  }

  // 3️⃣ Usuario cambió de canal (salió de uno, entró a otro)
  if (joinedChannel && leftChannel && joinedChannel !== leftChannel) {
    // Ya se registró la entrada al nuevo canal arriba
    // La sesión del canal anterior ya se cerró también arriba
  }
});

discord.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const period = interaction.options.getString('periodo') || 'month';

  if (interaction.commandName === 'ranking') {
    await interaction.deferReply();
    const embed = await buildRankingEmbed(interaction.guild, period);
    await interaction.editReply({ embeds: [embed] });
  }

  if (interaction.commandName === 'misporas') {
    await interaction.deferReply({ ephemeral: true });
    const userId = interaction.user.id;
    const now = new Date();
    let startDate;

    if (period === 'week') {
      startDate = new Date(now);
      startDate.setDate(now.getDate() - 7);
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const { data } = await supabase
      .from('voice_sessions')
      .select('duration_seconds')
      .eq('user_id', userId)
      .gte('joined_at', startDate.toISOString());

    const total = (data || []).reduce((sum, s) => sum + s.duration_seconds, 0);
    const periodLabel = period === 'week' ? 'esta semana' : 'este mes';

    const embed = new EmbedBuilder()
      .setTitle(`🎙️ Tus horas ${periodLabel}`)
      .setDescription(`Estuviste conectado **${formatDuration(total)}** en voz ${periodLabel}.`)
      .setColor(0x57F287)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
});

// ─── Iniciar bot ──────────────────────────────────────────────────────────────
discord.login(process.env.DISCORD_TOKEN);
