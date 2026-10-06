/* ============================================================
   seed_produccion_min.sql  (TM One - Telemining)  [FIX TAGS/VEH/EQUIP]
   - Mantiene Felipe + su tag 80ECCCCEED1B
   - Agrega personas con tags de fotos (sin ":")
   - Vehículos como entity_type='vehicle'
   - Equipos críticos (Taladro 1/2) como entity_type='equipment'
   - Evita ON CONFLICT (code) en tag (no hay unique)
   ============================================================ */

BEGIN;

-- 0) Catálogos base
INSERT INTO company (name, rut, address, phone, email)
VALUES
  ('CODELCO',    '61.704.000-0', 'Av. Minera Norte 123', '+56 2 2750 1000', 'contacto@codelco.cl'),
  ('Telemining', '76.999.333-1', 'Av. Apoquindo 4500',   '+56 2 2980 2010', 'info@telemining.cl')
ON CONFLICT DO NOTHING;

INSERT INTO access_portico_type (code, name, description)
VALUES
  ('BASIC',   'Pórtico Básico',    'Pórtico sin clima'),
  ('CLIMATE', 'Pórtico con clima', 'Pórtico con sensores de clima')
ON CONFLICT (code) DO NOTHING;

INSERT INTO access_climate_var (code, name, unit, description)
VALUES
  ('CO2',  'CO2',  'ppm', 'Dióxido de carbono'),
  ('TEMP', 'Temp', '°C',  'Temperatura')
ON CONFLICT (code) DO NOTHING;

-- 1) Capturar 3 ubicaciones existentes (si hay pórticos)
DROP TABLE IF EXISTS _portico_tpl;
CREATE TEMP TABLE _portico_tpl (
  ord          INT PRIMARY KEY,
  map_point_id INT,
  site         VARCHAR(80),
  nivel        VARCHAR(40),
  zone         VARCHAR(80),
  street_name  VARCHAR(120),
  trench_name  VARCHAR(120)
) ON COMMIT DROP;

-- 2 BASIC
INSERT INTO _portico_tpl (ord, map_point_id, site, nivel, zone, street_name, trench_name)
SELECT
  row_number() OVER () AS ord,
  ap.map_point_id, ap.site, ap.nivel, ap.zone, ap.street_name, ap.trench_name
FROM access_portico ap
WHERE ap.active IS TRUE AND (ap.has_climate IS FALSE OR ap.has_climate IS NULL)
ORDER BY ap.id
LIMIT 2;

-- 1 CLIMATE (ord=3)
INSERT INTO _portico_tpl (ord, map_point_id, site, nivel, zone, street_name, trench_name)
SELECT
  3 AS ord,
  ap.map_point_id, ap.site, ap.nivel, ap.zone, ap.street_name, ap.trench_name
FROM access_portico ap
WHERE ap.active IS TRUE AND ap.has_climate IS TRUE
ORDER BY ap.id
LIMIT 1
ON CONFLICT (ord) DO NOTHING;

-- Fallback: completar desde map_points
INSERT INTO _portico_tpl (ord, map_point_id, site, nivel, zone, street_name, trench_name)
SELECT
  t.ord,
  mp.id AS map_point_id,
  mp.site,
  mp.nivel,
  COALESCE(mp.name, 'Zona') AS zone,
  mp.name AS street_name,
  mp.name AS trench_name
FROM (VALUES (1),(2),(3)) AS t(ord)
JOIN map_points mp ON TRUE
WHERE NOT EXISTS (SELECT 1 FROM _portico_tpl p WHERE p.ord=t.ord)
ORDER BY mp.id
LIMIT 3
ON CONFLICT (ord) DO NOTHING;

-- 2) Limpiar datos operacionales (mantener company + mapas)
TRUNCATE TABLE access_portico_climate_reading RESTART IDENTITY CASCADE;
TRUNCATE TABLE access_portico_climate_cfg     RESTART IDENTITY CASCADE;

