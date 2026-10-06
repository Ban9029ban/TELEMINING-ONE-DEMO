/* =========================================================
   EXTENSIONES
   ========================================================= */

-- UUID y funciones crypt(), gen_salt()
CREATE EXTENSION IF NOT EXISTS pgcrypto;


/* =========================================================
   TABLA USERS
   ========================================================= */

CREATE TABLE IF NOT EXISTS users (
  id              BIGSERIAL PRIMARY KEY,
  username        TEXT UNIQUE NOT NULL,
  full_name       VARCHAR(120) NOT NULL DEFAULT '',
  hashed_password TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'user',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_permission_catalog (
  module_key     TEXT NOT NULL,
  submodule_key  TEXT NOT NULL,
  label          TEXT NOT NULL,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (module_key, submodule_key)
);

CREATE TABLE IF NOT EXISTS user_permission_assignment (
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_key     TEXT NOT NULL,
  submodule_key  TEXT NOT NULL,
  allowed        BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, module_key, submodule_key)
);


/* =========================================================
   TABLAS BÁSICAS: TAG, GATEWAY
   ========================================================= */

CREATE TABLE IF NOT EXISTS tag (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR
);

CREATE TABLE IF NOT EXISTS gateway (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR
);


/* =========================================================
   TABLA ACCESS_EVENT
   (eventos de personas/vehículos, usado por gráficos)
   ========================================================= */

CREATE TABLE IF NOT EXISTS access_event (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  msg_id       UUID,
  tag_id       UUID REFERENCES tag(id),
  gateway_id   UUID REFERENCES gateway(id),
  ts_edge      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ts_ingested  TIMESTAMPTZ NOT NULL DEFAULT now(),
  signal       VARCHAR,
  rssi         INTEGER,
  zone         VARCHAR,
  direction    VARCHAR,
  level        INTEGER,      -- nivel lógico (1,2,3…)
  kind         VARCHAR,      -- 'vehicle' | 'person'
  extra        JSONB
);

/* =========================================================
   TABLAS DE MAPAS: POINTS + POLYGONS
   ========================================================= */

-- MAP_POINTS: puntos en mapa (GIS / layout mina)
CREATE TABLE IF NOT EXISTS map_points (
  id             SERIAL PRIMARY KEY,
  site           VARCHAR(80) NOT NULL,
  nivel          VARCHAR(40),
  name           VARCHAR(120),
  lat            DOUBLE PRECISION,
  lng            DOUBLE PRECISION,
  tipo           VARCHAR(40),

  site_code      VARCHAR(80),
  point_type     VARCHAR(40),
  zone           VARCHAR(80),

  device         VARCHAR(120),
  map_x          NUMERIC(6,3),
  map_y          NUMERIC(6,3),
  sensor         BOOLEAN NOT NULL DEFAULT FALSE,
  visual_state   VARCHAR(40) DEFAULT 'bg-off',
  count_people   INTEGER NOT NULL DEFAULT 0,
  count_vehicles INTEGER NOT NULL DEFAULT 0
);

-- MAP_POLYGONS: zonas en GeoJSON
CREATE TABLE IF NOT EXISTS map_polygons (
  id        SERIAL PRIMARY KEY,
  site      VARCHAR(80) NOT NULL,
  nivel     VARCHAR(40),
  name      VARCHAR(120),
  geojson   JSON NOT NULL,
  site_code VARCHAR(80),
  zone      VARCHAR(40)
);


/* =========================================================
   ÍNDICES
   ========================================================= */

-- MAP POINTS
CREATE INDEX IF NOT EXISTS idx_map_points_site          ON map_points(site);
CREATE INDEX IF NOT EXISTS idx_map_points_site_nivel    ON map_points(site, nivel);
CREATE INDEX IF NOT EXISTS idx_map_points_site_code     ON map_points(site_code);

-- MAP POLYGONS
CREATE INDEX IF NOT EXISTS idx_map_polygons_site        ON map_polygons(site);
CREATE INDEX IF NOT EXISTS idx_map_polygons_site_nivel  ON map_polygons(nivel);
CREATE INDEX IF NOT EXISTS idx_map_polygons_site_code   ON map_polygons(site_code);

-- ACCESS_EVENT
CREATE INDEX IF NOT EXISTS idx_ae_ts         ON access_event(ts_ingested);
CREATE INDEX IF NOT EXISTS idx_ae_extra_kind ON access_event USING GIN (extra);


