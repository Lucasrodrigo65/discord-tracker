-- ============================================================
-- Discord Voice Tracker - Schema para Supabase
-- Ejecutá esto en el SQL Editor de tu proyecto Supabase
-- ============================================================

-- Tabla de usuarios
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,              -- Discord user ID
  username TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de sesiones de voz
CREATE TABLE IF NOT EXISTS voice_sessions (
  id BIGSERIAL PRIMARY KEY,
  guild_id TEXT,                    -- Discord server ID
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  channel_name TEXT,
  joined_at TIMESTAMPTZ NOT NULL,
  left_at TIMESTAMPTZ NOT NULL,
  duration_seconds INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para consultas rápidas
CREATE INDEX IF NOT EXISTS idx_voice_sessions_user_id ON voice_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_joined_at ON voice_sessions(joined_at);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_user_joined ON voice_sessions(user_id, joined_at);

-- ============================================================
-- Vista: ranking mensual actual (útil para la web)
-- ============================================================
CREATE OR REPLACE VIEW ranking_month AS
SELECT
  u.id AS user_id,
  u.display_name,
  u.username,
  u.avatar_url,
  SUM(vs.duration_seconds) AS total_seconds,
  COUNT(vs.id) AS session_count,
  DATE_TRUNC('month', NOW()) AS period_start
FROM voice_sessions vs
JOIN users u ON u.id = vs.user_id
WHERE vs.joined_at >= DATE_TRUNC('month', NOW())
GROUP BY u.id, u.display_name, u.username, u.avatar_url
ORDER BY total_seconds DESC;

-- ============================================================
-- Vista: ranking semanal actual
-- ============================================================
CREATE OR REPLACE VIEW ranking_week AS
SELECT
  u.id AS user_id,
  u.display_name,
  u.username,
  u.avatar_url,
  SUM(vs.duration_seconds) AS total_seconds,
  COUNT(vs.id) AS session_count,
  DATE_TRUNC('week', NOW()) AS period_start
FROM voice_sessions vs
JOIN users u ON u.id = vs.user_id
WHERE vs.joined_at >= NOW() - INTERVAL '7 days'
GROUP BY u.id, u.display_name, u.username, u.avatar_url
ORDER BY total_seconds DESC;

-- ============================================================
-- Habilitar acceso de lectura anónimo (para la web pública)
-- ============================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_sessions ENABLE ROW LEVEL SECURITY;

-- Política: lectura pública de usuarios
CREATE POLICY "Public read users"
  ON users FOR SELECT
  USING (true);

-- Política: lectura pública de sesiones
CREATE POLICY "Public read sessions"
  ON voice_sessions FOR SELECT
  USING (true);

-- Política: solo el service role puede insertar/actualizar
CREATE POLICY "Service role can write users"
  ON users FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role can write sessions"
  ON voice_sessions FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================
-- Función RPC: Obtener los compañeros con más horas compartidas
-- ============================================================
CREATE OR REPLACE FUNCTION get_user_shared_time(target_user_id TEXT, period_type TEXT DEFAULT 'month')
RETURNS TABLE (
  partner_id TEXT,
  display_name TEXT,
  username TEXT,
  avatar_url TEXT,
  shared_seconds BIGINT
) AS $$
DECLARE
  period_start_ts TIMESTAMPTZ;
BEGIN
  IF period_type = 'week' THEN
    period_start_ts := NOW() - INTERVAL '7 days';
  ELSE
    period_start_ts := DATE_TRUNC('month', NOW());
  END IF;

  RETURN QUERY
  SELECT
    u.id AS partner_id,
    COALESCE(u.display_name, u.username, 'Usuario')::TEXT AS display_name,
    COALESCE(u.username, '')::TEXT AS username,
    COALESCE(u.avatar_url, '')::TEXT AS avatar_url,
    SUM(
      EXTRACT(EPOCH FROM (LEAST(a.left_at, b.left_at) - GREATEST(a.joined_at, b.joined_at)))::BIGINT
    ) AS shared_seconds
  FROM voice_sessions a
  JOIN voice_sessions b
    ON a.channel_id = b.channel_id
   AND a.user_id <> b.user_id
   AND a.joined_at < b.left_at
   AND a.left_at > b.joined_at
  JOIN users u ON u.id = b.user_id
  WHERE a.user_id = target_user_id
    AND a.left_at >= period_start_ts
    AND b.left_at >= period_start_ts
  GROUP BY u.id, u.display_name, u.username, u.avatar_url
  HAVING SUM(EXTRACT(EPOCH FROM (LEAST(a.left_at, b.left_at) - GREATEST(a.joined_at, b.joined_at)))::BIGINT) > 0
  ORDER BY shared_seconds DESC
  LIMIT 5;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Otorgar permiso de ejecución al rol público/anónimo
GRANT EXECUTE ON FUNCTION get_user_shared_time(TEXT, TEXT) TO anon, authenticated, service_role;
