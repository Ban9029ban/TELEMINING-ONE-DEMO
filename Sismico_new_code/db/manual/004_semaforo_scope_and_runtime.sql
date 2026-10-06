CREATE TABLE IF NOT EXISTS system_config (
  id BIGSERIAL PRIMARY KEY,
  key VARCHAR(120) NOT NULL UNIQUE,
  value_text TEXT NULL,
  scope VARCHAR(40) NOT NULL DEFAULT 'global',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_config (key, value_text, scope)
VALUES
  ('traffic_lights_enabled', 'true', 'global'),
  ('semaforo_automation_enabled', 'false', 'global'),
  ('automatic_activation_seconds', '30', 'global'),
  ('global_emergency_scope', 'global', 'global')
ON CONFLICT (key) DO NOTHING;
