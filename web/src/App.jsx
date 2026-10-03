import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from './supabaseClient';
import './App.css';

const SERVER_NAME = import.meta.env.VITE_SERVER_NAME || 'Mi Servidor';
const DISCORD_GUILD_ID = import.meta.env.VITE_DISCORD_GUILD_ID || '387644868744445952';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDuration(seconds) {
  const s = Number(seconds) || 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function getMedalEmoji(index) {
  return ['🥇', '🥈', '🥉'][index] ?? `#${index + 1}`;
}

function getBarWidth(seconds, maxSeconds) {
  if (!maxSeconds) return 0;
  return Math.max(4, Math.round((seconds / maxSeconds) * 100));
}

function getPeriodLabel(period) {
  if (period === 'week') return 'Esta semana';
  const now = new Date();
  return now.toLocaleString('es-AR', { month: 'long', year: 'numeric' });
}

// ─── Componente Tarjeta de Usuario ───────────────────────────────────────────
function UserCard({ entry, index, maxSeconds }) {
  const bar = getBarWidth(entry.total_seconds, maxSeconds);
  const isFirst = index === 0;

  return (
    <div className={`user-card ${isFirst ? 'first-place' : ''}`}>
      <div className="rank-badge">{getMedalEmoji(index)}</div>

      <img
        className="avatar"
        src={entry.avatar_url || `https://cdn.discordapp.com/embed/avatars/${index % 6}.png`}
        alt={entry.display_name}
        onError={e => { e.target.src = `https://cdn.discordapp.com/embed/avatars/${index % 6}.png`; }}
      />

      <div className="user-info">
        <span className="display-name">{entry.display_name || entry.username}</span>
        <span className="username">@{entry.username}</span>
        <div className="progress-bar-container">
          <div className="progress-bar" style={{ width: `${bar}%` }} />
        </div>
      </div>

      <div className="time-badge">
        <span className="time-value">{formatDuration(entry.total_seconds)}</span>
        <span className="sessions-label">{entry.session_count} {entry.session_count === 1 ? 'sesión' : 'sesiones'}</span>
      </div>
    </div>
  );
}

// ─── App Principal ────────────────────────────────────────────────────────────
export default function App() {
  const [period, setPeriod] = useState('month');
  const [ranking, setRanking] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);

  // Estados de presencia en vivo desde Discord
  const [discordOnline, setDiscordOnline] = useState(null);
  const [discordInVoice, setDiscordInVoice] = useState(null);

  // Consultar miembros en línea en tiempo real mediante Discord Guild Widget
  useEffect(() => {
    if (!DISCORD_GUILD_ID) return;

    let isMounted = true;
    async function fetchDiscordPresence() {
      try {
        const res = await fetch(`https://discord.com/api/guilds/${DISCORD_GUILD_ID}/widget.json?_t=${Date.now()}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!isMounted) return;

        if (typeof data.presence_count === 'number') {
          setDiscordOnline(data.presence_count);
        }
        if (Array.isArray(data.members)) {
          const inVoice = data.members.filter(m => Boolean(m.channel_id)).length;
          setDiscordInVoice(inVoice);
        }
      } catch (err) {
        console.warn('Error obteniendo widget de Discord:', err);
      }
    }

    fetchDiscordPresence();
    const timer = setInterval(fetchDiscordPresence, 45 * 1000); // Actualiza cada 45s
    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, []);

  const fetchRanking = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setError(null);

    const view = period === 'week' ? 'ranking_week' : 'ranking_month';
    const { data, error: err } = await supabase
      .from(view)
      .select('*')
      .order('total_seconds', { ascending: false })
      .limit(100);

    if (err) {
      setError('Error al cargar el ranking. ¿Está configurado Supabase?');
      console.error(err);
    } else {
      setRanking(data || []);
    }

    setLastUpdated(new Date());
    if (!isSilent) setLoading(false);
  }, [period]);

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      const view = period === 'week' ? 'ranking_week' : 'ranking_month';
      const { data, error: err } = await supabase
        .from(view)
        .select('*')
        .order('total_seconds', { ascending: false })
        .limit(100);

      if (!isMounted) return;

      if (err) {
        setError('Error al cargar el ranking. ¿Está configurado Supabase?');
        console.error(err);
      } else {
        setRanking(data || []);
        setError(null);
      }
      setLastUpdated(new Date());
      setLoading(false);
    }

    loadData();

    // Auto-refresh del ranking cada 2 minutos
    const interval = setInterval(() => {
      fetchRanking(true);
    }, 2 * 60 * 1000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [period, fetchRanking]);

  // Filtrado por buscador
  const filteredRanking = useMemo(() => {
    if (!search.trim()) return ranking;
    const q = search.toLowerCase();
    return ranking.filter(entry =>
      (entry.display_name && entry.display_name.toLowerCase().includes(q)) ||
      (entry.username && entry.username.toLowerCase().includes(q))
    );
  }, [ranking, search]);

  // Estadísticas globales del servidor
  const stats = useMemo(() => {
    const totalSecs = ranking.reduce((acc, curr) => acc + (Number(curr.total_seconds) || 0), 0);
    return {
      totalHours: Math.round(totalSecs / 3600),
    };
  }, [ranking]);

  const maxSeconds = ranking[0]?.total_seconds ?? 0;
  const isSearching = Boolean(search.trim());
  const showPodium = !isSearching && ranking.length >= 3;

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <div className="logo">🎙️</div>
          <div>
            <h1 className="title">{SERVER_NAME}</h1>
            <p className="subtitle">Ranking de tiempo en canales de voz</p>
          </div>
        </div>

        {/* Resumen de actividad en tiempo real */}
        <div className="stats-badges">
          {discordOnline !== null ? (
            <div className="stat-pill online-pill" title="Miembros conectados a Discord en este momento">
              <span className="online-dot" />
              <span className="stat-pill-label">En línea:</span>
              <span className="stat-pill-val">{discordOnline}</span>
            </div>
          ) : (
            <div className="stat-pill" title="Miembros con tiempo acumulado en el ranking">
              <span className="stat-pill-label">En ranking:</span>
              <span className="stat-pill-val">{ranking.length}</span>
            </div>
          )}

          {discordInVoice !== null && discordInVoice > 0 && (
            <div className="stat-pill voice-pill" title="Miembros en canales de voz ahora mismo">
              <span className="stat-pill-icon">🔊</span>
              <span className="stat-pill-label">En voz ahora:</span>
              <span className="stat-pill-val">{discordInVoice}</span>
            </div>
          )}

          {ranking.length > 0 && (
            <div className="stat-pill">
              <span className="stat-pill-label">Total en voz:</span>
              <span className="stat-pill-val">~{stats.totalHours}h</span>
            </div>
          )}
        </div>
      </header>

      {/* Controles de período y actualización */}
      <div className="controls">
        <div className="period-selector">
          <button
            className={`period-btn ${period === 'month' ? 'active' : ''}`}
            onClick={() => { setLoading(true); setPeriod('month'); }}
          >
            📅 {getPeriodLabel('month')}
          </button>
          <button
            className={`period-btn ${period === 'week' ? 'active' : ''}`}
            onClick={() => { setLoading(true); setPeriod('week'); }}
          >
            📆 Esta semana
          </button>
        </div>

        <div className="right-controls">
          <div className="search-box">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              placeholder="Buscar miembro..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="search-input"
            />
            {search && (
              <button className="clear-search" onClick={() => setSearch('')}>✕</button>
            )}
          </div>

          <button className="refresh-btn" onClick={() => fetchRanking(false)} disabled={loading}>
            {loading ? '⏳' : '🔄'}
          </button>
        </div>
      </div>

      {/* Contenido Principal */}
      <main className="main">
        {error && (
          <div className="error-card">
            <span>⚠️ {error}</span>
          </div>
        )}

        {loading && !error && (
          <div className="loading">
            <div className="spinner" />
            <p>Cargando ranking de voz...</p>
          </div>
        )}

        {!loading && !error && ranking.length === 0 && (
          <div className="empty-state">
            <span className="empty-icon">👻</span>
            <p>Nadie se conectó todavía {period === 'week' ? 'esta semana' : 'este mes'}</p>
          </div>
        )}

        {!loading && !error && ranking.length > 0 && (
          <>
            {/* Podio Top 3 exclusivo cuando no se está buscando */}
            {showPodium && (
              <div className="podium">
                {[ranking[1], ranking[0], ranking[2]].map((entry, i) => {
                  const realIndex = [1, 0, 2][i];
                  return (
                    <div key={entry.user_id} className={`podium-item podium-${realIndex + 1}`}>
                      <div className="podium-badge">{getMedalEmoji(realIndex)}</div>
                      <img
                        className="podium-avatar"
                        src={entry.avatar_url || `https://cdn.discordapp.com/embed/avatars/${realIndex % 6}.png`}
                        alt={entry.display_name}
                        onError={e => { e.target.src = `https://cdn.discordapp.com/embed/avatars/${realIndex % 6}.png`; }}
                      />
                      <div className="podium-name">{entry.display_name || entry.username}</div>
                      <div className="podium-time">{formatDuration(entry.total_seconds)}</div>
                      <div className="podium-block" />
                    </div>
                  );
                })}
              </div>
            )}

            {/* Lista: Si hay podio, muestra puestos a partir del 4°. Si se busca o hay < 3, muestra la lista completa sin duplicar */}
            <div className="ranking-list">
              {showPodium && ranking.length > 3 && (
                <div className="list-section-header">
                  <span>Posiciones siguientes</span>
                </div>
              )}

              {isSearching && filteredRanking.length === 0 && (
                <div className="no-search-results">
                  No se encontraron miembros con "{search}"
                </div>
              )}

              {(showPodium ? ranking.slice(3) : filteredRanking).map((entry, idx) => {
                // Calcular el puesto real en la tabla
                const originalIndex = showPodium ? idx + 3 : ranking.findIndex(r => r.user_id === entry.user_id);
                return (
                  <UserCard
                    key={entry.user_id}
                    entry={entry}
                    index={originalIndex >= 0 ? originalIndex : idx}
                    maxSeconds={maxSeconds}
                  />
                );
              })}
            </div>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="footer">
        {lastUpdated && (
          <p>Última actualización: {lastUpdated.toLocaleTimeString('es-AR')}</p>
        )}
        <p>Sincronización periódica automática • Trackea con Discord Voice Tracker</p>
      </footer>
    </div>
  );
}