TRUNCATE TABLE access_event    RESTART IDENTITY CASCADE;
TRUNCATE TABLE tag_assignment  RESTART IDENTITY CASCADE;
TRUNCATE TABLE tag             RESTART IDENTITY CASCADE;

TRUNCATE TABLE vehicle_company RESTART IDENTITY CASCADE;
TRUNCATE TABLE vehicles        RESTART IDENTITY CASCADE;

-- si existe equipment en tu modelo extra, limpiarlo también
TRUNCATE TABLE equipment       RESTART IDENTITY CASCADE;

TRUNCATE TABLE person          RESTART IDENTITY CASCADE;

TRUNCATE TABLE access_portico  RESTART IDENTITY CASCADE;
TRUNCATE TABLE gateway         RESTART IDENTITY CASCADE;

-- 3) Crear 3 gateways + 3 pórticos (id 1..3)
WITH g AS (
  INSERT INTO gateway (name)
  VALUES ('GW_BACKBONE_001'), ('GW_BACKBONE_002'), ('GW_BACKBONE_RX_003')
  RETURNING id, name
),
g_ord AS (
  SELECT id, name,
         CASE name
           WHEN 'GW_BACKBONE_001' THEN 1
           WHEN 'GW_BACKBONE_002' THEN 2
           WHEN 'GW_BACKBONE_RX_003' THEN 3
         END AS ord
  FROM g
),
pt_basic AS (SELECT id FROM access_portico_type WHERE code='BASIC'),
pt_clim  AS (SELECT id FROM access_portico_type WHERE code='CLIMATE')
INSERT INTO access_portico (
  gateway_id, map_point_id,
  name, specific_name, street_name, trench_name,
  site, nivel, site_code, zone,
  portico_type_id, display_shape, has_climate
)
SELECT
  go.id AS gateway_id,
  tpl.map_point_id,
  CONCAT('Pórtico ', tpl.ord) AS name,
  -- debe calzar con EDGE_ID del firmware
  CONCAT('TMONE_TTE_00', tpl.ord) AS specific_name,
  tpl.street_name,
  tpl.trench_name,
  tpl.site,
  tpl.nivel,
  CONCAT('TMONE_TTE_00', tpl.ord) AS site_code,
  tpl.zone,
  CASE WHEN tpl.ord=3 THEN (SELECT id FROM pt_clim) ELSE (SELECT id FROM pt_basic) END AS portico_type_id,
  'circle' AS display_shape,
  (tpl.ord=3) AS has_climate
FROM _portico_tpl tpl
JOIN g_ord go ON go.ord = tpl.ord
ORDER BY tpl.ord;

-- Config clima para el pórtico 3 (CO2 y TEMP)
INSERT INTO access_portico_climate_cfg (portico_id, climate_var_id, green_max, yellow_max)
SELECT
  ap.id AS portico_id,
  v.id  AS climate_var_id,
  CASE v.code WHEN 'CO2' THEN 5000 WHEN 'TEMP' THEN 25 END AS green_max,
  CASE v.code WHEN 'CO2' THEN 10000 WHEN 'TEMP' THEN 30 END AS yellow_max
FROM access_portico ap
JOIN access_climate_var v ON v.code IN ('CO2','TEMP')
WHERE ap.id = 3
ON CONFLICT (portico_id, climate_var_id) DO UPDATE
SET green_max = EXCLUDED.green_max,
    yellow_max = EXCLUDED.yellow_max,
    active = TRUE,
    updated_at = now();

