-- ===============================================
-- ZENIT DEMO DIAMANTE - SQL UNIFICADO FINAL
-- Base + Sistema + Tags + Eventos simulados
-- ===============================================

BEGIN;
SET client_encoding = 'UTF8';

-- ============================================================
-- 0) LIMPIEZA DE EVENTOS Y CLIMA
-- ============================================================
TRUNCATE TABLE access_event;
TRUNCATE TABLE access_portico_climate_reading RESTART IDENTITY;

-- ============================================================
-- 1) ASEGURAR EMPRESAS BASE
-- ============================================================
INSERT INTO company (name, rut, address, phone, email)
VALUES
  ('CODELCO',    '61.704.000-0', 'Av. Minera Norte 123',   '+56 2 2750 1000', 'contacto@codelco.cl'),
  ('Telemining', '76.999.333-1', 'Av. Apoquindo 4500',     '+56 2 2980 2010', 'info@telemining.cl'),
  ('Zublin',     '96.123.456-7', 'Camino Industrial 1234', '+56 2 2555 1010', 'contacto@zublin.cl'),
  ('Salfa',      '96.765.432-1', 'Av. Los Constructores',  '+56 2 2444 2020', 'info@salfa.cl')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- 2) COMPLETAR PERSONAS HASTA 500 (NOMBRES ?sNICOS Y COHERENTES)
--    (Se deja una sola estrategia limpia; se elimina el bloque duplicado)
-- ============================================================
DO $$
DECLARE
  v_id_codelco    BIGINT;
  v_id_telemining BIGINT;
  v_id_zublin     BIGINT;
  v_id_salfa      BIGINT;

  v_current_count INT;
  v_to_create INT;
BEGIN
  SELECT id INTO v_id_codelco    FROM company WHERE name ILIKE 'CODELCO';
  SELECT id INTO v_id_telemining FROM company WHERE name ILIKE 'Telemining';
  SELECT id INTO v_id_zublin     FROM company WHERE name ILIKE 'Zublin';
  SELECT id INTO v_id_salfa      FROM company WHERE name ILIKE 'Salfa';

  SELECT COUNT(*) INTO v_current_count FROM person;
  v_to_create := GREATEST(0, 500 - v_current_count);

  WITH
  male_first_names AS (
    SELECT unnest(ARRAY[
      'Agustín','Alan','Alberto','Alejandro','Alfonso','Alfredo','Álvaro','Amaro','Américo','Andrés',
      'Antonio','Ariel','Arturo','Axel','Bastián','Benjamín','Bruno','Camilo','Carlos','César',
      'Cristián','Cristóbal','Damián','David','Diego','Eduardo','Emilio','Enrique','Esteban','Felipe',
      'Fernando','Francisco','Gabriel','Gaspar','Germán','Gonzalo','Guillermo','Gustavo','Héctor','Hernán',
      'Hugo','Ian','Ignacio','Ismael','Iván','Javier','Jerónimo','Joaquín','Jorge','José',
      'Juan','Julián','Kevin','Lautaro','Leandro','Leonardo','Lucas','Luis','Manuel','Marcelo',
      'Marco','Marcos','Mario','Martín','Matías','Maximiliano','Miguel','Nicolás','Octavio','Óscar',
      'Pablo','Patricio','Pedro','Rafael','Ramiro','Raúl','Ricardo','Rodrigo','Rubén','Samuel',
      'Santiago','Sebastián','Sergio','Simón','Tomás','Valentín','Vicente','Víctor'
    ]) AS fn
  ),
  female_first_names AS (
    SELECT unnest(ARRAY[
      'Abril','Agustina','Ainhoa','Alba','Alejandra','Alicia','Amanda','Amelia','Ana','Andrea',
      'Ángela','Antonella','Antonia','Ariana','Astrid','Bárbara','Beatriz','Belén','Camila','Carla',
      'Carolina','Catalina','Cecilia','Celeste','Claudia','Constanza','Daniela','Débora','Dominga','Elena',
      'Elisa','Emilia','Emma','Erika','Estefanía','Eugenia','Eva','Fabiola','Fernanda','Florencia',
      'Francisca','Gabriela','Gloria','Graciela','Inés','Isabel','Isidora','Ivana','Javiera','Jessica',
      'Josefa','Julieta','Karla','Karen','Katherine','Laura','Leticia','Lorena','Lucía','Magdalena',
      'Manuela','Marcela','María','Mariana','Martina','Melanie','Micaela','Monserrat','Natalia','Nicole',
      'Olivia','Paloma','Pamela','Paola','Patricia','Paulina','Pía','Priscila','Rafaela','Renata',
      'Rocío','Romina','Rosario','Sabrina','Sofía','Tamara','Teresa','Trinidad','Valentina','Valeria',
      'Vanesa','Verónica','Violeta','Ximena'
    ]) AS fn
  ),
  last_names AS (
    SELECT unnest(ARRAY[
      'Pérez','González','Muñoz','Rojas','Díaz','Contreras','Silva','Martínez','Sepúlveda','Morales',
      'Rodríguez','López','Fuentes','Hernández','Torres','Castillo','Flores','Espinoza','Valenzuela','Vargas',
      'Soto','Rivera','Cortés','Navarro','Reyes','Bravo','Gutiérrez','Carrasco','Pino','Rivas',
      'Olivares','Tapia','Sandoval','Cifuentes','Figueroa','Campos','Saavedra','Vergara','Orellana','Salinas',
      'Gallardo','Cisternas','Lagos'
    ]) AS ln
  ),
  name_pool AS (
    SELECT
      fn,
      ln1 AS last_name_1,
      ln2 AS last_name_2,
      (fn || ' ' || ln1 || ' ' || ln2) AS full_name,
      md5(fn || '|' || ln1 || '|' || ln2) AS sort_key
    FROM (
      SELECT fn FROM male_first_names
      UNION ALL
      SELECT fn FROM female_first_names
    ) f
    CROSS JOIN last_names l1(ln1)
    CROSS JOIN last_names l2(ln2)
    WHERE l1.ln1 <> l2.ln2
  ),
  candidates AS (
    SELECT row_number() OVER (ORDER BY sort_key) AS rn, fn, last_name_1, last_name_2, full_name
    FROM name_pool
  ),
  to_insert AS (
    SELECT rn, fn, last_name_1, last_name_2, full_name
    FROM candidates
    WHERE rn > v_current_count
    LIMIT v_to_create
  )
  INSERT INTO person (company_id, rut, full_name, first_name, last_name, active)
  SELECT
    CASE
      WHEN t.rn <= CEIL(v_to_create * 0.10) THEN v_id_telemining
      WHEN t.rn <= CEIL(v_to_create * 0.60) THEN v_id_codelco
      WHEN t.rn <= CEIL(v_to_create * 0.80) THEN v_id_zublin
      ELSE v_id_salfa
    END AS company_id,
    ((10000000 + (t.rn + v_current_count))::TEXT || '-' || (((t.rn + v_current_count) % 10)::TEXT)) AS rut,
    t.full_name,
    t.fn AS first_name,
    (t.last_name_1 || ' ' || t.last_name_2) AS last_name,
    TRUE
  FROM to_insert t
  WHERE NOT EXISTS (SELECT 1 FROM person p WHERE p.full_name = t.full_name);

END $$;

-- ============================================================
-- 3) COMPLETAR VEH°CULOS HASTA 200 (PATENTE REAL + TIPO MINERO)
-- ============================================================
DO $$
DECLARE
  v_current_count INT;
  v_to_create INT;
  veh_id BIGINT;
  comp_id BIGINT;

  vehicle_types TEXT[] := ARRAY[
    'acunador','acunador',
    'ampliroll','ampliroll',
    'aljibe',
    'tolva','tolva','tolva','tolva','tolva','tolva',
    'plano',
    'alzahombre','alzahombre',
    'eperforacion',
    'excavadora','excavadora','excavadora','excavadora',
    'jumbo1',
    'jumbo2','jumbo2','jumbo2',
    'jumboe',
    'lhd','lhd','lhd','lhd',
    'manitou','manitou','manitou','manitou','manitou','manitou','manitou','manitou','manitou','manitou','manitou','manitou','manitou',
    'mcargador',
    'mixer','mixer','mixer','mixer',
    'motoniveladora',
    'cexplosivo','cexplosivo',
    'roboshot','roboshot',
    'camioneta','camioneta','camioneta','camioneta','camioneta','camioneta','camioneta','camioneta','camioneta','camioneta',
    'camioneta','camioneta','camioneta','camioneta','camioneta','camioneta','camioneta','camioneta','camioneta'
  ];

  prefixes TEXT[] := ARRAY['AB','AC','AD','AE','AF','AG','AH','AJ','AK','AL','AM','AN','AP','AR','AS','AT','AU','AV','AX','BA','BB','BC'];

  tipo TEXT;
  pref TEXT;
  num INT;
  patente_gen TEXT;
  len_types INT;
  len_pref INT;
