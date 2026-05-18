-- ============================================
-- CLIOS -- Schema de Supabase
-- Ejecutar en el SQL Editor de Supabase
-- ============================================

-- 1. Estado del usuario (sync principal)
-- Almacena cada "key" del sistema como una fila
-- Ej: key='tasks', value='[{...},{...}]'
CREATE TABLE IF NOT EXISTS user_state (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  value        TEXT NOT NULL DEFAULT '{}',
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, key)
);

-- Indice para busquedas rapidas por usuario
CREATE INDEX IF NOT EXISTS idx_user_state_user_id ON user_state(user_id);
CREATE INDEX IF NOT EXISTS idx_user_state_key     ON user_state(user_id, key);

-- 2. Suscripciones push (para notificaciones)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL,
  subscription JSONB NOT NULL,
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_user_id ON push_subscriptions(user_id);

-- 3. Historial de conversaciones (copiloto)
CREATE TABLE IF NOT EXISTS conversations (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT NOT NULL,
  saved_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conv_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conv_saved_at ON conversations(user_id, saved_at DESC);

-- 4. Historial de metricas diarias (para graficas)
CREATE TABLE IF NOT EXISTS daily_metrics (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date          DATE NOT NULL DEFAULT CURRENT_DATE,
  energy        INT CHECK (energy BETWEEN 0 AND 100),
  focus         INT CHECK (focus  BETWEEN 0 AND 100),
  stress        INT CHECK (stress BETWEEN 0 AND 100),
  motivation    INT CHECK (motivation BETWEEN 0 AND 100),
  tasks_done    INT DEFAULT 0,
  flourish_avg  NUMERIC(4,1),
  mode          TEXT DEFAULT 'normal',
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_metrics_user_date ON daily_metrics(user_id, date DESC);

-- ============================================
-- ROW LEVEL SECURITY -- cada usuario ve solo sus datos
-- ============================================

ALTER TABLE user_state        ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_metrics     ENABLE ROW LEVEL SECURITY;

-- Policies: solo puedes ver/modificar TUS filas
CREATE POLICY "Users own state" ON user_state
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users own subscriptions" ON push_subscriptions
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users own conversations" ON conversations
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users own metrics" ON daily_metrics
  FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- FUNCION: snapshot diario de metricas
-- Ejecutar con un cron job o pg_cron
-- ============================================
CREATE OR REPLACE FUNCTION snapshot_daily_metrics()
RETURNS void AS $$
BEGIN
  INSERT INTO daily_metrics (user_id, date, mode)
  SELECT DISTINCT user_id, CURRENT_DATE, 'normal'
  FROM user_state
  WHERE key = 'mode'
  ON CONFLICT (user_id, date) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- VERIFICACION: ver tablas creadas
-- ============================================
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
