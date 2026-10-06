-- Configuracion persistente para URLs y otros parametros UI

CREATE TABLE IF NOT EXISTS app_setting (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  description TEXT,
  category    TEXT NOT NULL DEFAULT 'general',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_setting_category ON app_setting(category);

INSERT INTO app_setting (key, value, description, category)
VALUES
  (
    'sismico_url',
    'http://devtm.denial.cl:15173/legacy-sismico',
    'Visor externo del dashboard sismico legado.',
    'external_sources'
  ),
  (
    'control_vial_url',
    'http://devtm.denial.cl:19091/',
    'Panel externo del control vial operacional.',
    'external_sources'
  )
ON CONFLICT (key) DO NOTHING;