BEGIN
  SELECT COUNT(*) INTO v_current_count FROM vehicles;
  v_to_create := GREATEST(0, 200 - v_current_count);

  len_types := array_length(vehicle_types, 1);
  len_pref  := array_length(prefixes, 1);

  FOR i IN 1..v_to_create LOOP
    tipo := vehicle_types[((i - 1) % len_types) + 1];

    pref := prefixes[(((v_current_count + i - 1) / 900) % len_pref) + 1];
    num  := 100 + ((v_current_count + i - 1) % 900);        -- 100..999
    patente_gen := pref || lpad(num::text, 3, '0');          -- AB100...

    INSERT INTO vehicles (patente, status, level)
    VALUES (patente_gen, tipo, 1)
    RETURNING id INTO veh_id;

    IF random() < 0.33 THEN comp_id := (SELECT id FROM company WHERE name='CODELCO');
    ELSIF random() < 0.66 THEN comp_id := (SELECT id FROM company WHERE name='Telemining');
    ELSE comp_id := (SELECT id FROM company WHERE name='Zublin');
    END IF;

    INSERT INTO vehicle_company (vehicle_id, company_id, active)
    VALUES (veh_id, comp_id, TRUE);
  END LOOP;
END $$;

-- ============================================================
-- 3.1) EQUIPOS/HERRAMIENTAS CARAS (NO VEH°CULOS)
--      - equipment_type: CRIT
--      - equipment: herramientas de alto valor (50)
-- ============================================================
INSERT INTO equipment_type (code, name, description)
VALUES ('CRIT', 'Herramientas críticas', 'Herramientas y equipos de alto valor (trazabilidad por pórticos)')
ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE
  v_id_crit       BIGINT;
  v_id_codelco    BIGINT;
  v_id_telemining BIGINT;
  v_id_zublin     BIGINT;
  v_id_salfa      BIGINT;

  v_current_count INT;
  v_to_create     INT;
  v_total_target  INT := 50;

  v_company_id BIGINT;
  v_seq INT;
  v_name TEXT;
  v_code TEXT;

  -- Rotación de herramientas caras
  tool_names TEXT[] := ARRAY[
    'Fusionadora de Fibra Óptica Fujikura',
    'OTDR EXFO',
    'Medidor de Potencia Óptica',
    'Microscopio Inspección Conectores FO',
    'Fluke Networks Certificador',
    'Analizador de Vibraciones SKF',
    'Cámara Termográfica FLIR',
    'Detector Multigás Industrial',
    'Luxómetro Profesional',
    'Sonómetro Clase 1',
    'Tacómetro Láser',
    'Torquímetro Digital',
    'Taladro Hilti TE-60',
    'Taladro Hilti TE-80',
    'Martillo Demoledor Hilti TE-3000',
    'Esmeril Angular Makita 7in',
    'Soldadora Inverter 200A',
    'Planta Soldadora MIG 250A',
    'Generador 15kVA',
    'Compresor Atlas Copco XR',
    'Bomba de Agua 3in',
    'Bomba de Lodos',
    'GPS RTK Topografía',
    'Estación Total Topográfica',
    'Nivel Láser Rotativo',
    'Dron DJI Enterprise',
    'Cámara Endoscópica Industrial',
    'Medidor de Aislamiento (Megóhmetro)',
    'Pinza Amperimétrica TRMS',
    'Osciloscopio Portátil',
    'Analizador de Calidad de Energía',
    'Medidor de Espesor Ultrasonido'
  ];

BEGIN
  SELECT id INTO v_id_crit FROM equipment_type WHERE code = 'CRIT';

  SELECT id INTO v_id_codelco    FROM company WHERE name ILIKE 'CODELCO';
  SELECT id INTO v_id_telemining FROM company WHERE name ILIKE 'Telemining';
  SELECT id INTO v_id_zublin     FROM company WHERE name ILIKE 'Zublin';
  SELECT id INTO v_id_salfa      FROM company WHERE name ILIKE 'Salfa';

  SELECT COUNT(*) INTO v_current_count FROM equipment;
  v_to_create := GREATEST(0, v_total_target - v_current_count);

  IF v_to_create = 0 THEN
    RETURN;
  END IF;

  FOR i IN 1..v_to_create LOOP
    IF i <= CEIL(v_to_create * 0.40) THEN
      v_company_id := v_id_codelco;
    ELSIF i <= CEIL(v_to_create * 0.70) THEN
      v_company_id := v_id_telemining;
    ELSIF i <= CEIL(v_to_create * 0.85) THEN
      v_company_id := v_id_zublin;
    ELSE
      v_company_id := v_id_salfa;
    END IF;

    v_seq := v_current_count + i;

    v_name := tool_names[((i - 1) % array_length(tool_names, 1)) + 1] || ' ' || lpad(v_seq::text, 3, '0');
    v_code := 'TOOL-' || lpad(v_seq::text, 3, '0');

    INSERT INTO equipment (
      equipment_type_id,
      company_id,
      code,
      name,
      description,
      critical
    )
    VALUES (
      v_id_crit,
      v_company_id,
      v_code,
      v_name,
      'Herramienta de alto valor (demo funcional con trazabilidad por pórticos)',
      TRUE
    );
  END LOOP;
END $$;

-- ============================================================
-- 4) TAGS + ASIGNACIONES (person / vehicle / equipment)
--    - SIN LIKE: mapeo por split_part(code,'-',2)::bigint
-- ============================================================

-- 4.1 PERSONAS
WITH missing_person AS (
  SELECT p.id, p.full_name
  FROM person p
  WHERE NOT EXISTS (
    SELECT 1 FROM tag_assignment a
    WHERE a.entity_type = 'person'
      AND a.entity_id = p.id
  )
),
ins_person_tag AS (
  INSERT INTO tag (code)
  SELECT 'PERS-' || mp.id || '-' || gen_random_uuid()
  FROM missing_person mp
  RETURNING id, code
)
INSERT INTO tag_assignment (tag_id, entity_type, entity_id, display_name, active)
SELECT
  t.id,
  'person',
  split_part(t.code, '-', 2)::bigint AS entity_id,
  mp.full_name,
  TRUE
FROM ins_person_tag t
JOIN missing_person mp
  ON mp.id = split_part(t.code, '-', 2)::bigint;

-- 4.2 VEH°CULOS
WITH missing_vehicle AS (
  SELECT v.id, v.patente, v.status
  FROM vehicles v
  WHERE NOT EXISTS (
    SELECT 1 FROM tag_assignment a
    WHERE a.entity_type = 'vehicle'
      AND a.entity_id = v.id
  )
),
ins_vehicle_tag AS (
  INSERT INTO tag (code)
  SELECT 'VEH-' || mv.id || '-' || gen_random_uuid()
  FROM missing_vehicle mv
  RETURNING id, code
)
INSERT INTO tag_assignment (tag_id, entity_type, entity_id, display_name, active)
SELECT
  t.id,
  'vehicle',
  split_part(t.code, '-', 2)::bigint AS entity_id,
  (mv.status || ' ' || mv.patente),
  TRUE
FROM ins_vehicle_tag t
JOIN missing_vehicle mv
  ON mv.id = split_part(t.code, '-', 2)::bigint;

-- 4.3 EQUIPOS/HERRAMIENTAS
WITH missing_equipment AS (
  SELECT e.id, e.name, e.code
  FROM equipment e
  WHERE NOT EXISTS (
    SELECT 1 FROM tag_assignment a
    WHERE a.entity_type = 'equipment'
      AND a.entity_id = e.id
  )
),
ins_equipment_tag AS (
  INSERT INTO tag (code)
  SELECT 'EQUIP-' || me.id || '-' || gen_random_uuid()
  FROM missing_equipment me
  RETURNING id, code
)
INSERT INTO tag_assignment (tag_id, entity_type, entity_id, display_name, active)
SELECT
  t.id,
  'equipment',
  split_part(t.code, '-', 2)::bigint AS entity_id,
  (me.name || ' (' || me.code || ')'),
  TRUE
FROM ins_equipment_tag t
JOIN missing_equipment me
  ON me.id = split_part(t.code, '-', 2)::bigint;


-- ============================================================
-- 5.5) VARIABLES + CFG DE CLIMA PARA P?"RTICOS "CLIMA"
--   - Crea TEMP / HUM / WIND si no existen
--   - Crea cfg para cada p?rtico clima (si no existe)
-- ============================================================

-- 5.5.1) Asegurar variables de clima
INSERT INTO access_climate_var (code, name, unit)
VALUES
  ('TEMP', 'Temperatura', '°C'),
  ('HUM',  'Humedad', '%'),
  ('WIND', 'Viento', 'm/s')
ON CONFLICT (code) DO NOTHING;

-- 5.5.2) Crear CFG por p?rtico clima y variable (TEMP/HUM/WIND)
INSERT INTO access_portico_climate_cfg (portico_id, climate_var_id, green_max, yellow_max, active)
SELECT
  ap.id,
  cv.id,
  CASE cv.code
    WHEN 'TEMP' THEN 26.0   -- Verde hasta 26°C
    WHEN 'HUM'  THEN 60.0   -- Verde hasta 60%
    WHEN 'WIND' THEN 8.0    -- Verde hasta 8 m/s
  END AS green_max,
  CASE cv.code
    WHEN 'TEMP' THEN 28.0   -- Amarillo hasta 28°C (sobre eso rojo)
    WHEN 'HUM'  THEN 75.0   -- Amarillo hasta 75%
    WHEN 'WIND' THEN 12.0   -- Amarillo hasta 12 m/s
  END AS yellow_max,
  TRUE AS active
FROM access_portico ap
JOIN access_climate_var cv
  ON cv.code IN ('TEMP','HUM','WIND')
WHERE ap.name ILIKE '%CLIMA%'
  AND ap.active = TRUE
  AND NOT EXISTS (
    SELECT 1
    FROM access_portico_climate_cfg cfg
    WHERE cfg.portico_id = ap.id
      AND cfg.climate_var_id = cv.id
  );