/* =========================================================
   TABLAS UR / SENSOR / VEHICLES
   ========================================================= */

CREATE TABLE IF NOT EXISTS ur (
    id      BIGSERIAL PRIMARY KEY,
    nombre  VARCHAR(120) NOT NULL,
    estado  VARCHAR(40)  NOT NULL DEFAULT 'online'
);

CREATE TABLE IF NOT EXISTS sensor (
    id      BIGSERIAL PRIMARY KEY,
    ur_id   BIGINT REFERENCES ur(id),
    nombre  VARCHAR(120),
    online  BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS vehicles (
    id      BIGSERIAL PRIMARY KEY,
    patente VARCHAR(20),
    status  VARCHAR(20) NOT NULL DEFAULT 'online',
    level   INTEGER
);

-- unicidad por nombre de UR para ON CONFLICT (nombre) - forma idempotente
DO $$
BEGIN
  IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'uq_ur_nombre'
  ) THEN
    ALTER TABLE ur
      ADD CONSTRAINT uq_ur_nombre UNIQUE (nombre);
  END IF;
END $$;


/* =========================================================
   ENTIDADES BASE: EMPRESAS, PERSONAS, EQUIPOS
   ========================================================= */

CREATE TABLE IF NOT EXISTS company (
    id              BIGSERIAL PRIMARY KEY,
    name            VARCHAR(150) NOT NULL,
    rut             VARCHAR(20),
    address         VARCHAR(200),
    phone           VARCHAR(50),
    email           VARCHAR(120),
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMP NOT NULL DEFAULT now(),
    updated_at      TIMESTAMP NOT NULL DEFAULT now()
);

