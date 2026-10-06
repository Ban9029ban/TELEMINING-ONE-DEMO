CREATE TABLE IF NOT EXISTS sismico_sync_run (
  id BIGSERIAL PRIMARY KEY,
  site_id BIGINT NOT NULL REFERENCES site(id),
  remote_endpoint_id BIGINT NULL REFERENCES remote_endpoint(id),
  trigger_type VARCHAR(20) NOT NULL DEFAULT 'manual',
  status VARCHAR(20) NOT NULL DEFAULT 'running',
  source_status VARCHAR(20) NOT NULL DEFAULT 'unknown',
  records_found INTEGER NULL,
  records_mapped INTEGER NULL,
  alerts_generated INTEGER NOT NULL DEFAULT 0,
  raw_payload_excerpt TEXT NULL,
  error_message TEXT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS object_current_state (
  id BIGSERIAL PRIMARY KEY,
  map_object_id BIGINT NOT NULL UNIQUE REFERENCES map_object(id),
  site_id BIGINT NOT NULL REFERENCES site(id),
  state_code VARCHAR(20) NOT NULL DEFAULT 'unknown',
  raw_value VARCHAR(120) NULL,
  source_name VARCHAR(120) NULL,
  source_status VARCHAR(20) NOT NULL DEFAULT 'unknown',
  observed_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS object_state_event (
  id BIGSERIAL PRIMARY KEY,
  map_object_id BIGINT NOT NULL REFERENCES map_object(id),
  site_id BIGINT NOT NULL REFERENCES site(id),
  sync_run_id BIGINT NULL REFERENCES sismico_sync_run(id),
  state_code VARCHAR(20) NOT NULL,
  raw_value VARCHAR(120) NULL,
  source_name VARCHAR(120) NULL,
  observed_at TIMESTAMPTZ NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS semaforo_device (
  id BIGSERIAL PRIMARY KEY,
  site_id BIGINT NOT NULL REFERENCES site(id),
  code VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  ip VARCHAR(80) NOT NULL,
  plc_type VARCHAR(50) NOT NULL DEFAULT 'delta',
  profile VARCHAR(50) NOT NULL DEFAULT 'delta',
  port INTEGER NOT NULL DEFAULT 502,
  unit_id INTEGER NOT NULL DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  tags_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS semaforo_rule (
  id BIGSERIAL PRIMARY KEY,
  site_id BIGINT NOT NULL REFERENCES site(id),
  code VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(180) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  action_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  trigger_source VARCHAR(80) NOT NULL DEFAULT 'remote_state',
  target_state_code VARCHAR(20) NOT NULL DEFAULT 'critical',
  min_consecutive_polls INTEGER NOT NULL DEFAULT 1,
  dwell_seconds INTEGER NOT NULL DEFAULT 60,
  command_on_trigger VARCHAR(20) NOT NULL DEFAULT 'rojo',
  command_on_recover VARCHAR(20) NOT NULL DEFAULT 'verde',
  allow_touch_traffic BOOLEAN NOT NULL DEFAULT FALSE,
  site_scope_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS semaforo_action_log (
  id BIGSERIAL PRIMARY KEY,
  site_id BIGINT NOT NULL REFERENCES site(id),
  sync_run_id BIGINT NULL REFERENCES sismico_sync_run(id),
  semaforo_rule_id BIGINT NULL REFERENCES semaforo_rule(id),
  semaforo_device_id BIGINT NULL REFERENCES semaforo_device(id),
  action VARCHAR(20) NOT NULL,
  requested_by VARCHAR(80) NOT NULL DEFAULT 'system',
  execution_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  command_line TEXT NULL,
  stdout TEXT NULL,
  stderr TEXT NULL,
  executed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO site (id, organization_id, code, name, timezone, is_active)
SELECT COALESCE((SELECT MAX(id) FROM site), 0) + 1, 1, 'pilar_norte', 'Pilar Norte', 'America/Santiago', TRUE
WHERE NOT EXISTS (SELECT 1 FROM site WHERE code = 'pilar_norte');

INSERT INTO site_map (id, site_id, code, name, image_url, is_active)
SELECT COALESCE((SELECT MAX(sm.id) FROM site_map sm), 0) + 1, s.id, 'pilar_norte_main', 'Pilar Norte principal', '/assets/legacy/pilar_norte_placeholder.png', TRUE
FROM site s
WHERE s.code = 'pilar_norte'
  AND NOT EXISTS (SELECT 1 FROM site_map WHERE code = 'pilar_norte_main');

INSERT INTO semaforo_device (site_id, code, name, ip, plc_type, profile, port, unit_id, enabled, tags_json)
SELECT s.id, 'diamante_vial_01', 'Diamante Vial 01', '192.168.1.10', 'delta', 'delta', 502, 1, FALSE,
       '{"verde_tag":"M1","rojo_tag":"M2"}'::jsonb
FROM site s
WHERE s.code = 'diamante'
AND NOT EXISTS (SELECT 1 FROM semaforo_device WHERE code = 'diamante_vial_01');

INSERT INTO semaforo_rule (site_id, code, name, enabled, action_enabled, trigger_source, target_state_code, min_consecutive_polls, dwell_seconds, command_on_trigger, command_on_recover, allow_touch_traffic, site_scope_json)
SELECT s.id, 'diamante_critical_all_red', 'Diamante crítico -> todos rojo', TRUE, FALSE, 'remote_state', 'critical', 1, 60, 'rojo', 'verde', FALSE,
       '{"site_code":"diamante","scope":"all"}'::jsonb
FROM site s
WHERE s.code = 'diamante'
AND NOT EXISTS (SELECT 1 FROM semaforo_rule WHERE code = 'diamante_critical_all_red');