-- ============================================================
-- 6) GENERAR CLIMA (3??"10 MIN) HASTA AHORA
--   - Genera lecturas "realistas" y forzamos mezcla de niveles
--   - Calcula level seg?n cfg (green/yellow/red)
-- ============================================================
DO $$
DECLARE
  rec_cfg RECORD;
  v_ts    TIMESTAMPTZ;
  v_start TIMESTAMPTZ := date_trunc('day', now());
  v_end   TIMESTAMPTZ := now();

  v_val NUMERIC(10,3);
  v_lvl TEXT;
  step  INT;

  -- helpers para forzar variación (no todo verde)
  roll NUMERIC;
BEGIN
  FOR rec_cfg IN
    SELECT cfg.portico_id, cfg.climate_var_id, cv.code, cfg.green_max, cfg.yellow_max
    FROM access_portico_climate_cfg cfg
    JOIN access_climate_var cv ON cv.id = cfg.climate_var_id
    WHERE cfg.active = TRUE
  LOOP
    v_ts := v_start;

    WHILE v_ts < v_end LOOP
      -- roll define si cae en verde/amarillo/rojo con cierta probabilidad
      roll := random();

      IF rec_cfg.code = 'TEMP' THEN
        -- 65% verde, 25% amarillo, 10% rojo
        IF roll < 0.65 THEN
          v_val := (rec_cfg.green_max - 3) + random() * 3;                     -- 23..26 aprox
        ELSIF roll < 0.90 THEN
          v_val := (rec_cfg.green_max + 0.1) + random() * (rec_cfg.yellow_max - rec_cfg.green_max - 0.1);
        ELSE
          v_val := (rec_cfg.yellow_max + 0.2) + random() * 4;                 -- > yellow (rojo)
        END IF;

      ELSIF rec_cfg.code = 'HUM' THEN
        -- 60% verde, 30% amarillo, 10% rojo
        IF roll < 0.60 THEN
          v_val := 40 + random() * (rec_cfg.green_max - 40);                  -- 40..60
        ELSIF roll < 0.90 THEN
          v_val := (rec_cfg.green_max + 0.1) + random() * (rec_cfg.yellow_max - rec_cfg.green_max - 0.1);
        ELSE
          v_val := (rec_cfg.yellow_max + 0.2) + random() * 15;                -- 75..90
        END IF;

      ELSE
        -- WIND: 70% verde, 20% amarillo, 10% rojo
        IF roll < 0.70 THEN
          v_val := 2 + random() * (rec_cfg.green_max - 2);                    -- 2..8
        ELSIF roll < 0.90 THEN
          v_val := (rec_cfg.green_max + 0.1) + random() * (rec_cfg.yellow_max - rec_cfg.green_max - 0.1);
        ELSE
          v_val := (rec_cfg.yellow_max + 0.2) + random() * 8;                 -- 12..20
        END IF;
      END IF;

      -- calcular nivel por umbrales cfg
      IF v_val <= rec_cfg.green_max THEN
        v_lvl := 'green';
      ELSIF v_val <= rec_cfg.yellow_max THEN
        v_lvl := 'yellow';
      ELSE
        v_lvl := 'red';
      END IF;

      INSERT INTO access_portico_climate_reading (portico_id, climate_var_id, ts, value, level)
      VALUES (rec_cfg.portico_id, rec_cfg.climate_var_id, v_ts, v_val, v_lvl);

      -- paso random 3..10 minutos
      step := 3 + floor(random()*8);
      v_ts := v_ts + make_interval(mins => step);
    END LOOP;
  END LOOP;
END $$;

COMMIT;


-- ------------------------------------------------------------
-- Datos GENERADOS (solo demo) para gráficos de Productividad
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS zenit_transfers_generated (
  id bigserial PRIMARY KEY,
  day timestamptz NOT NULL,
  from_portico text,
  to_portico text,
  minutes integer NOT NULL DEFAULT 0,
  nivel integer,
  portico_code text
);

CREATE TABLE IF NOT EXISTS zenit_vehicle_laps_generated (
  id bigserial PRIMARY KEY,
  day timestamptz NOT NULL,
  vehicle_id integer,
  vehicle_name text,
  laps integer NOT NULL DEFAULT 0,
  nivel integer,
  portico_code text
);

CREATE TABLE IF NOT EXISTS zenit_crew_productive_time_generated (
  id bigserial PRIMARY KEY,
  day timestamptz NOT NULL,
  crew_name text,
  zone_name text,
  productive_minutes integer NOT NULL DEFAULT 0,
  nivel integer,
  portico_code text
);

-- Seed: usa la fecha 'hoy' definida en este script (si existe), o NOW()
INSERT INTO zenit_transfers_generated (day, from_portico, to_portico, minutes, nivel, portico_code)
SELECT NOW() - interval '2 hours', 'UR NP-01', 'UR NP-02', 12, 1, 'UR NP-02'
WHERE NOT EXISTS (SELECT 1 FROM zenit_transfers_generated);

INSERT INTO zenit_vehicle_laps_generated (day, vehicle_id, vehicle_name, laps, nivel, portico_code)
SELECT NOW()::date, 101, 'CA-101', 7, 1, 'UR NP-01'
WHERE NOT EXISTS (SELECT 1 FROM zenit_vehicle_laps_generated);

INSERT INTO zenit_vehicle_laps_generated (day, vehicle_id, vehicle_name, laps, nivel, portico_code)
SELECT NOW()::date, 202, 'CA-202', 5, 1, 'UR NP-02'
WHERE NOT EXISTS (SELECT 1 FROM zenit_vehicle_laps_generated WHERE vehicle_id=202);

INSERT INTO zenit_crew_productive_time_generated (day, crew_name, zone_name, productive_minutes, nivel, portico_code)
SELECT NOW()::date, 'Cuadrilla A', 'Zona NP', 320, 1, 'UR NP-01'
WHERE NOT EXISTS (SELECT 1 FROM zenit_crew_productive_time_generated);

INSERT INTO zenit_crew_productive_time_generated (day, crew_name, zone_name, productive_minutes, nivel, portico_code)
SELECT NOW()::date, 'Cuadrilla B', 'Zona UCL', 280, 1, 'UR UCL-01'
WHERE NOT EXISTS (SELECT 1 FROM zenit_crew_productive_time_generated WHERE crew_name='Cuadrilla B');


/* =========================================================
   T°CTICO (DEMO REALISTA) - tablas del modelo
   ========================================================= */

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

-- Seed (un d?a, 3 niveles / sectores) - evita "Sin datos" en Táctico
INSERT INTO zenit_tactical_camera_availability_generated (day, nivel, online, offline, mantenimiento)
SELECT NOW()::date, 1, 12, 2, 1
WHERE NOT EXISTS (SELECT 1 FROM zenit_tactical_camera_availability_generated);

INSERT INTO zenit_tactical_camera_availability_generated (day, nivel, online, offline, mantenimiento)
SELECT NOW()::date, 2, 8, 1, 0
WHERE NOT EXISTS (SELECT 1 FROM zenit_tactical_camera_availability_generated WHERE nivel=2);

INSERT INTO zenit_tactical_camera_alerts_generated (day, nivel, tipo, cantidad)
SELECT NOW()::date, 1, 'Intrusión', 3
WHERE NOT EXISTS (SELECT 1 FROM zenit_tactical_camera_alerts_generated);

INSERT INTO zenit_tactical_camera_alerts_generated (day, nivel, tipo, cantidad)
SELECT NOW()::date, 1, 'PPE', 1
WHERE NOT EXISTS (SELECT 1 FROM zenit_tactical_camera_alerts_generated WHERE tipo='PPE');

INSERT INTO zenit_tactical_seismic_daily_energy_generated (day, sector, energia)
SELECT NOW()::date, 'NP', 12.5
WHERE NOT EXISTS (SELECT 1 FROM zenit_tactical_seismic_daily_energy_generated);

INSERT INTO zenit_tactical_seismic_daily_energy_generated (day, sector, energia)
SELECT NOW()::date, 'UCL', 7.2
WHERE NOT EXISTS (SELECT 1 FROM zenit_tactical_seismic_daily_energy_generated WHERE sector='UCL');

INSERT INTO zenit_tactical_seismic_events_by_sector_generated (day, sector, eventos)
SELECT NOW()::date, 'NP', 4
WHERE NOT EXISTS (SELECT 1 FROM zenit_tactical_seismic_events_by_sector_generated);

INSERT INTO zenit_tactical_seismic_events_by_sector_generated (day, sector, eventos)
SELECT NOW()::date, 'UCL', 2
WHERE NOT EXISTS (SELECT 1 FROM zenit_tactical_seismic_events_by_sector_generated WHERE sector='UCL');


-- ================= SISTEMA =================

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
   NORMALIZACI?"N site_code / point_type / zone (DATA FIX)
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
   SEED M?NIMO UR / SENSORES / VEH°CULOS
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
   SEED M?NIMO PARA DASHBOARD (ACCESS_EVENT)
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
   SEED TIPOS DE P?"RTICO Y VARIABLES DE CLIMA
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



-- ================= TAGS ====================

/* ============================================================
   1) EMPRESAS
   ============================================================ */

INSERT INTO company (name, rut, address, phone, email)
VALUES 
('CODELCO', '61.704.000-0', 'Av. Minera Norte 123', '+56 2 2750 1000', 'contacto@codelco.cl'),
('Telemining', '76.999.333-1', 'Av. Apoquindo 4500', '+56 2 2980 2010', 'info@telemining.cl')
ON CONFLICT DO NOTHING;


/* ============================================================
   2) TIPOS DE EQUIPO Y EQUIPOS CR?TICOS
   ============================================================ */

INSERT INTO equipment_type (code, name, description)
VALUES ('CRIT', 'Equipamiento Crítico', 'Equipos que deben ser monitoreados 24/7')
ON CONFLICT (code) DO NOTHING;

INSERT INTO equipment (equipment_type_id, company_id, code, name, description, critical)
SELECT et.id, c.id,
       CONCAT('EQ-', i),
       CONCAT('Equipo crítico ', i),
       'Equipo crítico industrial',
       TRUE
FROM equipment_type et, company c, generate_series(1,5) AS s(i)
WHERE et.code='CRIT' AND c.name='CODELCO'
  AND NOT EXISTS (SELECT 1 FROM equipment);


/* ============================================================
   3) PERSONAS (50 nombres latinos)
   ============================================================ */

INSERT INTO person (company_id, rut, full_name, first_name, last_name, phone)
SELECT 
  (SELECT id FROM company WHERE name='CODELCO'),
  CONCAT(FLOOR(RANDOM()*20000000)::text,'-', (FLOOR(RANDOM()*9))::text),
  full_name,
  split_part(full_name,' ',1),
  split_part(full_name,' ',2),
  CONCAT('+56 9 7', FLOOR(RANDOM()*1000000)::text)
FROM (VALUES
('Juan Pérez'),
('María González'),
('Carlos Díaz'),
('Francisca Muñoz'),
('Ricardo Torres'),
('Claudio Soto'),
('Andrés Fuentes'),
('Camila Rojas'),
('Tomás Valenzuela'),
('Daniela Arriagada'),
('Felipe Cisternas'),
('Javiera Lagos'),
('Marcelo Contreras'),
('Rodrigo Salinas'),
('Sebastián Herrera'),
('Natalia Cornejo'),
('Diego Mena'),
('Paula Fernández'),
('Constanza Saavedra'),
('Mauricio Hidalgo'),
('Cristóbal Sepúlveda'),
('Alejandra Bravo'),
('Gonzalo Vásquez'),
('Lucía Araya'),
('Matías Pardo'),
('Valentina Jofré'),
('Ignacio Barros'),
('Trinidad Correa'),
('Benjamín Navarro'),
('Josefa Arévalo'),
('Pablo Cáceres'),
('Isidora Palma'),
('Leandro Castillo'),
('Camilo Riveros'),
('Tamara Bustamante'),
('Miguel Carrasco'),
('Roxana Pino'),
('Hernán Rivas'),
('Carolina Olivares'),
('Jorge Tapia'),
('Reinaldo Riffo'),
('Nicole Vargas'),
('Patricio Sandoval'),
('Yasna Cifuentes'),
('Cristian Figueroa'),
('Lorena Avendaño'),
('Fabián Alarcón'),
('Pedro Morales'),
('Andrea Venegas')
) AS t(full_name)
WHERE NOT EXISTS (SELECT 1 FROM person);


/* ============================================================
   4) VEH°CULOS (20 camionetas/camiones)
   ============================================================ */

-- Vehículos
-- (70 vehículos demo: tipo minero en "status" + patente AB101..AB170)
WITH types AS (
    SELECT tipo, rn
    FROM unnest(ARRAY[
        'acunador','acunador',
        'ampliroll','ampliroll',
        'aljibe',
        'tolva','tolva','tolva','tolva','tolva','tolva',
        'plano',
        'alzahombre','alzahombre',
        'eperforacion',
        'excavadora','excavadora','excavadora','excavadora',
        'jumbo1',
        'jumbo2','jumbo2','jumbo2',
        'jumboe',
        'lhd','lhd','lhd','lhd',
        'manitou','manitou','manitou','manitou','manitou','manitou','manitou','manitou','manitou','manitou','manitou','manitou','manitou',
        'mcargador',
        'mixer','mixer','mixer','mixer',
        'motoniveladora',
        'cexplosivo','cexplosivo',
        'roboshot','roboshot',
        'camioneta','camioneta','camioneta','camioneta','camioneta','camioneta','camioneta','camioneta','camioneta','camioneta',
        'camioneta','camioneta','camioneta','camioneta','camioneta','camioneta','camioneta','camioneta','camioneta'
    ]) WITH ORDINALITY AS t(tipo, rn)
),
pats AS (
    SELECT
        ('AB' || lpad(gs::text, 3, '0')) AS patente,
        row_number() OVER () AS rn
    FROM generate_series(101, 170) gs
)
INSERT INTO vehicles (patente, status, level)
SELECT
    p.patente,
    t.tipo,
    (random()*3)::int AS level
FROM pats p
JOIN types t USING (rn)
WHERE NOT EXISTS (SELECT 1 FROM vehicles);

INSERT INTO vehicle_company (vehicle_id, company_id)
SELECT v.id, (SELECT id FROM company WHERE name='CODELCO')
FROM vehicles v
LEFT JOIN vehicle_company vc ON vc.vehicle_id=v.id
WHERE vc.vehicle_id IS NULL;


/* ============================================================
   5.0) TIPOS DE P?"RTICO Y GATEWAYS DEMO
   ============================================================ */

-- Tipos de p?rtico base
INSERT INTO access_portico_type (code, name, description)
VALUES
  ('BASIC',   'Pórtico Básico',    'Pórtico sin clima'),
  ('CLIMATE', 'Pórtico con clima', 'Pórtico con sensores de clima')
ON CONFLICT (code) DO NOTHING;

-- 10 gateways de prueba
INSERT INTO gateway (name)
SELECT CONCAT('GW_', i)
FROM generate_series(1,10) AS s(i)
ON CONFLICT DO NOTHING;


/* ============================================================
   5) P?"RTICOS (10 totales, 3 con clima)
   ============================================================ */

-- Opcional: limpia pórticos de demo
DELETE FROM access_portico_climate_reading;
DELETE FROM access_portico_climate_cfg;
DELETE FROM access_portico;

INSERT INTO access_portico (
    gateway_id,
    map_point_id,
    name,
    specific_name,
    street_name,
    trench_name,
    site,
    nivel,
    site_code,
    zone,
    portico_type_id,
    display_shape,
    has_climate
)
SELECT
    -- 1 gateway por p?rtico: GW_1 ??' 1, GW_2 ??' 2, etc.
    (SELECT id
     FROM gateway
     ORDER BY id
     LIMIT 1 OFFSET (i - 1))                          AS gateway_id,
    NULL                                              AS map_point_id,

    -- Nombre visible (con n?mero)
    CASE i
        WHEN 1 THEN '1.-SOC. ACC RAMPA NP'
        WHEN 2 THEN '2.-SOC. ACC RAMPA NH'
        WHEN 3 THEN '3.-Estocada 2 RAMPA NP'
        WHEN 4 THEN '4.-Calle 12 Zanja 2'
        WHEN 5 THEN '5.-Calle 12 Zanja 4'
        WHEN 6 THEN '6.-Calle 9 Zanja 5'
        WHEN 7 THEN '7.-Calle 17 Zanja 5'
        WHEN 8 THEN '8.-NP Cabecera HW - Z 25'
        WHEN 9 THEN '9.-Estocada ACC Norte CD2'
        WHEN 10 THEN '10.-CD ADIT 77'
    END                                               AS name,

    -- Nombre espec?fico
    CASE i
        WHEN 1 THEN 'SOC. ACC RAMPA NP'
        WHEN 2 THEN 'SOC. ACC RAMPA NH'
        WHEN 3 THEN 'Estocada 2 RAMPA NP'
        WHEN 4 THEN 'Calle 12 Zanja 2'
        WHEN 5 THEN 'Calle 12 Zanja 4'
        WHEN 6 THEN 'Calle 9 Zanja 5'
        WHEN 7 THEN 'Calle 17 Zanja 5'
        WHEN 8 THEN 'NP Cabecera HW - Z 25'
        WHEN 9 THEN 'Estocada ACC Norte CD2'
        WHEN 10 THEN 'CD ADIT 77'
    END                                               AS specific_name,

    -- Calle
    CASE i
        WHEN 1 THEN 'SOC. ACC'
        WHEN 2 THEN 'SOC. ACC'
        WHEN 3 THEN 'Estocada 2'
        WHEN 4 THEN 'Calle 12'
        WHEN 5 THEN 'Calle 12'
        WHEN 6 THEN 'Calle 9'
        WHEN 7 THEN 'Calle 17'
        WHEN 8 THEN 'NP Cabecera'
        WHEN 9 THEN 'Estocada ACC'
        WHEN 10 THEN 'CD'
    END                                               AS street_name,

    -- Zanja / referencia
    CASE i
        WHEN 1 THEN 'RAMPA NP'
        WHEN 2 THEN 'RAMPA NH'
        WHEN 3 THEN 'RAMPA NP'
        WHEN 4 THEN 'Zanja 2'
        WHEN 5 THEN 'Zanja 4'
        WHEN 6 THEN 'Zanja 5'
        WHEN 7 THEN 'Zanja 5'
        WHEN 8 THEN 'HW - Z 25'
        WHEN 9 THEN 'Norte CD2'
        WHEN 10 THEN 'ADIT 77'
    END                                               AS trench_name,

    'Mina Central'                                    AS site,
    'NP'                                              AS nivel,
    'NP_MC'                                           AS site_code,

    -- Zona l?gica (para filtros)
    CASE i
        WHEN 1 THEN 'Zona_1'
        WHEN 2 THEN 'Zona_2'
        WHEN 3 THEN 'Zona_3'
        WHEN 4 THEN 'Zona_4'
        WHEN 5 THEN 'Zona_5'
        WHEN 6 THEN 'Zona_6'
        WHEN 7 THEN 'Zona_7'
        WHEN 8 THEN 'Zona_8'
        WHEN 9 THEN 'Zona_9'
        WHEN 10 THEN 'Zona_10'
    END                                               AS zone,

    -- Tipo de p?rtico: clima en 8, 9 y 10
    CASE
        WHEN i IN (8,9,10)
            THEN (SELECT id FROM access_portico_type WHERE code = 'CLIMATE')
        ELSE
            (SELECT id FROM access_portico_type WHERE code = 'BASIC')
    END                                               AS portico_type_id,

    -- Forma y flag clima
    CASE WHEN i IN (8,9,10) THEN 'square' ELSE 'circle' END AS display_shape,
    CASE WHEN i IN (8,9,10) THEN TRUE     ELSE FALSE   END AS has_climate

FROM generate_series(1,10) AS s(i);

/* ============================================================
   5.1) PORTICOS ANDES NORTE (16 reales para el mapa NTI)
   - Evita reutilizar ref_id del mapa NP en otro plano
   - Deja cada mapa con sus propios porticos fisicos
   ============================================================ */

INSERT INTO gateway (name)
SELECT CONCAT('GW_AN_', i)
FROM generate_series(1,16) AS s(i)
ON CONFLICT DO NOTHING;

INSERT INTO access_portico (
    gateway_id,
    map_point_id,
    name,
    specific_name,
    street_name,
    trench_name,
    site,
    nivel,
    site_code,
    zone,
    portico_type_id,
    display_shape,
    has_climate
)
SELECT
    (SELECT g.id FROM gateway g WHERE g.name = CONCAT('GW_AN_', i) ORDER BY g.id LIMIT 1),
    NULL,
    CONCAT(i, '.-Portal ', i),
    CONCAT('Portal ', i),
    'Andes Norte',
    CONCAT('Sector ', i),
    'Andes Norte',
    'NTI',
    'NTI_AN',
    CONCAT('AN_Zona_', i),
    CASE
        WHEN i IN (14,15,16)
            THEN (SELECT id FROM access_portico_type WHERE code = 'CLIMATE')
        ELSE
            (SELECT id FROM access_portico_type WHERE code = 'BASIC')
    END,
    CASE WHEN i IN (14,15,16) THEN 'square' ELSE 'circle' END,
    CASE WHEN i IN (14,15,16) THEN TRUE ELSE FALSE END
FROM generate_series(1,16) AS s(i)
WHERE NOT EXISTS (
    SELECT 1
    FROM access_portico ap
    WHERE ap.site_code = 'NTI_AN'
      AND ap.name = CONCAT(i, '.-Portal ', i)
);


/* ============================================================
   6) CONFIGURACI?"N DE CLIMA (umbrales)
   ============================================================ */

INSERT INTO access_portico_climate_cfg (portico_id, climate_var_id, green_max, yellow_max)
SELECT ap.id, cv.id, 
       CASE cv.code 
           WHEN 'TEMP' THEN 25 
           WHEN 'HUM'  THEN 60 
           WHEN 'WIND' THEN 8 
       END,
       CASE cv.code 
           WHEN 'TEMP' THEN 32 
           WHEN 'HUM'  THEN 75 
           WHEN 'WIND' THEN 12 
       END
FROM access_portico ap
JOIN access_climate_var cv ON cv.code IN ('TEMP', 'HUM', 'WIND')
WHERE ap.has_climate = TRUE
ON CONFLICT (portico_id, climate_var_id) DO NOTHING;


/* ============================================================
   7) LECTURAS DE CLIMA (3 pórticos, 5 lecturas cada uno)
   ============================================================ */

INSERT INTO access_portico_climate_reading (portico_id, climate_var_id, value, level)
SELECT 
    ap.id,
    cv.id,
    (RANDOM()*40)::numeric(10,3),
    CASE 
        WHEN RANDOM() < 0.7 THEN 'green'
        WHEN RANDOM() < 0.9 THEN 'yellow'
        ELSE 'red'
    END
FROM access_portico ap
JOIN access_climate_var cv ON cv.code IN ('TEMP', 'HUM', 'WIND')
CROSS JOIN generate_series(1,5) AS s(i)
WHERE ap.has_climate = TRUE;


/* ============================================================
   8) TAGS PARA PERSONAS Y VEH°CULOS
   ============================================================ */

-- ------------------------------------------------------------
-- 8.1  TAGs para PERSONAS  (50 tags, 1:1 con 50 personas)
-- ------------------------------------------------------------

-- Creamos 50 tags de personas y usamos solo los de esta corrida
WITH inserted_tagp AS (
    INSERT INTO tag (code)
    SELECT CONCAT('TAGP-', LPAD(i::text, 3, '0'), '-', gen_random_uuid())
    FROM generate_series(1, 50) AS gs(i)
    RETURNING id, code
),
personas_ranked AS (
    SELECT
        id,
        full_name,
        ROW_NUMBER() OVER (ORDER BY id) AS rn
    FROM person
    ORDER BY id
    LIMIT 50
),
tags_person_ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            ORDER BY split_part(code, '-', 2)::int, id
        ) AS rn
    FROM inserted_tagp
)
INSERT INTO tag_assignment (tag_id, entity_type, entity_id, display_name)
SELECT
    t.id         AS tag_id,
    'person'     AS entity_type,
    p.id         AS entity_id,
    p.full_name  AS display_name