-- Ensure unique company name for ON CONFLICT (name)
DO $$
BEGIN
  IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'uq_company_name'
  ) THEN
    ALTER TABLE company
      ADD CONSTRAINT uq_company_name UNIQUE (name);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS person (
    id                  BIGSERIAL PRIMARY KEY,
    company_id          BIGINT REFERENCES company(id),

    rut                 VARCHAR(20),
    full_name           VARCHAR(160) NOT NULL,
    first_name          VARCHAR(80),
    last_name           VARCHAR(80),

    birth_date          DATE,
    address             VARCHAR(200),
    blood_type          VARCHAR(5),
    phone               VARCHAR(30),
    emergency_phone     VARCHAR(30),

    position            VARCHAR(100),
    group_name          VARCHAR(80),

    active              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMP NOT NULL DEFAULT now(),
    updated_at          TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_person_company
    ON person(company_id);

CREATE INDEX IF NOT EXISTS idx_person_rut
    ON person(rut);

CREATE TABLE IF NOT EXISTS equipment_type (
    id              BIGSERIAL PRIMARY KEY,
    code            VARCHAR(40) NOT NULL UNIQUE,
    name            VARCHAR(80) NOT NULL,
    description     TEXT
);

CREATE TABLE IF NOT EXISTS equipment (
    id              BIGSERIAL PRIMARY KEY,
    equipment_type_id BIGINT REFERENCES equipment_type(id),
    company_id      BIGINT REFERENCES company(id),

    code            VARCHAR(80) NOT NULL,
    name            VARCHAR(160) NOT NULL,
    description     TEXT,
    critical        BOOLEAN NOT NULL DEFAULT FALSE,

    active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMP NOT NULL DEFAULT now(),
    updated_at      TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_equipment_company
    ON equipment(company_id);

CREATE INDEX IF NOT EXISTS idx_equipment_code
    ON equipment(code);

-- Regla de permanencia: un equipo con tag puede ser alertado si aparece
-- fuera del pórtico autorizado.
/* =========================================================
   RELACIÓN VEHÍCULO ↔ EMPRESA
   ========================================================= */

CREATE TABLE IF NOT EXISTS vehicle_company (
    id              BIGSERIAL PRIMARY KEY,
    vehicle_id      BIGINT NOT NULL REFERENCES vehicles(id),
    company_id      BIGINT NOT NULL REFERENCES company(id),
    valid_from      TIMESTAMP NOT NULL DEFAULT now(),
    valid_to        TIMESTAMP,
    active          BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_company_active
    ON vehicle_company(vehicle_id, company_id)
    WHERE active = TRUE;


/* =========================================================
   ASIGNACIÓN DE TAGS A ENTIDADES
   ========================================================= */

CREATE TABLE IF NOT EXISTS tag_assignment (
    id              BIGSERIAL PRIMARY KEY,
    tag_id          UUID NOT NULL REFERENCES tag(id),

    entity_type     VARCHAR(32) NOT NULL,
    entity_id       BIGINT NOT NULL,

    display_name    VARCHAR(160),
    extra           JSONB,

    active          BOOLEAN NOT NULL DEFAULT TRUE,
    valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to        TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tag_assignment_active
    ON tag_assignment(tag_id, entity_type, entity_id)
    WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS idx_tag_assignment_tag
    ON tag_assignment(tag_id);

CREATE INDEX IF NOT EXISTS idx_tag_assignment_entity
    ON tag_assignment(entity_type, entity_id);


/* =========================================================
   MÓDULO DE PÓRTICOS
   ========================================================= */

CREATE TABLE IF NOT EXISTS access_portico_type (
    id          SMALLSERIAL PRIMARY KEY,
    code        VARCHAR(32) NOT NULL UNIQUE,  -- 'BASIC', 'CLIMATE'
    name        VARCHAR(80) NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS access_portico (
    id                BIGSERIAL PRIMARY KEY,
    gateway_id        UUID NOT NULL REFERENCES gateway(id),
    map_point_id      INTEGER REFERENCES map_points(id),

    name              VARCHAR(120) NOT NULL,
    specific_name     VARCHAR(120),
    street_name       VARCHAR(120),
    trench_name       VARCHAR(120),

    site              VARCHAR(80),
    nivel             VARCHAR(40),
    site_code         VARCHAR(80),
    listener_aliases  TEXT[],
    zone              VARCHAR(80),

    portico_type_id   SMALLINT NOT NULL REFERENCES access_portico_type(id),
    operating_mode    VARCHAR(20) NOT NULL DEFAULT 'READ',
    antenna_in_port   SMALLINT,
    antenna_out_port  SMALLINT,
    sequence_window_seconds INTEGER NOT NULL DEFAULT 15,

    display_shape     VARCHAR(16) NOT NULL DEFAULT 'circle',
    has_climate       BOOLEAN NOT NULL DEFAULT FALSE,

    active            BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMP NOT NULL DEFAULT now(),
    updated_at        TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_access_portico_gateway
    ON access_portico(gateway_id);

CREATE INDEX IF NOT EXISTS idx_access_portico_site
    ON access_portico(site, nivel, site_code);

/* Pulso tecnico independiente de los accesos: permite saber si cada
   portico sigue comunicando aunque el EPC recibido no este asignado. */
CREATE TABLE IF NOT EXISTS portico_communication (
  portico_id       BIGINT PRIMARY KEY REFERENCES access_portico(id) ON DELETE CASCADE,
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_reader_code VARCHAR(120),
  last_epc         VARCHAR(160)
);

CREATE TABLE IF NOT EXISTS equipment_portico_rule (
    equipment_id       BIGINT PRIMARY KEY REFERENCES equipment(id) ON DELETE CASCADE,
    allowed_portico_id BIGINT NOT NULL REFERENCES access_portico(id),
    active             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);


/* =========================================================
   CLIMA EN PÓRTICOS
   ========================================================= */

CREATE TABLE IF NOT EXISTS access_climate_var (
    id          SMALLSERIAL PRIMARY KEY,
    code        VARCHAR(32) NOT NULL UNIQUE,
    name        VARCHAR(80) NOT NULL,
    unit        VARCHAR(20) NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS access_portico_climate_cfg (
    id              SERIAL PRIMARY KEY,
    portico_id      BIGINT NOT NULL REFERENCES access_portico(id),
    climate_var_id  SMALLINT NOT NULL REFERENCES access_climate_var(id),

    green_max       NUMERIC(10,3) NOT NULL,
    yellow_max      NUMERIC(10,3) NOT NULL,

    active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMP NOT NULL DEFAULT now(),
    updated_at      TIMESTAMP NOT NULL DEFAULT now(),

    CONSTRAINT uq_portico_climate_cfg UNIQUE (portico_id, climate_var_id)
);

CREATE TABLE IF NOT EXISTS access_portico_climate_reading (
    id              BIGSERIAL PRIMARY KEY,
    portico_id      BIGINT NOT NULL REFERENCES access_portico(id),
    climate_var_id  SMALLINT NOT NULL REFERENCES access_climate_var(id),

    ts              TIMESTAMPTZ NOT NULL DEFAULT now(),
    value           NUMERIC(10,3) NOT NULL,
    level           VARCHAR(10),
    extra           JSONB,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ap_climate_reading_portico_ts
    ON access_portico_climate_reading(portico_id, ts);

CREATE INDEX IF NOT EXISTS idx_ap_climate_reading_var_ts
    ON access_portico_climate_reading(climate_var_id, ts);


/* =========================================================
   OCUPACIÓN DE POLÍGONOS
   ========================================================= */

CREATE TABLE IF NOT EXISTS map_polygon_occupancy (
    id                        BIGSERIAL PRIMARY KEY,
    polygon_id                INTEGER NOT NULL REFERENCES map_polygons(id),
    snapshot_time             TIMESTAMPTZ NOT NULL DEFAULT now(),

    people_count              INTEGER NOT NULL DEFAULT 0,
    vehicle_count             INTEGER NOT NULL DEFAULT 0,
    critical_equipment_count  INTEGER NOT NULL DEFAULT 0,

    created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_polygon_occupancy_pol_ts
    ON map_polygon_occupancy(polygon_id, snapshot_time);


/* =========================================================
   VISTAS PARA DASHBOARD
   ========================================================= */

CREATE OR REPLACE VIEW view_ur_sensores AS
SELECT
    u.id        AS ur_id,
    u.nombre    AS nombre,
    COALESCE(SUM(CASE WHEN s.online = TRUE THEN 1 ELSE 0 END), 0) AS sensores_online,
    COUNT(s.id) AS sensores_total
FROM ur u
LEFT JOIN sensor s ON s.ur_id = u.id
GROUP BY u.id, u.nombre;

CREATE OR REPLACE VIEW view_ur_estado AS
SELECT
    u.id     AS ur_id,
    u.nombre AS nombre,
    u.estado AS estado,
    vs.sensores_online,
    vs.sensores_total
FROM ur u
LEFT JOIN view_ur_sensores vs ON vs.ur_id = u.id;

CREATE OR REPLACE VIEW view_zenit_kpis AS
SELECT 'URs operativas'::text AS categoria, COUNT(*)::int AS cantidad
FROM ur
WHERE estado = 'online'
UNION ALL
SELECT 'URs con alerta', COUNT(*)::int
FROM ur
WHERE estado = 'alerta'
UNION ALL
SELECT 'Vehículos operativos', COUNT(*)::int
FROM vehicles
WHERE status = 'online';

CREATE OR REPLACE VIEW view_access_portico_summary AS
SELECT
    ap.id                        AS portico_id,
    ap.name                      AS portico_name,
    ap.specific_name,
    ap.street_name,
    ap.trench_name,
    ap.site,
    ap.nivel,
    ap.site_code,
    ap.zone,
    apt.code                     AS portico_type_code,
    apt.name                     AS portico_type_name,
    ap.operating_mode,
    ap.antenna_in_port,
    ap.antenna_out_port,
    ap.sequence_window_seconds,
    ap.display_shape,
    ap.has_climate,
    COUNT(ae.id)                                 AS total_events,
    COUNT(*) FILTER (WHERE ae.direction = 'in')  AS total_in,
    COUNT(*) FILTER (WHERE ae.direction = 'out') AS total_out,
    MAX(ae.ts_ingested)                          AS last_event_at
FROM access_portico ap
JOIN access_portico_type apt ON apt.id = ap.portico_type_id
LEFT JOIN gateway g          ON g.id  = ap.gateway_id
LEFT JOIN access_event ae    ON ae.gateway_id = g.id
GROUP BY
    ap.id, ap.name, ap.specific_name, ap.street_name, ap.trench_name,
    ap.site, ap.nivel, ap.site_code, ap.zone,
    apt.code, apt.name,
    ap.operating_mode, ap.antenna_in_port, ap.antenna_out_port, ap.sequence_window_seconds,
    ap.display_shape, ap.has_climate;


/* =========================================================
   USUARIO ADMIN
   ========================================================= */

INSERT INTO users (username, full_name, hashed_password, role, is_active)
VALUES ('admin', 'Administrador', crypt('admin123', gen_salt('bf')), 'admin', TRUE)
ON CONFLICT (username) DO UPDATE
SET full_name       = EXCLUDED.full_name,
    hashed_password = EXCLUDED.hashed_password,
    role            = EXCLUDED.role,
    is_active       = EXCLUDED.is_active;

INSERT INTO users (username, full_name, hashed_password, role, is_active)
VALUES ('admin_produccion', 'Admin Produccion', crypt('123', gen_salt('bf')), 'admin_produccion', TRUE)
ON CONFLICT (username) DO UPDATE
SET full_name       = EXCLUDED.full_name,
    hashed_password = EXCLUDED.hashed_password,
    role            = EXCLUDED.role,
    is_active       = EXCLUDED.is_active;

INSERT INTO users (username, full_name, hashed_password, role, is_active)
VALUES
  ('tracking', 'Usuario Tracking', crypt('123', gen_salt('bf')), 'tracking', TRUE),
  ('produccion', 'Usuario Produccion', crypt('123', gen_salt('bf')), 'produccion', TRUE),
  ('acceso', 'Usuario Acceso', crypt('123', gen_salt('bf')), 'acceso', TRUE),
  ('camaras', 'Usuario Camaras', crypt('123', gen_salt('bf')), 'camaras', TRUE),
  ('productividad', 'Usuario Productividad', crypt('123', gen_salt('bf')), 'productividad', TRUE),
  ('sismico', 'Usuario Sismico', crypt('123', gen_salt('bf')), 'sismico', TRUE),
  ('control_vial', 'Usuario Control Vial', crypt('123', gen_salt('bf')), 'control_vial', TRUE),
  ('agente_ia', 'Usuario Agente IA', crypt('123', gen_salt('bf')), 'agente_ia', TRUE)
ON CONFLICT (username) DO UPDATE
SET full_name       = EXCLUDED.full_name,
    hashed_password = EXCLUDED.hashed_password,
    role            = EXCLUDED.role,
    is_active       = EXCLUDED.is_active;

INSERT INTO user_permission_catalog (module_key, submodule_key, label, sort_order) VALUES
  ('tracking', 'tracking', 'Tracking', 10),
  ('tracking', 'mapa', 'Tracking / Mapa', 11),
  ('tracking', 'alertas', 'Tracking / Alertas', 12),
  ('tracking', 'tiempo_real', 'Tracking / Tiempo real', 13),
  ('tracking', 'movimiento', 'Tracking / Movimiento', 14),
  ('tracking', 'zonas_det', 'Tracking / Zonas DET', 15),
  ('produccion', 'produccion', 'Produccion', 20),
  ('produccion', 'plano', 'Produccion / Plano', 21),
  ('produccion', 'gantt_mineria', 'Produccion / Gantt mineria', 22),
  ('produccion', 'control_mineria', 'Produccion / Control mineria', 23),
  ('produccion', 'gantt_oocc', 'Produccion / Gantt OO.CC', 24),
  ('produccion', 'control_oocc', 'Produccion / Control OO.CC', 25),
  ('produccion', 'horas_mineria', 'Produccion / Horas mineria', 26),
  ('acceso', 'acceso', 'Acceso', 30),
  ('camaras', 'camaras', 'Camaras', 40),
  ('camaras', 'ver_camaras', 'Camaras / Ver camaras', 41),
  ('productividad', 'productividad', 'Productividad', 50),
  ('sismico', 'sismico', 'Semaforos sismicos', 60),
  ('control_vial', 'control_vial', 'Semaforos control vial', 70),
  ('agente_ia', 'agente_ia', 'Agente IA TM One', 80),
  ('configuracion', 'configuracion', 'Configuracion', 90),
  ('configuracion', 'empresas', 'Configuracion / Empresas', 91),
  ('configuracion', 'personas', 'Configuracion / Personas', 92),
  ('configuracion', 'equipos', 'Configuracion / Equipos', 93),
  ('configuracion', 'porticos', 'Configuracion / Porticos', 94),
  ('configuracion', 'tags', 'Configuracion / Tags', 95),
  ('configuracion', 'vehiculos', 'Configuracion / Vehiculos', 96),
  ('configuracion', 'camaras', 'Configuracion / Camaras', 97),
  ('configuracion', 'produccion', 'Configuracion / Produccion', 98),
  ('configuracion', 'usuarios_permisos', 'Configuracion / Usuarios y permisos', 99),
  ('configuracion', 'fuentes_externas', 'Configuracion / Fuentes externas', 100)
ON CONFLICT (module_key, submodule_key) DO UPDATE
SET label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order;


/* =========================================================
   DATOS DE PRUEBA MAPAS (Geo / layout)
   ========================================================= */

-- Puntos de ejemplo
INSERT INTO map_points (site, nivel, name, lat, lng, tipo)
VALUES
  ('Diamante - NTI', 'NP',  'P1', -29.90410, -71.25420, 'marker'),
  ('Diamante - NTI', 'NP',  'P2', -29.90530, -71.25110, 'marker'),
  ('Diamante - NTI', 'UCL', 'U1', -29.89900, -71.24800, 'marker');

INSERT INTO map_points (site, nivel, name, lat, lng, tipo)
VALUES
  ('Diamante - UCL', 'UCL', 'U2', -29.89750, -71.24670, 'marker');

-- Polígonos de ejemplo
INSERT INTO map_polygons (site, nivel, name, geojson)
VALUES
('Diamante - NTI', 'NP', 'Zona Seguridad NP',
 '{
    "type":"Feature",
    "geometry":{"type":"Polygon","coordinates":[[[-71.2550,-29.9040],[-71.2540,-29.9040],[-71.2540,-29.9050],[-71.2550,-29.9050],[-71.2550,-29.9040]]]},
    "properties":{"color":"#00FF00","opacity":0.3}
  }');

INSERT INTO map_polygons (site, nivel, name, geojson)
VALUES
('Diamante - UCL', 'UCL', 'Zona UCL 1',
 '{
    "type":"Feature",
    "geometry":{"type":"Polygon","coordinates":[[[-71.2470,-29.8970],[-71.2460,-29.8970],[-71.2460,-29.8980],[-71.2470,-29.8980],[-71.2470,-29.8970]]]},
    "properties":{"color":"#FF0000","opacity":0.3}
  }');


/* =========================================================
   NORMALIZACIÓN site_code / point_type / zone (DATA FIX)
   ========================================================= */

UPDATE map_points
SET site_code = CASE
                  WHEN nivel ILIKE 'NP'  THEN 'NP_DIA'
                  WHEN nivel ILIKE 'UCL' THEN 'UCL_DIA'
                  ELSE UPPER(COALESCE(nivel, ''))
                END
WHERE site_code IS NULL OR site_code = '';

UPDATE map_points
SET
  point_type = COALESCE(point_type, tipo),
  zone       = COALESCE(zone, nivel);

UPDATE map_polygons
SET site_code = CASE
                  WHEN nivel ILIKE 'NP'  THEN 'NP_DIA'
                  WHEN nivel ILIKE 'UCL' THEN 'UCL_DIA'
                  ELSE UPPER(COALESCE(nivel, ''))
                END
WHERE site_code IS NULL OR site_code = '';

UPDATE map_polygons
SET zone = COALESCE(zone, nivel);


/* =========================================================
   SEED MÍNIMO UR / SENSORES / VEHÍCULOS
   ========================================================= */

INSERT INTO ur (nombre, estado) VALUES
  ('UR NP-01',        'online'),
  ('UR NP-02',        'alerta'),
  ('UR UCL-01',       'online'),
  ('UR NP-03',        'online'),
  ('UR UCL-02',       'online'),
  ('UR OFICINA-CL',   'online')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO sensor (ur_id, nombre, online)
SELECT u.id, 'SEN-' || replace(u.nombre, ' ', '-') || '-1', TRUE
FROM ur u
WHERE NOT EXISTS (
  SELECT 1 FROM sensor s WHERE s.ur_id = u.id
);

INSERT INTO vehicles (patente, status, level) VALUES
  ('AA-BB-11', 'online', 1),
  ('CC-DD-22', 'offline', 1),
  ('EE-FF-33', 'alerta', 2),
  ('GG-HH-44', 'online', 2),
  ('II-JJ-55', 'online', 3),
  ('KK-LL-66', 'offline', 0);


/* =========================================================
   SEED MÍNIMO PARA DASHBOARD (ACCESS_EVENT)
   ========================================================= */

DO $$
BEGIN
  IF (SELECT count(*) FROM access_event) = 0 THEN
    ------------------------------------------------------------------
    -- 1) Eventos en NP (nivel 1 y 2) últimas 48 horas
    ------------------------------------------------------------------
    INSERT INTO access_event (ts_edge, ts_ingested, zone, direction, level, kind, extra)
    SELECT
      now() - (i || ' hours')::interval,
      now() - (i || ' hours')::interval,
      'NP',
      CASE WHEN i % 2 = 0 THEN 'in' ELSE 'out' END,
      CASE WHEN i % 3 = 0 THEN 1 ELSE 2 END,
      CASE WHEN i % 2 = 0 THEN 'vehicle' ELSE 'person' END,
      jsonb_build_object(
        'kind', CASE WHEN i % 2 = 0 THEN 'vehicle' ELSE 'person' END,
        'node', CASE WHEN i % 2 = 0 THEN 'NP-01' ELSE 'NP-02' END
      )
    FROM generate_series(0, 47) AS i;

    ------------------------------------------------------------------
    -- 2) Eventos en UCL (nivel 2 y 3) últimas 48 horas
    ------------------------------------------------------------------
    INSERT INTO access_event (ts_edge, ts_ingested, zone, direction, level, kind, extra)
    SELECT
      now() - (i || ' hours')::interval,
      now() - (i || ' hours')::interval,
      'UCL',
      CASE WHEN i % 2 = 0 THEN 'in' ELSE 'out' END,
      CASE WHEN i % 3 = 0 THEN 2 ELSE 3 END,
      CASE WHEN i % 3 = 0 THEN 'vehicle' ELSE 'person' END,
      jsonb_build_object(
        'kind', CASE WHEN i % 3 = 0 THEN 'vehicle' ELSE 'person' END,
        'node', CASE WHEN i % 2 = 0 THEN 'U1' ELSE 'U2' END
      )
    FROM generate_series(0, 47) AS i;

    ------------------------------------------------------------------
    -- 3) Eventos en Oficina Telemining (nivel 0) últimas 24 horas
    ------------------------------------------------------------------
    INSERT INTO access_event (ts_edge, ts_ingested, zone, direction, level, kind, extra)
    SELECT
      now() - (i || ' hours')::interval,
      now() - (i || ' hours')::interval,
      'OFICINA',
      'in',
      0,
      'person',
      jsonb_build_object(
        'kind', 'person',
        'node', 'OF-01'
      )
    FROM generate_series(0, 23) AS i;
  END IF;
END $$;


/* =========================================================
   SEED TIPOS DE PÓRTICO Y VARIABLES DE CLIMA
   ========================================================= */

INSERT INTO access_portico_type (code, name, description)
VALUES
    ('BASIC',   'Pórtico estándar', 'Detecta personas, vehículos y equipamiento crítico'),
    ('CLIMATE', 'Pórtico con clima', 'Incluye sensores ambientales y umbrales configurables')
ON CONFLICT (code) DO NOTHING;

INSERT INTO access_climate_var (code, name, unit, description)
VALUES
    ('TEMP', 'Temperatura', '°C', 'Temperatura ambiente'),
    ('HUM',  'Humedad',     '%',  'Humedad relativa'),
    ('WIND', 'Viento',      'm/s','Velocidad del viento')
ON CONFLICT (code) DO NOTHING;


-- ============================================================
-- PUNTOS SOBRE EL PLANO (PÓRTICOS, PÓRTICOS CLIMA, CÁMARAS)
-- Se usa en el HOME para dibujar los íconos sobre la imagen NP_dia
-- ============================================================

CREATE TABLE IF NOT EXISTS map_device (
    id           BIGSERIAL PRIMARY KEY,
    map_code     TEXT NOT NULL,              -- 'NP_dia', 'UCL_dia', etc.
    kind         TEXT NOT NULL,              -- 'portico', 'portico_clima', 'camera'
    ref_id       BIGINT,                     -- id en access_portico o camera_video
    label        TEXT NOT NULL,
    x_pct        NUMERIC(6,3) NOT NULL,      -- 0.000 - 1.000 respecto al ancho
    y_pct        NUMERIC(6,3) NOT NULL,      -- 0.000 - 1.000 respecto al alto
    created_at   TIMESTAMP NOT NULL DEFAULT now()
);
