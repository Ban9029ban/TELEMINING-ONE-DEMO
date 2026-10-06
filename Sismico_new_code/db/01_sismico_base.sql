CREATE TABLE IF NOT EXISTS organization (
  id BIGINT PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(150) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS site (
  id BIGINT PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organization(id),
  code VARCHAR(50) NOT NULL,
  name VARCHAR(150) NOT NULL,
  timezone VARCHAR(80) DEFAULT 'America/Santiago',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS site_map (
  id BIGINT PRIMARY KEY,
  site_id BIGINT NOT NULL REFERENCES site(id),
  code VARCHAR(80) NOT NULL,
  name VARCHAR(150) NOT NULL,
  image_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS map_object (
  id BIGINT PRIMARY KEY,
  site_map_id BIGINT NOT NULL REFERENCES site_map(id),
  code VARCHAR(100) NOT NULL,
  name VARCHAR(180) NOT NULL,
  object_type VARCHAR(40) NOT NULL DEFAULT 'polygon',
  geometry_type VARCHAR(20) NOT NULL DEFAULT 'polygon',
  geometry_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  state_code VARCHAR(40) NOT NULL DEFAULT 'normal',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS screen (
  id BIGINT PRIMARY KEY,
  site_id BIGINT NOT NULL REFERENCES site(id),
  site_map_id BIGINT REFERENCES site_map(id),
  code VARCHAR(80) NOT NULL,
  name VARCHAR(150) NOT NULL,
  status_code VARCHAR(30) NOT NULL DEFAULT 'offline',
  expected_url TEXT,
  role_code VARCHAR(30) NOT NULL DEFAULT 'wall',
  last_heartbeat_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS screen_heartbeat (
  id BIGINT PRIMARY KEY,
  screen_id BIGINT NOT NULL REFERENCES screen(id),
  browser_session_id VARCHAR(120),
  current_url TEXT,
  status_code VARCHAR(30) NOT NULL DEFAULT 'online',
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_event (
  id BIGINT PRIMARY KEY,
  site_id BIGINT NOT NULL REFERENCES site(id),
  source_object_id BIGINT REFERENCES map_object(id),
  title VARCHAR(200) NOT NULL,
  message TEXT,
  severity VARCHAR(20) NOT NULL DEFAULT 'medium',
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  opened_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS remote_source (
  id BIGINT PRIMARY KEY,
  site_id BIGINT REFERENCES site(id),
  code VARCHAR(80) UNIQUE NOT NULL,
  name VARCHAR(150) NOT NULL,
  source_type VARCHAR(50) NOT NULL DEFAULT 'api_rest',
  base_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS remote_endpoint (
  id BIGINT PRIMARY KEY,
  remote_source_id BIGINT NOT NULL REFERENCES remote_source(id),
  site_id BIGINT REFERENCES site(id),
  code VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(180) NOT NULL,
  endpoint_url TEXT NOT NULL,
  endpoint_kind VARCHAR(50) NOT NULL DEFAULT 'json_api',
  polling_seconds INTEGER NOT NULL DEFAULT 15,
  parser_type VARCHAR(50) NOT NULL DEFAULT 'mock',
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS polling_run (
  id BIGINT PRIMARY KEY,
  remote_endpoint_id BIGINT NOT NULL REFERENCES remote_endpoint(id),
  status VARCHAR(20) NOT NULL DEFAULT 'success',
  trigger_type VARCHAR(20) NOT NULL DEFAULT 'manual',
  records_found INTEGER,
  records_mapped INTEGER,
  error_message TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_user (
  id BIGINT PRIMARY KEY,
  username VARCHAR(80) UNIQUE NOT NULL,
  full_name VARCHAR(180) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role_code VARCHAR(40) NOT NULL DEFAULT 'viewer',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO organization (id, code, name, is_active) VALUES
(1, 'telemining', 'Telemining', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO site (id, organization_id, code, name, is_active) VALUES
(1, 1, 'diamante', 'Diamante', TRUE),
(2, 1, 'andesita', 'Andesita', TRUE),
(3, 1, 'andes-norte', 'Andes Norte', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO site_map (id, site_id, code, name, image_url, is_active) VALUES
(1, 1, 'diamante-main', 'Diamante principal', '/maps/diamante.jpg', TRUE),
(2, 2, 'andesita-main', 'Andesita principal', '/maps/andesita.jpg', TRUE),
(3, 3, 'andes-norte-main', 'Andes Norte principal', '/maps/andes-norte.jpg', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO map_object (id, site_map_id, code, name, object_type, geometry_type, geometry_json, state_code, is_active) VALUES
(1, 1, 'diamante-pipa', 'Diamante PIPA', 'polygon', 'polygon', '{"x":40,"y":40,"w":160,"h":90}', 'normal', TRUE),
(2, 1, 'bde', 'Bajo Diamante Esmeralda', 'polygon', 'polygon', '{"x":360,"y":120,"w":240,"h":180}', 'centro', TRUE),
(3, 2, 'andesita-norte-hw', 'Andesita Norte HW', 'polygon', 'polygon', '{"x":100,"y":120,"w":180,"h":100}', 'centro', TRUE),
(4, 3, 'monitoreo-post-evento-2025', 'Monitoreo Post Evento 2025', 'polygon', 'polygon', '{"x":100,"y":120,"w":180,"h":100}', 'centro', TRUE),
(5, 3, 'inicio-caving', 'Inicio Caving', 'polygon', 'polygon', '{"x":340,"y":200,"w":200,"h":140}', 'normal', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO screen (id, site_id, site_map_id, code, name, status_code, expected_url, role_code, is_active) VALUES
(1, 1, 1, 'CENTRAL-01', 'Central', 'online', 'http://localhost:15173/', 'central', TRUE),
(2, 1, 1, 'DIAMANTE-01', 'Diamante muro', 'online', 'http://localhost:15173/sismico/diamante', 'wall', TRUE),
(3, 2, 2, 'ANDESITA-01', 'Andesita muro', 'online', 'http://localhost:15173/sismico/andesita', 'wall', TRUE),
(4, 3, 3, 'ANDESNORTE-01', 'Andes Norte muro', 'offline', 'http://localhost:15173/sismico/andes-norte', 'wall', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO alert_event (id, site_id, source_object_id, title, message, severity, status, metadata) VALUES
(1, 1, 2, 'Alerta Diamante', 'Semáforo vial cambiado a rojo por alerta crítica', 'high', 'open', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO remote_source (id, site_id, code, name, source_type, base_url, is_active) VALUES
(1, 1, 'diamante-source', 'Fuente Diamante', 'api_rest', 'http://mock/diamante', TRUE),
(2, 2, 'andesita-source', 'Fuente Andesita', 'api_rest', 'http://mock/andesita', TRUE),
(3, 3, 'andes-norte-source', 'Fuente Andes Norte', 'api_rest', 'http://mock/andes-norte', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO remote_endpoint (id, remote_source_id, site_id, code, name, endpoint_url, endpoint_kind, polling_seconds, parser_type, is_enabled) VALUES
(1, 1, 1, 'diamante-mock', 'Mock Diamante', 'http://mock/diamante/status', 'json_api', 15, 'mock', TRUE),
(2, 2, 2, 'andesita-mock', 'Mock Andesita', 'http://mock/andesita/status', 'json_api', 15, 'mock', TRUE),
(3, 3, 3, 'andes-norte-mock', 'Mock Andes Norte', 'http://mock/andes-norte/status', 'json_api', 15, 'mock', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO app_user (id, username, full_name, password_hash, role_code, is_active) VALUES
(1, 'admin', 'Administrador', 'admin123', 'admin', TRUE),
(2, 'operador', 'Operador', 'operador123', 'operator', TRUE)
ON CONFLICT (id) DO NOTHING;