FROM personas_ranked p
JOIN tags_person_ranked t
  ON t.rn = p.rn;

-- ------------------------------------------------------------
-- 8.1.b  Ficha extendida de personas para filtros y alertas
-- ------------------------------------------------------------
INSERT INTO person_extra (
    person_id,
    driver_license,
    driver_license_exp,
    medical_exams,
    medical_exams_exp,
    entry_type,
    entry_exp,
    site_induction,
    site_induction_exp,
    height_work_cert,
    height_work_cert_exp,
    contract_end,
    allergies,
    medical_notes,
    address,
    phone_primary,
    phone_emergency,
    emergency_contact_name,
    blood_type,
    ppe_size,
    photo_url
)
SELECT
    p.id,
    CASE (p.id % 4)::int
        WHEN 0 THEN 'A2'
        WHEN 1 THEN 'B'
        WHEN 2 THEN 'D'
        ELSE 'A4'
    END AS driver_license,
    CURRENT_DATE + ((p.id % 45)::int - 20),
    'Ocupacional mina subterranea',
    CURRENT_DATE + ((p.id % 35)::int - 12),
    CASE (p.id % 3)::int
        WHEN 0 THEN 'permanente'
        WHEN 1 THEN 'contratista'
        ELSE 'pase_visita'
    END AS entry_type,
    CURRENT_DATE + CASE (p.id % 3)::int
        WHEN 0 THEN 365 + (p.id % 120)::int
        WHEN 1 THEN (p.id % 75)::int - 18
        ELSE (p.id % 20)::int - 4
    END,
    'Induccion operacional',
    CURRENT_DATE + ((p.id % 50)::int - 15),
    CASE WHEN (p.id % 2)::int = 0 THEN 'Certificacion vigente' ELSE 'No aplica' END,
    CASE WHEN (p.id % 2)::int = 0 THEN CURRENT_DATE + ((p.id % 60)::int - 20) ELSE NULL END,
    CURRENT_DATE + CASE WHEN (p.id % 3)::int = 1 THEN (p.id % 90)::int - 25 ELSE 180 + (p.id % 90)::int END,
    CASE
        WHEN (p.id % 5)::int = 0 THEN 'Penicilina'
        WHEN (p.id % 7)::int = 0 THEN 'Polvo'
        ELSE NULL
    END,
    'Ficha demo para monitoreo de vencimientos y alertas operacionales.',
    COALESCE(p.address, 'Campamento norte'),
    COALESCE(p.phone, '+56 9 6000 ' || LPAD((p.id % 10000)::text, 4, '0')),
    COALESCE(p.emergency_phone, '+56 9 7000 ' || LPAD((p.id % 10000)::text, 4, '0')),
    split_part(p.full_name, ' ', 1) || ' Contacto',
    COALESCE(p.blood_type, (ARRAY['O+','A+','B+','AB+'])[1 + (p.id % 4)::int]),
    (ARRAY['S','M','L','XL'])[1 + (p.id % 4)::int],
    NULL
