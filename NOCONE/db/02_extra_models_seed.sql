-- Extra models + demo seed for productivity and seismic dashboards.
-- Runs after db/00_init.sql during bootstrap.

-- =====================
-- CAMERAS
-- =====================
CREATE TABLE IF NOT EXISTS camera (
  id            BIGSERIAL PRIMARY KEY,
  code          VARCHAR(80) UNIQUE NOT NULL,
  name          VARCHAR(160),
  map_point_id  INTEGER REFERENCES map_points(id),
  portico_id    BIGINT REFERENCES access_portico(id),
  status        VARCHAR(20) NOT NULL DEFAULT 'online',
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS camera_event (
  id         BIGSERIAL PRIMARY KEY,
  camera_id  BIGINT REFERENCES camera(id),
  ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
  alert_type VARCHAR(120),
  severity   VARCHAR(20),
  extra      JSONB
);

CREATE INDEX IF NOT EXISTS idx_camera_event_ts ON camera_event(ts);

INSERT INTO camera (code, name, status)
SELECT 'CAM-NP-01', 'Camara NP 01', 'online'
WHERE NOT EXISTS (SELECT 1 FROM camera WHERE code = 'CAM-NP-01');

INSERT INTO camera (code, name, status)
SELECT 'CAM-NTI-01', 'Camara NTI 01', 'offline'
WHERE NOT EXISTS (SELECT 1 FROM camera WHERE code = 'CAM-NTI-01');

TRUNCATE TABLE camera_event RESTART IDENTITY;

INSERT INTO camera_event (camera_id, ts, alert_type, severity)
SELECT c.id, now() - interval '2 hours', 'Persona sin EPP', 'high'
FROM camera c
WHERE c.code = 'CAM-NP-01';

INSERT INTO camera_event (camera_id, ts, alert_type, severity)
SELECT c.id, now() - interval '90 minutes', 'Intrusion', 'medium'
FROM camera c
WHERE c.code = 'CAM-NP-01';

-- =====================
-- SEISMIC EVENTS
-- =====================
CREATE TABLE IF NOT EXISTS seismic_event (
  id          BIGSERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  sector      VARCHAR(120),
  energy      DOUBLE PRECISION,
  temperature DOUBLE PRECISION,
  extra       JSONB
);

CREATE INDEX IF NOT EXISTS idx_seismic_event_ts ON seismic_event(ts);

-- =====================
-- CLIMATE BURN EVENTS
-- =====================
CREATE TABLE IF NOT EXISTS climate_burn_event (
  id           BIGSERIAL PRIMARY KEY,
  ts_start     TIMESTAMPTZ NOT NULL,
  ts_end       TIMESTAMPTZ NOT NULL,
  nivel        VARCHAR(40),
  ur_name      VARCHAR(160),
  max_co_ppm   DOUBLE PRECISION,
  extra        JSONB
);

CREATE INDEX IF NOT EXISTS idx_climate_burn_event_ts ON climate_burn_event(ts_start);

TRUNCATE TABLE climate_burn_event RESTART IDENTITY;

INSERT INTO climate_burn_event (ts_start, ts_end, nivel, ur_name, max_co_ppm)
VALUES
  (now() - interval '3 days', now() - interval '3 days' + interval '25 minutes', 'NP', 'Portico clima 4', 35.2),
  (now() - interval '2 days', now() - interval '2 days' + interval '18 minutes', 'NTI', 'Portal 15', 29.4);

-- =====================
-- CREW PRODUCTIVE TIME
-- =====================
CREATE TABLE IF NOT EXISTS crew_productive_time (
  id               BIGSERIAL PRIMARY KEY,
  day              DATE NOT NULL,
  crew_name        VARCHAR(120) NOT NULL,
  zone_name        VARCHAR(120) NOT NULL,
  productive_hours DOUBLE PRECISION NOT NULL,
  extra            JSONB
);

CREATE INDEX IF NOT EXISTS idx_crew_productive_time_day ON crew_productive_time(day);

TRUNCATE TABLE crew_productive_time RESTART IDENTITY;

INSERT INTO crew_productive_time (day, crew_name, zone_name, productive_hours)
VALUES
  ((now() - interval '7 days')::date, 'Cuadrilla A', 'Frente 1', 6.5),
  ((now() - interval '6 days')::date, 'Cuadrilla B', 'Frente 2', 7.2),
  ((now() - interval '5 days')::date, 'Cuadrilla C', 'Frente 3', 5.9);

-- =====================
-- GENERATED TACTICAL TABLES
-- =====================
CREATE TABLE IF NOT EXISTS zenit_tactical_camera_availability_generated (
  id bigserial PRIMARY KEY,
  day timestamptz NOT NULL,
  nivel integer,
  online integer NOT NULL DEFAULT 0,
  offline integer NOT NULL DEFAULT 0,
  mantenimiento integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS zenit_tactical_camera_alerts_generated (
  id bigserial PRIMARY KEY,
  day timestamptz NOT NULL,
  nivel integer,
  tipo text NOT NULL,
  cantidad integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS zenit_tactical_seismic_daily_energy_generated (
  id bigserial PRIMARY KEY,
  day timestamptz NOT NULL,
  sector text NOT NULL,
  energia numeric NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS zenit_tactical_seismic_events_by_sector_generated (
  id bigserial PRIMARY KEY,
  day timestamptz NOT NULL,
  sector text NOT NULL,
  eventos integer NOT NULL DEFAULT 0
);

-- =====================
-- SEISMIC PRODUCTIVITY DATASET
-- =====================
CREATE TABLE IF NOT EXISTS zenit_sismico_sync_run_generated (
  id bigserial PRIMARY KEY,
  observed_at timestamptz NOT NULL,
  site_name text NOT NULL,
  plan_name text NOT NULL,
  source_state text NOT NULL,
  mapped_records integer NOT NULL DEFAULT 0,
  alerts_generated integer NOT NULL DEFAULT 0,
  visible_data_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zenit_sismico_sync_run_observed
  ON zenit_sismico_sync_run_generated(observed_at, site_name, plan_name);

CREATE TABLE IF NOT EXISTS zenit_sismico_polygon_state_generated (
  id bigserial PRIMARY KEY,
  observed_at timestamptz NOT NULL,
  site_name text NOT NULL,
  plan_name text NOT NULL,
  polygon_name text NOT NULL,
  status text NOT NULL,
  source_state text NOT NULL,
  event_count integer NOT NULL DEFAULT 0,
  severity text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zenit_sismico_polygon_state_observed
  ON zenit_sismico_polygon_state_generated(observed_at, site_name, plan_name, polygon_name);

CREATE TABLE IF NOT EXISTS zenit_sismico_alert_generated (
  id bigserial PRIMARY KEY,
  opened_at timestamptz NOT NULL,
  closed_at timestamptz,
  site_name text NOT NULL,
  plan_name text NOT NULL,
  polygon_name text NOT NULL,
  severity text NOT NULL,
  title text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zenit_sismico_alert_opened
  ON zenit_sismico_alert_generated(opened_at, site_name, plan_name, severity);

TRUNCATE TABLE zenit_sismico_sync_run_generated RESTART IDENTITY;
TRUNCATE TABLE zenit_sismico_polygon_state_generated RESTART IDENTITY;
TRUNCATE TABLE zenit_sismico_alert_generated RESTART IDENTITY;
TRUNCATE TABLE zenit_tactical_camera_availability_generated RESTART IDENTITY;
TRUNCATE TABLE zenit_tactical_camera_alerts_generated RESTART IDENTITY;
TRUNCATE TABLE zenit_tactical_seismic_daily_energy_generated RESTART IDENTITY;
TRUNCATE TABLE zenit_tactical_seismic_events_by_sector_generated RESTART IDENTITY;
TRUNCATE TABLE seismic_event RESTART IDENTITY;

DO $$
DECLARE
  sites text[] := ARRAY[
    'Andesita',
    'Andes Norte',
    'Andes Norte Tunel Correa',
    'Diamante',
    'Esmeralda',
    'Pilar Norte'
  ];
  plans text[] := ARRAY[
    'Andesita principal',
    'Andes Norte principal',
    'Andes Norte Tunel Correa',
    'Diamante principal',
    'Esmeralda principal',
    'Pilar Norte principal'
  ];
  polygon_counts integer[] := ARRAY[3, 5, 3, 4, 3, 3];
  start_day date := current_date - 6;
  sync_ts timestamptz;
  event_ts timestamptz;
  opened_ts timestamptz;
  closed_ts timestamptz;
  polygon_name text;
  source_state text;
  status_value text;
  severity_value text;
  mapped_records integer;
  alerts_generated integer;
  energy_value double precision;
  temperature_value double precision;
  availability_day timestamptz;
  site_idx integer;
  poly_idx integer;
  run_idx integer;
  day_idx integer;
  event_idx integer;
  level_idx integer;
  roll double precision;
BEGIN
  RAISE NOTICE 'seed extra models: iniciando dataset sismico/productividad demo';

  FOR site_idx IN 1..array_length(sites, 1) LOOP
    RAISE NOTICE 'seed extra models: procesando sitio % (%)', site_idx, sites[site_idx];

    FOR run_idx IN 0..335 LOOP
      sync_ts := date_trunc('hour', now()) - interval '7 days'
        + (run_idx * interval '30 minutes')
        + ((site_idx - 1) * interval '2 minutes');

      roll := random();
      source_state := CASE
        WHEN roll < 0.12 THEN 'online'
        WHEN roll < 0.18 THEN 'cached'
        WHEN roll < 0.22 THEN 'manual'
        WHEN roll < 0.92 THEN 'offline'
        ELSE 'unknown'
      END;

      mapped_records := CASE source_state
        WHEN 'online' THEN 28 + floor(random() * 110)::int
        WHEN 'cached' THEN 12 + floor(random() * 55)::int
        WHEN 'manual' THEN 6 + floor(random() * 24)::int
        WHEN 'offline' THEN floor(random() * 4)::int
        ELSE floor(random() * 2)::int
      END;

      alerts_generated := CASE
        WHEN source_state = 'offline' THEN floor(random() * 2)::int
        WHEN random() < 0.18 THEN 1 + floor(random() * 3)::int
        ELSE 0
      END;

      INSERT INTO zenit_sismico_sync_run_generated (
        observed_at,
        site_name,
        plan_name,
        source_state,
        mapped_records,
        alerts_generated,
        visible_data_at
      )
      VALUES (
        sync_ts,
        sites[site_idx],
        plans[site_idx],
        source_state,
        mapped_records,
        alerts_generated,
        sync_ts - make_interval(mins => floor(random() * 180)::int)
      );
    END LOOP;

    FOR poly_idx IN 1..polygon_counts[site_idx] LOOP
      polygon_name := format('%s / Poligono %s', sites[site_idx], lpad(poly_idx::text, 2, '0'));

      FOR run_idx IN 0..55 LOOP
        sync_ts := date_trunc('hour', now()) - interval '7 days'
          + (run_idx * interval '3 hours')
          + ((poly_idx - 1) * interval '4 minutes');

        roll := random();
        status_value := CASE
          WHEN roll < 0.42 THEN 'Offline'
          WHEN roll < 0.68 THEN 'Normal'
          WHEN roll < 0.84 THEN 'Warning'
          WHEN roll < 0.94 THEN 'Critical'
          ELSE 'Unknown'
        END;

        source_state := CASE
          WHEN status_value = 'Normal' THEN 'online'
          WHEN status_value = 'Warning' THEN 'cached'
          WHEN status_value = 'Critical' THEN 'manual'
          WHEN status_value = 'Offline' THEN 'offline'
          ELSE 'unknown'
        END;

        severity_value := CASE status_value
          WHEN 'Critical' THEN 'Critica'
          WHEN 'Warning' THEN 'Alta'
          WHEN 'Offline' THEN 'Media'
          WHEN 'Unknown' THEN 'Unknown'
          ELSE 'Info'
        END;

        INSERT INTO zenit_sismico_polygon_state_generated (
          observed_at,
          site_name,
          plan_name,
          polygon_name,
          status,
          source_state,
          event_count,
          severity
        )
        VALUES (
          sync_ts,
          sites[site_idx],
          plans[site_idx],
          polygon_name,
          status_value,
          source_state,
          CASE status_value
            WHEN 'Critical' THEN 2 + floor(random() * 4)::int
            WHEN 'Warning' THEN 1 + floor(random() * 3)::int
            WHEN 'Offline' THEN floor(random() * 2)::int
            ELSE floor(random() * 2)::int
          END,
          severity_value
        );
      END LOOP;

      IF random() < 0.68 THEN
        FOR event_idx IN 1..(1 + floor(random() * 3)::int) LOOP
          opened_ts := (start_day + floor(random() * 7)::int)::timestamptz
            + make_interval(hours => floor(random() * 23)::int, mins => floor(random() * 59)::int);

          severity_value := CASE
            WHEN random() < 0.16 THEN 'Critica'
            WHEN random() < 0.40 THEN 'Alta'
            WHEN random() < 0.70 THEN 'Media'
            WHEN random() < 0.90 THEN 'Baja'
            ELSE 'Info'
          END;

          closed_ts := CASE
            WHEN random() < 0.56 THEN opened_ts + make_interval(hours => 1 + floor(random() * 8)::int)
            ELSE NULL
          END;

          INSERT INTO zenit_sismico_alert_generated (
            opened_at,
            closed_at,
            site_name,
            plan_name,
            polygon_name,
            severity,
            title
          )
          VALUES (
            opened_ts,
            closed_ts,
            sites[site_idx],
            plans[site_idx],
            polygon_name,
            severity_value,
            format('Alerta %s en %s', severity_value, polygon_name)
          );
        END LOOP;
      END IF;
    END LOOP;

    FOR day_idx IN 0..6 LOOP
      FOR event_idx IN 1..(2 + floor(random() * 4)::int) LOOP
        event_ts := (start_day + day_idx)::timestamptz
          + make_interval(hours => floor(random() * 23)::int, mins => floor(random() * 59)::int);

        energy_value := 18000 + random() * 105000;
        temperature_value := 21 + random() * 7;

        severity_value := CASE
          WHEN energy_value >= 90000 THEN 'Critica'
          WHEN energy_value >= 65000 THEN 'Alta'
          WHEN energy_value >= 40000 THEN 'Media'
          ELSE 'Info'
        END;

        INSERT INTO seismic_event (
          ts,
          sector,
          energy,
          temperature,
          extra
        )
        VALUES (
          event_ts,
          sites[site_idx],
          energy_value,
          temperature_value,
          jsonb_build_object(
            'site_name', sites[site_idx],
            'plan_name', plans[site_idx],
            'polygon_name', format('%s / Poligono %s', sites[site_idx], lpad((1 + floor(random() * polygon_counts[site_idx])::int)::text, 2, '0')),
            'severity', severity_value
          )
        );
      END LOOP;
    END LOOP;
  END LOOP;

  FOR day_idx IN 0..6 LOOP
    availability_day := (start_day + day_idx)::timestamptz;

    FOR level_idx IN 1..3 LOOP
      INSERT INTO zenit_tactical_camera_availability_generated (
        day,
        nivel,
        online,
        offline,
        mantenimiento
      )
      VALUES (
        availability_day,
        level_idx,
        8 + (level_idx * 2) + ((day_idx + level_idx) % 3),
        1 + ((day_idx + level_idx) % 2),
        1 + ((day_idx + level_idx + 1) % 2)
      );
    END LOOP;

    INSERT INTO zenit_tactical_camera_alerts_generated (day, nivel, tipo, cantidad)
    VALUES
      (availability_day, 1, 'Intrusion', 2 + (day_idx % 3)),
      (availability_day, 1, 'PPE', 1 + ((day_idx + 1) % 2)),
      (availability_day, 2, 'Vehiculo detenido', 1 + (day_idx % 2));
  END LOOP;

  RAISE NOTICE 'seed extra models: dataset demo generado correctamente';
END $$;

INSERT INTO zenit_tactical_seismic_daily_energy_generated (day, sector, energia)
SELECT
  date_trunc('day', ts) AS day,
  sector,
  ROUND(SUM(energy)::numeric, 2) AS energia
FROM seismic_event
GROUP BY 1, 2
ORDER BY 1, 2;

INSERT INTO zenit_tactical_seismic_events_by_sector_generated (day, sector, eventos)
SELECT
  date_trunc('day', ts) AS day,
  sector,
  COUNT(*)::int AS eventos
FROM seismic_event
GROUP BY 1, 2
ORDER BY 1, 2;
