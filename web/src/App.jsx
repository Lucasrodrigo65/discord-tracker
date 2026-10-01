import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import './App.css';

const SERVER_NAME = import.meta.env.VITE_SERVER_NAME || 'Mi Servidor';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDuration(seconds) {
  const s = Number(seconds);
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

// ─── Componente tarjeta de usuario ───────────────────────────────────────────
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
        <span className="sessions-label">{entry.session_count} sesiones</span>
      </div>
    </div>
  );
}

// ─── App principal ────────────────────────────────────────────────────────────
export default function App() {
  const [period, setPeriod] = useState('month');
  const [ranking, setRanking] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);

  const fetchRanking = useCallback(async () => {
    setLoading(true);
    setError(null);

    const view = period === 'week' ? 'ranking_week' : 'ranking_month';
    const { data, error: err } = await supabase
      .from(view)
      .select('*')
      .order('total_seconds', { ascending: false })
      .limit(15);

    if (err) {
      setError('Error al cargar el ranking. ¿Está configurado Supabase?');
      console.error(err);
    } else {
      setRanking(data || []);
    }

    setLastUpdated(new Date());
    setLoading(false);
  }, [period]);

  useEffect(() => {
    fetchRanking();
    // Refresh cada 2 minutos
    const interval = setInterval(fetchRanking, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchRanking]);

  const maxSeconds = ranking[0]?.total_seconds ?? 0;

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <div className="logo">🎙️</div>
          <div>
            <h1 className="title">{SERVER_NAME}</h1>
            <p className="subtitle">Ranking de horas en voz</p>
          </div>
        </div>
      </header>

      {/* Controles */}
      <div className="controls">
        <div className="period-selector">
          <button
            className={`period-btn ${period === 'month' ? 'active' : ''}`}
            onClick={() => setPeriod('month')}
          >
            📅 {getPeriodLabel('month')}
          </button>
          <button
            className={`period-btn ${period === 'week' ? 'active' : ''}`}
            onClick={() => setPeriod('week')}
          >
            📆 Esta semana
          </button>
        </div>

        <button className="refresh-btn" onClick={fetchRanking} disabled={loading}>
          {loading ? '⏳' : '🔄'} Actualizar
        </button>
      </div>

      {/* Contenido */}
      <main className="main">
        {error && (
          <div className="error-card">
            <span>⚠️ {error}</span>
          </div>
        )}

        {loading && !error && (
          <div className="loading">
            <div className="spinner" />
            <p>Cargando ranking...</p>
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
            {/* Podio top 3 */}
            {ranking.length >= 3 && (
              <div className="podium">
                {[ranking[1], ranking[0], ranking[2]].map((entry, i) => {
                  const realIndex = [1, 0, 2][i];
                  return (
                    <div key={entry.user_id} className={`podium-item podium-${realIndex + 1}`}>
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

            {/* Lista completa */}
            <div className="ranking-list">
              {ranking.map((entry, index) => (
                <UserCard
                  key={entry.user_id}
                  entry={entry}
                  index={index}
                  maxSeconds={maxSeconds}
                />
              ))}
            </div>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="footer">
        {lastUpdated && (
          <p>Actualizado: {lastUpdated.toLocaleTimeString('es-AR')}</p>
        )}
        <p>Refresh automático cada 2 minutos</p>
      </footer>
    </div>
  );
}