FROM person p
WHERE p.active = TRUE
ON CONFLICT (person_id) DO UPDATE
SET
    driver_license = EXCLUDED.driver_license,
    driver_license_exp = EXCLUDED.driver_license_exp,
    medical_exams = EXCLUDED.medical_exams,
    medical_exams_exp = EXCLUDED.medical_exams_exp,
    entry_type = EXCLUDED.entry_type,
    entry_exp = EXCLUDED.entry_exp,
    site_induction = EXCLUDED.site_induction,
    site_induction_exp = EXCLUDED.site_induction_exp,
    height_work_cert = EXCLUDED.height_work_cert,
    height_work_cert_exp = EXCLUDED.height_work_cert_exp,
    contract_end = EXCLUDED.contract_end,
    allergies = EXCLUDED.allergies,
    medical_notes = EXCLUDED.medical_notes,
    address = EXCLUDED.address,
    phone_primary = EXCLUDED.phone_primary,
    phone_emergency = EXCLUDED.phone_emergency,
    emergency_contact_name = EXCLUDED.emergency_contact_name,
    blood_type = EXCLUDED.blood_type,
    ppe_size = EXCLUDED.ppe_size,
    photo_url = EXCLUDED.photo_url,
    updated_at = now();


-- ------------------------------------------------------------
-- 8.2  TAGs para VEH°CULOS  (10 tags, 1:1 con 10 vehículos)
-- ------------------------------------------------------------

