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
async function saveVoiceSession(guildId, userId, channelId, channelName, joinedAt, leftAt, displayName = null) {
  const duration = Math.floor((leftAt - joinedAt) / 1000); // segundos
  if (duration < 10) return; // ignorar sesiones menores a 10 segundos

  const { error } = await supabase.from('voice_sessions').insert({
    guild_id: guildId,
    user_id: userId,
    channel_id: channelId,
    channel_name: channelName,
    joined_at: new Date(joinedAt).toISOString(),
    left_at: new Date(leftAt).toISOString(),
    duration_seconds: duration,
  });

  if (error) {
    console.error(`[ERROR] No se pudo guardar la sesión de ${displayName || userId}:`, error.message);
    return;
  }

  console.log(`[SESIÓN] ${displayName || userId} estuvo ${duration}s en ${channelName}`);
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

  // Recuperar usuarios que ya estén conectados al iniciar el bot
  for (const guild of client.guilds.cache.values()) {
    for (const [memberId, voiceState] of guild.voiceStates.cache) {
      if (
        voiceState.channelId &&
        !voiceState.member?.user.bot &&
        !IGNORED_CHANNELS.includes(voiceState.channelId)
      ) {
        activeSessions.set(memberId, {
          guildId: guild.id,
          channelId: voiceState.channelId,
          channelName: voiceState.channel?.name || 'Desconocido',
          joinedAt: Date.now(),
        });
        console.log(`[INICIALIZADO] ${voiceState.member?.displayName || memberId} ya estaba en ${voiceState.channel?.name}`);
      }
    }
  }

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
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return; // ignorar bots

  const userId = member.id;
  const oldChannelId = oldState.channelId;
  const newChannelId = newState.channelId;

  // Si no hubo cambio de canal (ej: mutearse, ensordecerse, prender cámara, transmitir pantalla),
  // no hacemos nada para evitar reiniciar o perder la sesión de voz
  if (oldChannelId === newChannelId) {
    return;
  }

  // Guardar/actualizar perfil del usuario
  if (member.user) {
    upsertUser(
      userId,
      member.user.username,
      member.displayName || member.user.username,
      member.user.displayAvatarURL({ size: 128, extension: 'png' })
    ).catch(err => console.error('[ERROR] Actualizando usuario:', err));
  }

  const isOldTracked = oldChannelId && !IGNORED_CHANNELS.includes(oldChannelId);
  const isNewTracked = newChannelId && !IGNORED_CHANNELS.includes(newChannelId);

  // 1️⃣ Si el usuario salió de un canal trackeado (o se movió a otro canal / AFK)
  if (isOldTracked && activeSessions.has(userId)) {
    const session = activeSessions.get(userId);
    activeSessions.delete(userId);
    await saveVoiceSession(
      session.guildId || member.guild.id,
      userId,
      session.channelId,
      session.channelName,
      session.joinedAt,
      Date.now(),
      member.displayName
    );
  }

  // 2️⃣ Si el usuario entró a un canal trackeado (desde desconectado o desde otro canal)
  if (isNewTracked) {
    // Si ya tenía una sesión activa por alguna razón, la cerramos primero
    if (activeSessions.has(userId)) {
      const session = activeSessions.get(userId);
      activeSessions.delete(userId);
      await saveVoiceSession(
        session.guildId || member.guild.id,
        userId,
        session.channelId,
        session.channelName,
        session.joinedAt,
        Date.now(),
        member.displayName
      );
    }

    activeSessions.set(userId, {
      guildId: member.guild.id,
      channelId: newChannelId,
      channelName: newState.channel?.name || 'Desconocido',
      joinedAt: Date.now(),
    });
    console.log(`[ENTRADA] ${member.displayName} entró a ${newState.channel?.name}`);
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

// ─── Apagado limpio (guardar sesiones activas en deploy / reinicio) ─────────
async function handleShutdown() {
  console.log('[BOT] Guardando sesiones activas antes de apagar...');
  const now = Date.now();
  const promises = [];
  for (const [userId, session] of activeSessions.entries()) {
    promises.push(
      saveVoiceSession(session.guildId || process.env.GUILD_ID, userId, session.channelId, session.channelName, session.joinedAt, now)
    );
  }
  await Promise.allSettled(promises);
  process.exit(0);
}

process.on('SIGTERM', handleShutdown);
process.on('SIGINT', handleShutdown);

// ─── Iniciar bot ──────────────────────────────────────────────────────────────
discord.login(process.env.DISCORD_TOKEN);
