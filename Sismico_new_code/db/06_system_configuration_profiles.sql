CREATE TABLE IF NOT EXISTS system_config (
    id BIGSERIAL PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    value_text TEXT NULL,
    scope VARCHAR(40) NOT NULL DEFAULT 'global',
    site_code VARCHAR(80) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feature_flag (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(120) NOT NULL UNIQUE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    description TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plc_device (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(180) NOT NULL,
    ip_address VARCHAR(64) NOT NULL,
    plc_type VARCHAR(40) NOT NULL DEFAULT 'delta',
    red_tag VARCHAR(40) NOT NULL DEFAULT 'M2',
    green_tag VARCHAR(40) NOT NULL DEFAULT 'M1',
    allow_control BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS traffic_command_log (
    id BIGSERIAL PRIMARY KEY,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    device_code VARCHAR(100) NOT NULL,
    requested_action VARCHAR(20) NOT NULL,
    executed_command TEXT NULL,
    execution_status VARCHAR(40) NOT NULL DEFAULT 'pending',
    stdout_text TEXT NULL,
    stderr_text TEXT NULL
);

INSERT INTO feature_flag (code, enabled, description)
VALUES
  ('external_sources', TRUE, 'Lectura de fuentes remotas'),
  ('semaforo_control', TRUE, 'Control de semáforos vía backend'),
  ('agent_ia', TRUE, 'Agente IA con Ollama')
ON CONFLICT (code) DO UPDATE SET enabled = EXCLUDED.enabled, description = EXCLUDED.description;

INSERT INTO system_config (key, value_text, scope)
VALUES
  ('deployment.profile', 'local', 'global'),
  ('semaforo.automation.enabled', 'false', 'global')
ON CONFLICT (key) DO UPDATE SET value_text = EXCLUDED.value_text, updated_at = NOW();

INSERT INTO plc_device (code, name, ip_address, plc_type, red_tag, green_tag, allow_control)
VALUES ('vial_01', 'Semáforo vial 01', '192.168.1.10', 'delta', 'M2', 'M1', FALSE)
ON CONFLICT (code) DO UPDATE SET ip_address = EXCLUDED.ip_address, allow_control = EXCLUDED.allow_control;