-- Creamos 10 tags de vehículos
-- TAGs vehículos (1:1 para TODOS los vehículos)
INSERT INTO tag (code)
SELECT 'TAGV-' || v.id || '-' || gen_random_uuid()
FROM vehicles v
WHERE NOT EXISTS (
    SELECT 1
    FROM tag_assignment a
    WHERE a.entity_type = 'vehicle'
      AND a.entity_id = v.id
);

INSERT INTO tag_assignment (tag_id, entity_type, entity_id, display_name, active)
SELECT
    t.id,
    'vehicle',
    v.id,
    concat_ws(' ', NULLIF(v.status,''), v.patente) AS display_name,   -- <-- "tipo patente"
    TRUE
FROM vehicles v
JOIN tag t
  ON t.code LIKE ('TAGV-' || v.id || '-%')
WHERE NOT EXISTS (
    SELECT 1
    FROM tag_assignment a
    WHERE a.entity_type = 'vehicle'
      AND a.entity_id = v.id
);

-- ------------------------------------------------------------
-- 8.3  Saneamiento de tags activos
--      - deja 1 asignaci?n activa por entidad
--      - prioriza la asignaci?n más reciente
-- ------------------------------------------------------------
WITH ranked_assignment AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY entity_type, entity_id
            ORDER BY created_at DESC, id DESC
        ) AS rn
    FROM tag_assignment
    WHERE active = TRUE
)
UPDATE tag_assignment ta
SET active = FALSE
FROM ranked_assignment ra
WHERE ta.id = ra.id
  AND ra.rn > 1;


/* ============================================================
   9) POL?GONOS (10 zonas configurables)
   ============================================================ */

INSERT INTO map_polygons (site, nivel, name, geojson, site_code, zone)
SELECT
    'Mina Central',
    'NP',
    CONCAT('Polígono Zona ', i),
    jsonb_build_object(
        'type','Feature',
        'geometry', jsonb_build_object(
            'type','Polygon',
            'coordinates', jsonb_build_array(
                jsonb_build_array(
                    jsonb_build_array(-71.250 + (i*0.001), -29.900),
                    jsonb_build_array(-71.240 + (i*0.001), -29.900),
                    jsonb_build_array(-71.240 + (i*0.001), -29.890),
                    jsonb_build_array(-71.250 + (i*0.001), -29.890),
                    jsonb_build_array(-71.250 + (i*0.001), -29.900)
                )
            )
        ),
        'properties', jsonb_build_object('color','#00AAFF','opacity',0.4)
    ),
    'NP_MC',
    CONCAT('Zona_', i)
FROM generate_series(1,10) AS s(i);


/* ============================================================
   10) OCUPACI?"N DE POL?GONOS
   ============================================================ */

-- La ocupaci?n se recalcula más adelante a partir de la ubicación final real
-- de personas, vehículos y equipos para evitar incoherencias en la demo.


/* ============================================================
   11) EVENTOS DE ACCESO (movimiento de tags)
   ============================================================ */

-- ------------------------------------------------------------
-- 11.1  Asignar PERSONAS a pórticos y generar eventos
--       Cada persona queda finalmente "IN" en EXACTAMENTE 1 p?rtico
-- ------------------------------------------------------------

WITH porticos AS (
    SELECT id AS portico_id, gateway_id, zone
    FROM access_portico
    WHERE active = TRUE
),
personas_tags AS (
    SELECT
        ta.tag_id,
        ta.entity_id,
        (SELECT portico_id FROM porticos ORDER BY random() LIMIT 1) AS portico_id
    FROM tag_assignment ta
    WHERE ta.entity_type = 'person'
),
personas_pos AS (
    SELECT
        pt.tag_id,
        pt.entity_id,
        ap.id         AS portico_id,
        ap.gateway_id,
        ap.zone
    FROM personas_tags pt
    JOIN access_portico ap
      ON ap.id = pt.portico_id
),

-- Historial ficticio: varias lecturas IN/OUT por persona en SU mismo p?rtico
personas_hist AS (
    INSERT INTO access_event (
        msg_id, tag_id, gateway_id, ts_edge, ts_ingested,
        zone, direction, level, kind, extra
    )
    SELECT
        gen_random_uuid(),
        pp.tag_id,
        pp.gateway_id,
        now() - (random()*'2 hours'::interval),
        now() - (random()*'2 hours'::interval),
        pp.zone,
        CASE WHEN random() > 0.5 THEN 'in' ELSE 'out' END,
        1,
        'person',
        jsonb_build_object('node', pp.portico_id)
    FROM personas_pos pp
    CROSS JOIN generate_series(1, 10)
    RETURNING 1
)

-- ?sltimo evento forzado a IN (para que aparezca en interior)
INSERT INTO access_event (
    msg_id, tag_id, gateway_id, ts_edge, ts_ingested,
    zone, direction, level, kind, extra
)
SELECT
    gen_random_uuid(),
    pp.tag_id,
    pp.gateway_id,
    now(),
    now(),
    pp.zone,
    'in',
    1,
    'person',
    jsonb_build_object('node', pp.portico_id)
FROM personas_pos pp;


-- ------------------------------------------------------------
-- 11.2  Asignar VEH°CULOS a pórticos y generar eventos
--       Cada veh?culo queda finalmente "IN" en EXACTAMENTE 1 p?rtico
-- ------------------------------------------------------------

WITH porticos AS (
    SELECT id AS portico_id, gateway_id, zone
    FROM access_portico
    WHERE active = TRUE
),
vehiculos_tags AS (
    SELECT
        ta.tag_id,
        ta.entity_id,
        (SELECT portico_id FROM porticos ORDER BY random() LIMIT 1) AS portico_id
    FROM tag_assignment ta
    WHERE ta.entity_type = 'vehicle'
),
veh_pos AS (
    SELECT
        vt.tag_id,
        vt.entity_id,
        ap.id         AS portico_id,
        ap.gateway_id,
        ap.zone
    FROM vehiculos_tags vt
    JOIN access_portico ap
      ON ap.id = vt.portico_id
),

veh_hist AS (
    INSERT INTO access_event(
        msg_id, tag_id, gateway_id, ts_edge, ts_ingested,
        zone, direction, level, kind, extra
    )
    SELECT
        gen_random_uuid(),
        vp.tag_id,
        vp.gateway_id,
        now() - (random()*'2 hours'::interval),
        now() - (random()*'2 hours'::interval),
        vp.zone,
        CASE WHEN random() > 0.5 THEN 'in' ELSE 'out' END,
        1,
        'vehicle',
        jsonb_build_object('node', vp.portico_id)
    FROM veh_pos vp
    CROSS JOIN generate_series(1, 10)
    RETURNING 1
)

INSERT INTO access_event(
    msg_id, tag_id, gateway_id, ts_edge, ts_ingested,
    zone, direction, level, kind, extra
)
SELECT
    gen_random_uuid(),
    vp.tag_id,
    vp.gateway_id,
    now(),
    now(),
    vp.zone,
    'in',
    1,
    'vehicle',
    jsonb_build_object('node', vp.portico_id)
FROM veh_pos vp;

/* =========================================================
   12) MAP_POINTS PARA HOME (P?"RTICOS + C?MARAS)
   ========================================================= */

-- 12.1) Crear puntos de mapa para cada p?rtico
-- IMPORTANTE: ajusta map_x / map_y más adelante para que calcen en la calle del plano NP_dia.jpeg

WITH base AS (
    SELECT id, name, zone
    FROM access_portico
    ORDER BY id
)
INSERT INTO map_points (
    site,
    nivel,
    site_code,
    zone,
    name,
    point_type,
    device,
    map_x,
    map_y,
    sensor
)
SELECT
    'Diamante - NP'              AS site,        -- texto que ves en el combo del Home
    'NP'                         AS nivel,
    'NP_dia'                     AS site_code,   -- coincide con selectedMap = "NP_dia"
    COALESCE(b.zone, CONCAT('Zona_', b.id)) AS zone,
    b.name                       AS name,
    'portico'                    AS point_type,
    CONCAT('PORTICO_', b.id)     AS device,
    CASE b.id
        WHEN 1  THEN 12.0
        WHEN 2  THEN 22.0
        WHEN 3  THEN 32.0
        WHEN 4  THEN 42.0
        WHEN 5  THEN 52.0
        WHEN 6  THEN 62.0
        WHEN 7  THEN 72.0
        WHEN 8  THEN 82.0
        WHEN 9  THEN 90.0
        WHEN 10 THEN 95.0
        ELSE 50.0
    END AS map_x,    -- % horizontal sobre la imagen
    CASE b.id
        WHEN 1  THEN 82.0
        WHEN 2  THEN 78.0
        WHEN 3  THEN 74.0
        WHEN 4  THEN 70.0
        WHEN 5  THEN 66.0
        WHEN 6  THEN 62.0
        WHEN 7  THEN 58.0
        WHEN 8  THEN 54.0
        WHEN 9  THEN 50.0
        WHEN 10 THEN 46.0
        ELSE 60.0
    END AS map_y,    -- % vertical sobre la imagen
    FALSE AS sensor