-- ============================================================
-- 4) Personas (con nombres reales de tags)
-- ============================================================
WITH tele AS (SELECT id FROM company WHERE name='Telemining' LIMIT 1)
INSERT INTO person (company_id, rut, full_name, first_name, last_name, phone, position, group_name)
VALUES
  ((SELECT id FROM tele), '18.765.432-1', 'Felipe Alfonso Cabezas', 'Felipe',   'Cabezas',  '+56 9 5555 0001', 'I+D', 'Telemining'),
  ((SELECT id FROM tele), '18.765.450-1', 'Juan Pérez',            'Juan',     'Pérez',    '+56 9 5555 0002', 'Oficina',  'Telemining'),
  ((SELECT id FROM tele), '18.765.440-5', 'Karin Gutierrez',       'Karin',    'Gutierrez','+56 9 5555 0003', 'Jefe Operaciones', 'Telemining'),
  ((SELECT id FROM tele), '18.765.441-1', 'Claudia Pacheco',       'Claudia',  'Pacheco',  '+56 9 5555 0004', 'RRHH', 'Telemining'),
  ((SELECT id FROM tele), '18.765.441-2', 'Patricio Torres',       'Patricio', 'Torres',   '+56 9 5555 0005', 'Oficina', 'Telemining'),
  ((SELECT id FROM tele), '18.765.441-3', 'Cesar Ortega',          'Cesar',    'Ortega',   '+56 9 5555 0006', 'Genrete', 'Telemining'),

  -- relleno demo (sin tag físico todavía)
  ((SELECT id FROM tele), '18.765.441-4', 'María González',        'María',    'González', '+56 9 5555 0007', 'Técnico',   'Telemining'),
  ((SELECT id FROM tele), '18.765.441-5', 'Carlos Rojas',          'Carlos',   'Rojas',    '+56 9 5555 0008', 'Supervisor','Telemining'),
  ((SELECT id FROM tele), '18.765.441-6', 'Ana Muñoz',             'Ana',      'Muñoz',    '+56 9 5555 0009', 'Prevención','Telemining'),
  ((SELECT id FROM tele), '18.765.441-7', 'Pedro Soto',            'Pedro',    'Soto',     '+56 9 5555 0010', 'Mecánico',  'Telemining');

-- ============================================================
-- 5) Vehículos (NO equipos) + vínculo empresa
-- ============================================================
INSERT INTO vehicles (patente, status, level)
VALUES
  ('VEHICULO-CESAR-12', 'online', 1),
  ('VEHICULO-KARIN-24', 'online', 1),
  ('VEHICULO-JORGE-DIAZ', 'online', 1);

INSERT INTO vehicle_company (vehicle_id, company_id)
SELECT v.id, c.id
FROM vehicles v
JOIN company c ON c.name='Telemining'
LEFT JOIN vehicle_company vc ON vc.vehicle_id=v.id AND vc.company_id=c.id
WHERE vc.vehicle_id IS NULL;

-- ============================================================
-- 6) Equipos críticos (equipment) - Taladro 1 / Taladro 2
--    (estructura igual a zenit_demo_1_dia.sql)
-- ============================================================

-- Tipo de equipo (si existe tabla equipment_type)
INSERT INTO equipment_type (code, name, description)
SELECT 'CRIT', 'Equipo Crítico', 'Equipos críticos trazables por pórtico'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='equipment_type')
ON CONFLICT (code) DO NOTHING;

-- Insertar 2 equipos
DO $$
DECLARE
  v_company_id BIGINT;
  v_type_id BIGINT;
BEGIN
  SELECT id INTO v_company_id FROM company WHERE name='Telemining' LIMIT 1;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='equipment_type') THEN
    SELECT id INTO v_type_id FROM equipment_type WHERE code='CRIT' LIMIT 1;
  END IF;

  -- Taladro 1
  IF NOT EXISTS (SELECT 1 FROM equipment WHERE name='Taladro 1') THEN
    INSERT INTO equipment (
      equipment_type_id,
      company_id,
      code,
      name,
      description,
      critical
    )
    VALUES (
      v_type_id,
      v_company_id,
      'TALADRO-1',
      'Taladro 1',
      'Equipo crítico (tag MBM03)',
      TRUE
    );
  END IF;

  -- Taladro 2
  IF NOT EXISTS (SELECT 1 FROM equipment WHERE name='Taladro 2') THEN
    INSERT INTO equipment (
      equipment_type_id,
      company_id,
      code,
      name,
      description,
      critical
    )
    VALUES (
      v_type_id,
      v_company_id,
      'TALADRO-2',
      'Taladro 2',
      'Equipo crítico (tag MBM03)',
      TRUE
    );
  END IF;
