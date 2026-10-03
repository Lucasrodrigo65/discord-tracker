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

// ─── Componente Panel de Dúos (Horas Compartidas) ───────────────────────────
function SharedTimePanel({ entry, period, onClose }) {
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    async function fetchPartners() {
      setLoading(true);
      const { data, error } = await supabase.rpc('get_user_shared_time', {
        target_user_id: entry.user_id,
        period_type: period,
      });

      if (isMounted) {
        if (!error && data) {
          setPartners(data);
        } else {
          console.error('Error fetching shared time:', error);
          setPartners([]);
        }
        setLoading(false);
      }
    }

    fetchPartners();
    return () => { isMounted = false; };
  }, [entry.user_id, period]);

  return (
    <div className="shared-time-panel">
      <div className="shared-time-header">
        <div>
          <h4 className="shared-title">👥 Dúos de voz de {entry.display_name || entry.username}</h4>
          <span className="shared-subtitle">Miembros con los que más tiempo coincidió en llamadas ({period === 'week' ? 'esta semana' : 'este mes'})</span>
        </div>
        {onClose && (
          <button className="close-shared-btn" onClick={onClose} title="Cerrar detalles">✕</button>
        )}
      </div>

      {loading ? (
        <div className="shared-loading">
          <div className="spinner-small" />
          <span>Calculando coincidencia de tiempo...</span>
        </div>
      ) : partners.length === 0 ? (
        <div className="shared-empty">
          <span>👻 No coincidió en canales de voz con otros miembros en este período.</span>
        </div>
      ) : (
        <div className="partners-list">
          {partners.map((partner, pIdx) => {
            const pct = Math.min(100, Math.round((partner.shared_seconds / entry.total_seconds) * 100));
            return (
              <div key={partner.partner_id} className="partner-card">
                <span className="partner-rank">#{pIdx + 1}</span>
                <img
                  className="partner-avatar"
                  src={partner.avatar_url || `https://cdn.discordapp.com/embed/avatars/${pIdx % 6}.png`}
                  alt={partner.display_name}
                  onError={e => { e.target.src = `https://cdn.discordapp.com/embed/avatars/${pIdx % 6}.png`; }}
                />
                <div className="partner-info">
                  <div className="partner-name-row">
                    <span className="partner-name">{partner.display_name}</span>
                    <span className="partner-username">@{partner.username}</span>
                  </div>
                  <div className="partner-bar-bg">
                    <div className="partner-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <div className="partner-time">
                  <span className="partner-time-val">{formatDuration(partner.shared_seconds)}</span>
                  <span className="partner-pct">{pct}% de coincidencia</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Componente Tarjeta de Usuario ───────────────────────────────────────────
function UserCard({ entry, index, maxSeconds, isExpanded, onToggleExpand, period }) {
  const bar = getBarWidth(entry.total_seconds, maxSeconds);
  const isFirst = index === 0;

  return (
    <div className={`user-card-wrapper ${isExpanded ? 'is-expanded' : ''}`}>
      <div
        className={`user-card ${isFirst ? 'first-place' : ''} ${isExpanded ? 'active-card' : ''}`}
        onClick={onToggleExpand}
        title="Haz clic para desplegar compañeros de voz"
      >
        <div className="rank-badge">{getMedalEmoji(index)}</div>

        <img
          className="avatar"
          src={entry.avatar_url || `https://cdn.discordapp.com/embed/avatars/${index % 6}.png`}
          alt={entry.display_name}
          onError={e => { e.target.src = `https://cdn.discordapp.com/embed/avatars/${index % 6}.png`; }}
        />

        <div className="user-info">
          <div className="name-row">
            <span className="display-name">{entry.display_name || entry.username}</span>
            <span className="expand-pill">{isExpanded ? '▲ Dúos' : '▼ Ver dúos'}</span>
          </div>
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

      {isExpanded && (
        <SharedTimePanel entry={entry} period={period} onClose={onToggleExpand} />
      )}
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

  // ID del usuario expandido para ver horas compartidas
  const [expandedUserId, setExpandedUserId] = useState(null);

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
    const timer = setInterval(fetchDiscordPresence, 45 * 1000);
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

    const interval = setInterval(() => {
      fetchRanking(true);
    }, 2 * 60 * 1000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [period, fetchRanking]);

  const filteredRanking = useMemo(() => {
    if (!search.trim()) return ranking;
    const q = search.toLowerCase();
    return ranking.filter(entry =>
      (entry.display_name && entry.display_name.toLowerCase().includes(q)) ||
      (entry.username && entry.username.toLowerCase().includes(q))
    );
  }, [ranking, search]);

  const stats = useMemo(() => {
    const totalSecs = ranking.reduce((acc, curr) => acc + (Number(curr.total_seconds) || 0), 0);
    return {
      totalHours: Math.round(totalSecs / 3600),
    };
  }, [ranking]);

  const maxSeconds = ranking[0]?.total_seconds ?? 0;
  const isSearching = Boolean(search.trim());
  const showPodium = !isSearching && ranking.length >= 3;

  // Usuario del podio actualmente expandido
  const expandedPodiumUser = useMemo(() => {
    if (!showPodium || !expandedUserId) return null;
    return ranking.slice(0, 3).find(r => r.user_id === expandedUserId) || null;
  }, [showPodium, expandedUserId, ranking]);

  const toggleExpand = (userId) => {
    setExpandedUserId(prev => (prev === userId ? null : userId));
  };

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

      {/* Controles */}
      <div className="controls">
        <div className="period-selector">
          <button
            className={`period-btn ${period === 'month' ? 'active' : ''}`}
            onClick={() => { setLoading(true); setPeriod('month'); setExpandedUserId(null); }}
          >
            📅 {getPeriodLabel('month')}
          </button>
          <button
            className={`period-btn ${period === 'week' ? 'active' : ''}`}
            onClick={() => { setLoading(true); setPeriod('week'); setExpandedUserId(null); }}
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
            {/* Podio Top 3 */}
            {showPodium && (
              <div className="podium-section">
                <div className="podium">
                  {[ranking[1], ranking[0], ranking[2]].map((entry, i) => {
                    const realIndex = [1, 0, 2][i];
                    const isSelected = expandedUserId === entry.user_id;
                    return (
                      <div
                        key={entry.user_id}
                        className={`podium-item podium-${realIndex + 1} ${isSelected ? 'selected' : ''}`}
                        onClick={() => toggleExpand(entry.user_id)}
                        title="Haz clic para ver compañeros de voz"
                      >
                        <div className="podium-badge">{getMedalEmoji(realIndex)}</div>
                        <img
                          className="podium-avatar"
                          src={entry.avatar_url || `https://cdn.discordapp.com/embed/avatars/${realIndex % 6}.png`}
                          alt={entry.display_name}
                          onError={e => { e.target.src = `https://cdn.discordapp.com/embed/avatars/${realIndex % 6}.png`; }}
                        />
                        <div className="podium-name">{entry.display_name || entry.username}</div>
                        <div className="podium-time">{formatDuration(entry.total_seconds)}</div>
                        <span className="podium-click-hint">{isSelected ? '▲ Ocultar dúos' : '▼ Ver dúos'}</span>
                        <div className="podium-block" />
                      </div>
                    );
                  })}
                </div>

                {/* Panel de horas compartidas si se selecciona un usuario del podio */}
                {expandedPodiumUser && (
                  <div className="podium-shared-container">
                    <SharedTimePanel
                      entry={expandedPodiumUser}
                      period={period}
                      onClose={() => setExpandedUserId(null)}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Lista de Ranking */}
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
                const originalIndex = showPodium ? idx + 3 : ranking.findIndex(r => r.user_id === entry.user_id);
                return (
                  <UserCard
                    key={entry.user_id}
                    entry={entry}
                    index={originalIndex >= 0 ? originalIndex : idx}
                    maxSeconds={maxSeconds}
                    isExpanded={expandedUserId === entry.user_id}
                    onToggleExpand={() => toggleExpand(entry.user_id)}
                    period={period}
                  />
                );
              })}
            </div>
          </>
        )}
      </main>

      <footer className="footer">
        {lastUpdated && (
          <p>Última actualización: {lastUpdated.toLocaleTimeString('es-AR')}</p>
        )}
        <p>Sincronización periódica automática • Trackea con Discord Voice Tracker</p>
      </footer>
    </div>
  );
}