FROM base b
WHERE NOT EXISTS (
    SELECT 1
    FROM map_points mp
    WHERE mp.point_type = 'portico'
      AND mp.device = CONCAT('PORTICO_', b.id)
);

-- 12.2) Enlazar cada p?rtico con su map_point
UPDATE access_portico ap
SET map_point_id = mp.id
FROM map_points mp
WHERE mp.point_type = 'portico'
  AND mp.device = CONCAT('PORTICO_', ap.id)
  AND (ap.map_point_id IS NULL OR ap.map_point_id <> mp.id);


-- 12.3) Crear puntos de mapa para las cámaras (tri?ngulos)
-- Se apoyan en camera_video (ya cargado por camera_video.sql)

INSERT INTO map_points (
    site,
    nivel,
    site_code,
    zone,
    name,
    point_type,
    device,
    map_x,
    map_y,
    sensor
)
SELECT
    'Diamante - NP'          AS site,
    'NP'                     AS nivel,
    'NP_dia'                 AS site_code,
    CONCAT('Zona_cam_', cv.id) AS zone,
    cv.name                  AS name,
    'camera'                 AS point_type,
    CONCAT('CAM_', cv.id)    AS device,
    CASE cv.id
        WHEN 1 THEN 40.0
        WHEN 2 THEN 55.0
        WHEN 3 THEN 70.0
        WHEN 4 THEN 85.0
        ELSE 50.0
    END AS map_x,
    35.0 AS map_y,           -- misma altura, luego lo ajustas si quieres
    FALSE AS sensor
FROM camera_video cv
WHERE NOT EXISTS (
    SELECT 1
    FROM map_points mp
    WHERE mp.point_type = 'camera'
      AND mp.device = CONCAT('CAM_', cv.id)
);

/* =========================================================
   12) MAP_POINTS PARA HOME (P?"RTICOS + C?MARAS)
   ========================================================= */
DELETE FROM map_device
WHERE map_code = 'NP_dia';

-- ========================================================
--  P?"RTICOS NP_dia.jpeg (coordenadas calculadas desde el plano con puntos verdes)
--  8, 9 y 10: pórticos con clima (cuadrado verde)
-- ========================================================

-- P?"RTICOS SIN CLIMA (c?rculos azules)
INSERT INTO map_device (map_code, kind, ref_id, label, x_pct, y_pct) VALUES
  -- 1.- SOC. ACC RAMPA NP
  ('NP_dia', 'portico',  1, '1.-SOC. ACC RAMPA NP',        0.4485, 0.0851),

  -- 2.- SOC. ACC RAMPA NH
  ('NP_dia', 'portico',  2, '2.-SOC. ACC RAMPA NH',        0.3993, 0.1427),

  -- 3.- Estocada 2 RAMPA NP
  ('NP_dia', 'portico',  3, '3.-Estocada 2 RAMPA NP',      0.6338, 0.3347),

  -- 4.- Calle 12 Zanja 2
  ('NP_dia', 'portico',  4, '4.-Calle 12 Zanja 2',         0.7106, 0.6089),

  -- 5.- Calle 12 Zanja 4
  ('NP_dia', 'portico',  5, '5.-Calle 12 Zanja 4',         0.6916, 0.7104),

  -- 6.- Calle 9 Zanja 5
  ('NP_dia', 'portico',  6, '6.-Calle 9 Zanja 5',          0.7778, 0.7597),

  -- 7.- Calle 17 Zanja 5
  ('NP_dia', 'portico',  7, '7.-Calle 17 Zanja 5',         0.458, 0.757);

-- P?"RTICOS CON CLIMA (cuadrados verdes)
INSERT INTO map_device (map_code, kind, ref_id, label, x_pct, y_pct) VALUES
  -- 8.- NP Cabecera HW - Z 25
  ('NP_dia', 'portico_clima',  8, '8.-NP Cabecera HW - Z 25',   0.3743, 0.7515),

  -- 9.- Estocada ACC Norte CD2
  ('NP_dia', 'portico_clima',  9, '9.-Estocada ACC Norte CD2',  0.139, 0.7981),

  -- 10.- CD ADIT 77
  ('NP_dia', 'portico_clima', 10, '10.-CD ADIT 77',             0.1407, 0.9873);

-- ========================================================
--  C?MARAS IA SOBRE NP_dia (si las quieres dejar como antes)
-- ========================================================
INSERT INTO map_device (map_code, kind, ref_id, label, x_pct, y_pct) VALUES
  ('NP_dia', 'camera', 1, 'Cámara IA 1', 0.2261, 0.2085),
  ('NP_dia', 'camera', 2, 'Cámara IA 2', 0.5812, 0.2661),
  ('NP_dia', 'camera', 3, 'Cámara IA 3', 0.1993, 0.8091);

UPDATE map_device md
SET ref_id = ap.id
FROM access_portico ap
WHERE md.map_code = 'NP_dia'
  AND md.kind IN ('portico', 'portico_clima')
  AND regexp_replace(md.label, '[^[:alnum:]]+', '', 'g')
      = regexp_replace(ap.name, '[^[:alnum:]]+', '', 'g')
  AND ap.site_code = 'NP_MC';




-- ============================================================
-- 5) GENERAR MOVIMIENTO REALISTA SECUENCIAL ENTRE P?"RTICOS

UPDATE access_portico
SET active = TRUE
WHERE active IS DISTINCT FROM TRUE;

-- ============================================================
-- 5) GENERAR HISTORIAL COHERENTE POR TAG
--    - Eventos por TAG: 1..300
--    - Cada entidad queda amarrada a UN SOLO p?rtico demo
--    - Gap y permanencia: 3 min .. 7 horas (420 min)
--    - Evita multisitio / multiplano / multilugar en la precarga
-- ============================================================
DO $$
DECLARE
  rec RECORD;
  v_now TIMESTAMPTZ := now();
  v_day_start TIMESTAMPTZ := date_trunc('day', now());

  v_base_ts TIMESTAMPTZ;
  v_ts      TIMESTAMPTZ;

  p_ids   TEXT[];
  p_zones TEXT[];
  p_len   INT;

  site_codes   TEXT[];
  v_site_count INT;
  v_site_code  TEXT;

  v_visits      INT;
  v_visit_idx   INT;
  v_step_idx    INT;
  v_direction   INT;
  v_gap_mins    INT;
  v_stay_mins   INT;
  v_gateway_id  access_portico.gateway_id%TYPE;
  v_portico_id_text TEXT;
  v_zone TEXT;
BEGIN
  CREATE TEMP TABLE tmp_demo_portico_order ON COMMIT DROP AS
  SELECT
    ap.site_code,
    ap.id::text AS portico_id_text,
    ap.zone,
    ap.gateway_id,
    row_number() OVER (
      PARTITION BY ap.site_code
      ORDER BY
        COALESCE(NULLIF(substring(ap.name FROM '^([0-9]+)'), ''), '999999')::INT,
        ap.id
    ) AS ordinal
  FROM access_portico ap
  WHERE ap.gateway_id IS NOT NULL
    AND (ap.active IS DISTINCT FROM FALSE)
    AND COALESCE(ap.site_code, '') <> '';

  SELECT array_agg(site_code ORDER BY site_code)
  INTO site_codes
  FROM (
    SELECT DISTINCT site_code
    FROM tmp_demo_portico_order
  ) AS site_list;

  v_site_count := COALESCE(array_length(site_codes, 1), 0);

  IF v_site_count = 0 THEN
    RAISE EXCEPTION 'No hay access_portico con gateway_id valido. No se pueden generar movimientos.';
  END IF;

  DELETE FROM access_event;

  FOR rec IN
    SELECT ta.tag_id, ta.entity_type
    FROM tag_assignment ta
    WHERE ta.active = TRUE
  LOOP
    v_site_code := site_codes[1 + floor(random() * v_site_count)::INT];

    SELECT
      array_agg(portico_id_text ORDER BY ordinal),
      array_agg(zone ORDER BY ordinal)
    INTO p_ids, p_zones
    FROM tmp_demo_portico_order
    WHERE site_code = v_site_code;

    p_len := COALESCE(array_length(p_ids, 1), 0);
    IF p_len = 0 THEN
      CONTINUE;
    END IF;

    v_base_ts := v_day_start + (random() * INTERVAL '90 minutes');
    v_ts := v_base_ts;

    IF p_len = 1 THEN
      v_visits := 1;
    ELSIF p_len = 2 THEN
      v_visits := 2;
    ELSIF p_len = 3 THEN
      v_visits := 3;
    ELSE
      v_visits := 3 + floor(random() * (p_len - 2))::INT;
    END IF;

    v_direction := CASE WHEN random() < 0.5 THEN 1 ELSE -1 END;
    v_step_idx := CASE WHEN v_direction = 1 THEN 1 ELSE p_len END;

    FOR v_visit_idx IN 1..v_visits LOOP
      v_portico_id_text := p_ids[v_step_idx];
      v_zone := p_zones[v_step_idx];

      SELECT ap.gateway_id
      INTO v_gateway_id
      FROM access_portico ap
      WHERE ap.id::text = v_portico_id_text
      LIMIT 1;

      IF v_gateway_id IS NULL THEN
        EXIT;
      END IF;

      INSERT INTO access_event(
        msg_id, tag_id, gateway_id, ts_edge, ts_ingested,
        zone, direction, level, kind, extra
      )
      VALUES (
        gen_random_uuid(),
        rec.tag_id,
        v_gateway_id,
        v_ts,
        v_ts,
        v_zone,
        'in',
        1,
        rec.entity_type,
        jsonb_build_object(
          'portico', v_portico_id_text,
          'portico_id', v_portico_id_text,
          'site_code', v_site_code,
          'ordinal', v_step_idx
        )
      );

      IF v_visit_idx >= v_visits THEN
        EXIT;
      END IF;

      v_stay_mins := 12 + floor(random() * 36)::INT;
      IF v_ts + make_interval(mins => v_stay_mins) >= (v_now - INTERVAL '12 minutes') THEN
        EXIT;
      END IF;

      v_ts := v_ts + make_interval(mins => v_stay_mins);

      INSERT INTO access_event(
        msg_id, tag_id, gateway_id, ts_edge, ts_ingested,
        zone, direction, level, kind, extra
      )
      VALUES (
        gen_random_uuid(),
        rec.tag_id,
        v_gateway_id,
        v_ts,
        v_ts,
        v_zone,
        'out',
        1,
        rec.entity_type,
        jsonb_build_object(
          'portico', v_portico_id_text,
          'portico_id', v_portico_id_text,
          'site_code', v_site_code,
          'ordinal', v_step_idx
        )
      );

      v_gap_mins := 4 + floor(random() * 15)::INT;
      IF v_ts + make_interval(mins => v_gap_mins) >= (v_now - INTERVAL '5 minutes') THEN
        EXIT;
      END IF;

      v_ts := v_ts + make_interval(mins => v_gap_mins);
      v_step_idx := v_step_idx + v_direction;
    END LOOP;
  END LOOP;