END $$;

-- ============================================================
-- 7) TAGS + ASIGNACIONES
--    (sin ":" y sin ON CONFLICT(code))
-- ============================================================

-- 7.1 Insertar tags físicos (si no existen)
INSERT INTO tag (code)
SELECT x.code
FROM (
  VALUES
    -- PERSONAS
    ('80ECCCCEED1B'),   -- Felipe (bt 80:ec:cc:ce:ed:1b)
    ('80ECCCCEF04D'),   -- Juan Pérez oficina
    ('80ECCCCEF007'),   -- Karin (tag redondo)
    ('C30000587DCA'),   -- Claudia Pacheco (C3:00:00:58:7D:CA)
    ('C30000587DC3'),   -- Patricio Torres (C3:00:00:58:7D:C3)
    ('C30000587DC2'),   -- Cesar Ortega (C3:00:00:58:7D:C2)

    -- VEHÍCULOS (beacons blancos)
    ('C30000561F5B'),   -- Vehiculo Cesar 12 (C3:00:00:56:1F:5B)
    ('C30000561F65'),   -- Vehiculo Karin 24 (C3:00:00:56:1F:65)
    ('C30000561F5C'),   -- Vehiculo Jorge Diaz (C3:00:00:56:1F:5C)

    -- EQUIPOS (MBM03)
    ('C300003B1C58'),   -- Taladro 1 (C3:00:00:3B:1C:58)
    ('C300003B1C5B')    -- Taladro 2 (C3:00:00:3B:1C:5B)
) AS x(code)
WHERE NOT EXISTS (SELECT 1 FROM tag t WHERE t.code = x.code);

-- 7.2 Asignación PERSONAS (por RUT)
-- Felipe
INSERT INTO tag_assignment (tag_id, entity_type, entity_id, display_name, active)
SELECT t.id, 'person', p.id, p.full_name, TRUE
FROM tag t
JOIN person p ON p.rut='18.765.432-1'
WHERE t.code='80ECCCCEED1B'
  AND NOT EXISTS (
    SELECT 1 FROM tag_assignment a
    WHERE a.tag_id=t.id AND a.entity_type='person' AND a.entity_id=p.id
  );

-- Juan Pérez
INSERT INTO tag_assignment (tag_id, entity_type, entity_id, display_name, active)
SELECT t.id, 'person', p.id, p.full_name, TRUE
FROM tag t
JOIN person p ON p.rut='18.765.450-1'
WHERE t.code='80ECCCCEF04D'
  AND NOT EXISTS (
    SELECT 1 FROM tag_assignment a
    WHERE a.tag_id=t.id AND a.entity_type='person' AND a.entity_id=p.id
  );

-- Karin
INSERT INTO tag_assignment (tag_id, entity_type, entity_id, display_name, active)
SELECT t.id, 'person', p.id, p.full_name, TRUE
FROM tag t
JOIN person p ON p.rut='18.765.440-5'
WHERE t.code='80ECCCCEF007'
  AND NOT EXISTS (
    SELECT 1 FROM tag_assignment a
    WHERE a.tag_id=t.id AND a.entity_type='person' AND a.entity_id=p.id
  );

-- Claudia Pacheco
INSERT INTO tag_assignment (tag_id, entity_type, entity_id, display_name, active)
SELECT t.id, 'person', p.id, p.full_name, TRUE
FROM tag t
JOIN person p ON p.rut='18.765.441-1'
WHERE t.code='C30000587DCA'
  AND NOT EXISTS (
    SELECT 1 FROM tag_assignment a
    WHERE a.tag_id=t.id AND a.entity_type='person' AND a.entity_id=p.id
  );

-- Patricio Torres
INSERT INTO tag_assignment (tag_id, entity_type, entity_id, display_name, active)
SELECT t.id, 'person', p.id, p.full_name, TRUE
FROM tag t
JOIN person p ON p.rut='18.765.441-2'
WHERE t.code='C30000587DC3'
  AND NOT EXISTS (
    SELECT 1 FROM tag_assignment a
    WHERE a.tag_id=t.id AND a.entity_type='person' AND a.entity_id=p.id
  );