END $$;
-- Puntos de ejemplo
INSERT INTO map_points (site, nivel, name, lat, lng, tipo) VALUES
    ('Andes Norte', 'NTI', 'P1', -22.607900, -69.203264, 'portico'),
    ('Andes Norte', 'NTI', 'P2', -22.607617, -69.199984, 'portico'),
    ('Andes Norte', 'NTI', 'P3', -22.607062, -69.195944, 'portico'),
    ('Andes Norte', 'NTI', 'P4', -22.606870, -69.191751, 'portico'),
    ('Andes Norte', 'NTI', 'P5', -22.606786, -69.204798, 'portico'),
    ('Andes Norte', 'NTI', 'P6', -22.605981, -69.199522, 'portico'),
    ('Andes Norte', 'NTI', 'P7', -22.605823, -69.202452, 'portico'),
    ('Andes Norte', 'NTI', 'P8', -22.605437, -69.195480, 'portico'),
    ('Andes Norte', 'NTI', 'P9', -22.605234, -69.191296, 'portico'),
    ('Andes Norte', 'NTI', 'P10', -22.601815, -69.203738, 'portico'),
    ('Andes Norte', 'NTI', 'P11', -22.596435, -69.200832, 'portico'),
    ('Andes Norte', 'NTI', 'P12', -22.595566, -69.200918, 'portico'),
    ('Andes Norte', 'NTI', 'P13', -22.594639, -69.208390, 'portico'),
    ('Andes Norte', 'NTI', 'P14', -22.593452, -69.209240, 'portico'),
    ('Andes Norte', 'NTI', 'P15', -22.592836, -69.206881, 'portico'),
    ('Andes Norte', 'NTI', 'P16', -22.591628, -69.207702, 'portico');
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
   NORMALIZACI?"N site_code / point_type / zone (DATA FIX)
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
   OCUPACI?"N COHERENTE CON UBICACI?"N FINAL DEMO
   ========================================================= */

WITH polygons_ranked AS (
    SELECT
        mp.id,
        ROW_NUMBER() OVER (ORDER BY mp.id) AS rn
    FROM map_polygons mp
    WHERE mp.site = 'Mina Central'
      AND mp.nivel = 'NP'
),
porticos_ranked AS (
    SELECT
        ap.zone,
        ROW_NUMBER() OVER (ORDER BY ap.id) AS rn
    FROM access_portico ap
    WHERE ap.active = TRUE
)
UPDATE map_polygons mp
SET
    name = CONCAT('Polígono ', pr.zone),
    zone = pr.zone
FROM polygons_ranked pg
JOIN porticos_ranked pr
  ON pr.rn = pg.rn
WHERE mp.id = pg.id;

DELETE FROM map_polygon_occupancy;

INSERT INTO map_polygon_occupancy (
    polygon_id,
    snapshot_time,
    people_count,
    vehicle_count,
    critical_equipment_count
)
SELECT
    mp.id,
    now(),
    COALESCE(SUM(CASE WHEN i.entity_type = 'person' THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN i.entity_type = 'vehicle' THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN i.entity_type = 'equipment' THEN 1 ELSE 0 END), 0)
FROM map_polygons mp
LEFT JOIN vw_access_interior i
  ON i.zone = mp.zone
GROUP BY mp.id;

/* =========================================================
   12) MAP_POINTS PARA HOME (P?"RTICOS + C?MARAS)
   ========================================================= */

-- Limpia todos los puntos del mapa NTI_andes_norte
DELETE FROM map_device
WHERE map_code = 'NTI_andes_norte';

-- ========================================================
--  P?"RTICOS NTI_andes_norte.jpeg (coordenadas calculadas desde el plano con puntos verdes)
--  8, 9 y 10: pórticos con clima (cuadrado verde)
-- ========================================================

-- P?"RTICOS SIN CLIMA (c?rculos azules)
INSERT INTO map_device (map_code, kind, ref_id, label, x_pct, y_pct) VALUES
  -- 1.- SOC. ACC RAMPA NP
  ('NTI_andes_norte', 'portico',  1, '1.-Portal 1',        0.1602, 0.824),

  -- 2.- SOC. ACC RAMPA NH
  ('NTI_andes_norte', 'portico',  2, '2.-Portal 2',        0.1669, 0.7843),

  -- 3.- Estocada 2 RAMPA NP
  ('NTI_andes_norte', 'portico',  3, '3.-Portal 3',      0.1891, 0.8306),

  -- 4.- Calle 12 Zanja 2
  ('NTI_andes_norte', 'portico',  4, '4.-Portal 4',        0.2326, 0.856),

  -- 5.- Calle 12 Zanja 4
  ('NTI_andes_norte', 'portico',  5, '5.-Portal 5',         0.4567, 0.6918),

  -- 6.- Calle 9 Zanja 5
  ('NTI_andes_norte', 'portico',  6, '6.-Portal 6',          0.4586, 0.65),

  -- 7.- Calle 17 Zanja 5
  ('NTI_andes_norte', 'portico',  7, '7.-Portal 7',         0.3678, 0.4768),

  -- 8.- Calle 17 Zanja 5
  ('NTI_andes_norte', 'portico',  8, '8.-Portal 8',         0.3244, 0.2066),

  -- 9.- Calle 17 Zanja 5
  ('NTI_andes_norte', 'portico',  9, '9.-Portal 9',         0.364, 0.2738),

  -- 10.- Calle 17 Zanja 5
  ('NTI_andes_norte', 'portico',  10, '10.-Portal 10',         0.3611, 0.2081),

  -- 11.- Calle 17 Zanja 5
  ('NTI_andes_norte', 'portico',  11, '11.-Portal 11',         0.5059, 0.2305),

  -- 12.- Calle 17 Zanja 5
  ('NTI_andes_norte', 'portico',  12, '12.-Portal 12',         0.5262, 0.3037),

  -- 13.- Calle 17 Zanja 5
  ('NTI_andes_norte', 'portico',  13, '13.-Portal 13',         0.674, 0.2484);

-- P?"RTICOS CON CLIMA (cuadrados verdes)
INSERT INTO map_device (map_code, kind, ref_id, label, x_pct, y_pct) VALUES
  -- 14.- NP Cabecera HW - Z 25
  ('NTI_andes_norte', 'portico_clima',  14, '14.-Portal 14',  0.6952, 0.3231 ),

  -- 15.- Estocada ACC Norte CD2
  ('NTI_andes_norte', 'portico_clima',  15, '15.-Portal 15', 0.8488, 0.2559 ),

  -- 16.- CD ADIT 77
  ('NTI_andes_norte', 'portico_clima', 16, '16.-Portal 16',   0.8701, 0.332);

-- ========================================================
--  C?MARAS IA SOBRE NTI_andes_norte (si las quieres dejar como antes)
-- ========================================================
INSERT INTO map_device (map_code, kind, ref_id, label, x_pct, y_pct) VALUES
  ('NTI_andes_norte', 'camera', 1, 'Cámara IA 1', 0.2046, 0.7829),
  ('NTI_andes_norte', 'camera', 2, 'Cámara IA 2', 0.3785, 0.6888),
  ('NTI_andes_norte', 'camera', 3, 'Cámara IA 3', 0.8507, 0.2649);
UPDATE map_device md
SET ref_id = ap.id
FROM access_portico ap
WHERE md.map_code = 'NTI_andes_norte'
  AND md.kind IN ('portico', 'portico_clima')
  AND regexp_replace(md.label, '[^[:alnum:]]+', '', 'g')
      = regexp_replace(ap.name, '[^[:alnum:]]+', '', 'g')
  AND ap.site_code = 'NTI_AN';