-- Cesar Ortega
INSERT INTO tag_assignment (tag_id, entity_type, entity_id, display_name, active)
SELECT t.id, 'person', p.id, p.full_name, TRUE
FROM tag t
JOIN person p ON p.rut='18.765.441-3'
WHERE t.code='C30000587DC2'
  AND NOT EXISTS (
    SELECT 1 FROM tag_assignment a
    WHERE a.tag_id=t.id AND a.entity_type='person' AND a.entity_id=p.id
  );

-- 7.3 Asignación VEHÍCULOS (por patente)
INSERT INTO tag_assignment (tag_id, entity_type, entity_id, display_name, active)
SELECT t.id, 'vehicle', v.id, v.patente, TRUE
FROM tag t
JOIN vehicles v ON v.patente='VEHICULO-CESAR-12'
WHERE t.code='C30000561F5B'
  AND NOT EXISTS (
    SELECT 1 FROM tag_assignment a
    WHERE a.tag_id=t.id AND a.entity_type='vehicle' AND a.entity_id=v.id
  );

INSERT INTO tag_assignment (tag_id, entity_type, entity_id, display_name, active)
SELECT t.id, 'vehicle', v.id, v.patente, TRUE
FROM tag t
JOIN vehicles v ON v.patente='VEHICULO-KARIN-24'
WHERE t.code='C30000561F65'
  AND NOT EXISTS (
    SELECT 1 FROM tag_assignment a
    WHERE a.tag_id=t.id AND a.entity_type='vehicle' AND a.entity_id=v.id
  );

INSERT INTO tag_assignment (tag_id, entity_type, entity_id, display_name, active)
SELECT t.id, 'vehicle', v.id, v.patente, TRUE
FROM tag t
JOIN vehicles v ON v.patente='VEHICULO-JORGE-DIAZ'
WHERE t.code='C30000561F5C'
  AND NOT EXISTS (
    SELECT 1 FROM tag_assignment a
    WHERE a.tag_id=t.id AND a.entity_type='vehicle' AND a.entity_id=v.id
  );

-- 7.4 Asignación EQUIPOS (Taladro 1/2)
INSERT INTO tag_assignment (tag_id, entity_type, entity_id, display_name, active)
SELECT t.id, 'equipment', e.id, e.name, TRUE
FROM tag t
JOIN equipment e ON e.name='Taladro 1'
WHERE t.code='C300003B1C58'
  AND NOT EXISTS (
    SELECT 1 FROM tag_assignment a
    WHERE a.tag_id=t.id AND a.entity_type='equipment' AND a.entity_id=e.id
  );

INSERT INTO tag_assignment (tag_id, entity_type, entity_id, display_name, active)
SELECT t.id, 'equipment', e.id, e.name, TRUE
FROM tag t
JOIN equipment e ON e.name='Taladro 2'
WHERE t.code='C300003B1C5B'
  AND NOT EXISTS (
    SELECT 1 FROM tag_assignment a
    WHERE a.tag_id=t.id AND a.entity_type='equipment' AND a.entity_id=e.id
  );

-- ============================================================
-- MAP_DEVICE (HOME): dibuja íconos de pórticos sobre NP_dia
-- ============================================================
DELETE FROM map_device
WHERE map_code = 'NP_dia' AND kind = 'portico';

INSERT INTO map_device (map_code, kind, ref_id, label, x_pct, y_pct) VALUES
  ('NP_dia', 'portico',  1, '1.-SOC. ACC RAMPA NP',   0.4485, 0.0851),
  ('NP_dia', 'portico',  2, '2.-SOC. ACC RAMPA NH',   0.3993, 0.1427),
  ('NP_dia', 'portico',  3, '3.-Estocada 2 RAMPA NP', 0.6338, 0.3347);

COMMIT;
