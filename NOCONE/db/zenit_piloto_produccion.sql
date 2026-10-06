-- ============================================================
-- ZENIT PILOTO PRODUCCION
-- Seed productivo minimo:
--   - 10 personas
--   - 10 vehiculos
--   - 10 equipos
--   - 1 tag RFID fisico registrado y asignado
--   - 0 historial / 0 eventos simulados
--   - porticos configurados para lecturas reales
-- ============================================================

BEGIN;
SET client_encoding = 'UTF8';

-- ============================================================
-- 0) AJUSTES DE ESQUEMA PARA PORTICOS OPERACIONALES
-- ============================================================

ALTER TABLE IF EXISTS access_portico
    ADD COLUMN IF NOT EXISTS operating_mode VARCHAR(20) NOT NULL DEFAULT 'READ';

ALTER TABLE IF EXISTS access_portico
    ADD COLUMN IF NOT EXISTS antenna_in_port SMALLINT;

ALTER TABLE IF EXISTS access_portico
    ADD COLUMN IF NOT EXISTS antenna_out_port SMALLINT;

ALTER TABLE IF EXISTS access_portico
    ADD COLUMN IF NOT EXISTS sequence_window_seconds INTEGER NOT NULL DEFAULT 15;

ALTER TABLE IF EXISTS access_portico
    ADD COLUMN IF NOT EXISTS listener_aliases TEXT[];

UPDATE access_portico
SET
    operating_mode = COALESCE(NULLIF(operating_mode, ''), 'READ'),
    antenna_in_port = COALESCE(antenna_in_port, 1),
    sequence_window_seconds = COALESCE(sequence_window_seconds, 15)
WHERE TRUE;

-- ============================================================
-- 1) CATALOGOS BASE
-- ============================================================

INSERT INTO company (name, rut, address, phone, email)
VALUES
    ('CODELCO', '61.704.000-0', 'Av. Minera Norte 123', '+56 2 2750 1000', 'contacto@codelco.cl'),
    ('Telemining', '76.999.333-1', 'Av. Apoquindo 4500', '+56 2 2980 2010', 'info@telemining.cl')
ON CONFLICT (name) DO NOTHING;

INSERT INTO access_portico_type (code, name, description)
VALUES
    ('BASIC', 'Portico estandar', 'Portico operativo sin clima'),
    ('CLIMATE', 'Portico con clima', 'Portico con sensores ambientales')
ON CONFLICT (code) DO NOTHING;

INSERT INTO equipment_type (code, name, description)
VALUES
    ('CRIT', 'Equipos criticos', 'Equipos y herramientas de alto valor')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 2) LIMPIEZA DE DATOS OPERACIONALES
-- ============================================================

TRUNCATE TABLE access_portico_climate_reading RESTART IDENTITY CASCADE;
TRUNCATE TABLE access_portico_climate_cfg RESTART IDENTITY CASCADE;
TRUNCATE TABLE access_event RESTART IDENTITY CASCADE;
TRUNCATE TABLE tag_assignment RESTART IDENTITY CASCADE;
TRUNCATE TABLE tag RESTART IDENTITY CASCADE;
TRUNCATE TABLE vehicle_company RESTART IDENTITY CASCADE;
TRUNCATE TABLE vehicles RESTART IDENTITY CASCADE;
TRUNCATE TABLE equipment RESTART IDENTITY CASCADE;
TRUNCATE TABLE person RESTART IDENTITY CASCADE;

DELETE FROM map_device
WHERE kind IN ('portico', 'portico_clima');

TRUNCATE TABLE access_portico RESTART IDENTITY CASCADE;
TRUNCATE TABLE gateway RESTART IDENTITY CASCADE;

-- ============================================================
-- 3) GATEWAYS Y PORTICOS REALES / OPERACIONALES
--    - Canonico RFID/LoRa: TMONE_TTE_RX_003
--    - Alias del mismo portico: TMONE_TTE_001 y 192.168.100.50
-- ============================================================

WITH gateway_seed AS (
    INSERT INTO gateway (name)
    VALUES
        ('192.168.100.51'),
        ('192.168.100.53'),
        ('192.168.100.52')
    RETURNING id, name
),
portico_basic AS (
    SELECT id FROM access_portico_type WHERE code = 'BASIC'
)
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
    listener_aliases,
    zone,
    portico_type_id,
    operating_mode,
    antenna_in_port,
    antenna_out_port,
    sequence_window_seconds,
    display_shape,
    has_climate,
    active
)
SELECT
    g.id,
    NULL,
    seed.name,
    seed.specific_name,
    seed.street_name,
    seed.trench_name,
    seed.site,
    seed.nivel,
    seed.site_code,
    seed.listener_aliases,
    seed.zone,
    (SELECT id FROM portico_basic),
    seed.operating_mode,
    seed.antenna_in_port,
    seed.antenna_out_port,
    seed.sequence_window_seconds,
    'circle',
    FALSE,
    TRUE
FROM gateway_seed g
JOIN (
    VALUES
        (
            '192.168.100.51',
            '1.-SOC. ACC RAMPA NP',
            'TMONE_TTE_002',
            'SOC',
            'ACC RAMPA NP',
            'Diamante',
            'NP',
            'TMONE_TTE_002',
            ARRAY[]::text[],
            'Rampa NP',
            'ACCESS',
            1::smallint,
            2::smallint,
            15
        ),
        (
            '192.168.100.53',
            '2.-SOC. ACC RAMPA NH',
            'TMONE_TTE_RX_003',
            'SOC',
            'ACC RAMPA NH',
            'Diamante',
            'NH',
            'TMONE_TTE_RX_003',
            ARRAY['TMONE_TTE_001', '192.168.100.50']::text[],
            'Rampa NH',
            'READ',
            1::smallint,
            NULL::smallint,
            15
        ),
        (
            '192.168.100.52',
            '3.-Estocada 2 RAMPA NP',
            'TMONE_TTE_003',
            'Estocada 2',
            'RAMPA NP',
            'Diamante',
            'NP',
            'TMONE_TTE_003',
            ARRAY[]::text[],
            'Estocada 2',
            'READ',
            1::smallint,
            NULL::smallint,
            15
        )
) AS seed(
    gateway_name,
    name,
    specific_name,
    street_name,
    trench_name,
    site,
    nivel,
    site_code,
    listener_aliases,
    zone,
    operating_mode,
    antenna_in_port,
    antenna_out_port,
    sequence_window_seconds
)
    ON seed.gateway_name = g.name;

INSERT INTO map_device (map_code, kind, ref_id, label, x_pct, y_pct)
VALUES
    ('NP_dia', 'portico', 1, '1.-SOC. ACC RAMPA NP', 0.4485, 0.0851),
    ('NP_dia', 'portico', 2, '2.-SOC. ACC RAMPA NH', 0.3993, 0.1427),
    ('NP_dia', 'portico', 3, '3.-Estocada 2 RAMPA NP', 0.6338, 0.3347);

-- ============================================================
-- 4) PERSONAS
--    - Felipe Alfonso Cabezas Cisterna queda con tag real
--    - resto sin tag y sin historial
-- ============================================================

WITH tele AS (
    SELECT id FROM company WHERE name = 'Telemining' LIMIT 1
)
INSERT INTO person (
    company_id,
    rut,
    full_name,
    first_name,
    last_name,
    phone,
    position,
    group_name,
    active
)
VALUES
    ((SELECT id FROM tele), '16006352-1', 'Felipe Alfonso Cabezas Cisterna', 'Felipe', 'Cabezas Cisterna', '+56 9 5555 0001', 'Ingeniero', 'Telemining', TRUE),
    ((SELECT id FROM tele), '18.765.450-1', 'Juan Perez', 'Juan', 'Perez', '+56 9 5555 0002', 'Oficina', 'Telemining', TRUE),
    ((SELECT id FROM tele), '18.765.440-5', 'Karin Gutierrez', 'Karin', 'Gutierrez', '+56 9 5555 0003', 'Jefe Operaciones', 'Telemining', TRUE),
    ((SELECT id FROM tele), '18.765.441-1', 'Claudia Pacheco', 'Claudia', 'Pacheco', '+56 9 5555 0004', 'RRHH', 'Telemining', TRUE),
    ((SELECT id FROM tele), '18.765.441-2', 'Patricio Torres', 'Patricio', 'Torres', '+56 9 5555 0005', 'Oficina', 'Telemining', TRUE),
    ((SELECT id FROM tele), '18.765.441-3', 'Cesar Ortega', 'Cesar', 'Ortega', '+56 9 5555 0006', 'Gerente', 'Telemining', TRUE),
    ((SELECT id FROM tele), '18.765.441-4', 'Maria Gonzalez', 'Maria', 'Gonzalez', '+56 9 5555 0007', 'Tecnico', 'Telemining', TRUE),
    ((SELECT id FROM tele), '18.765.441-5', 'Carlos Rojas', 'Carlos', 'Rojas', '+56 9 5555 0008', 'Supervisor', 'Telemining', TRUE),
    ((SELECT id FROM tele), '18.765.441-6', 'Ana Munoz', 'Ana', 'Munoz', '+56 9 5555 0009', 'Prevencion', 'Telemining', TRUE),
    ((SELECT id FROM tele), '18.765.441-7', 'Pedro Soto', 'Pedro', 'Soto', '+56 9 5555 0010', 'Mecanico', 'Telemining', TRUE);

-- ============================================================
-- 5) VEHICULOS
-- ============================================================

INSERT INTO vehicles (patente, status, level)
VALUES
    ('TMNP001', 'camioneta', 1),
    ('TMNP002', 'camioneta', 1),
    ('TMNP003', 'camioneta', 1),
    ('TMNP004', 'aljibe', 1),
    ('TMNP005', 'tolva', 1),
    ('TMNP006', 'mixer', 1),
    ('TMNP007', 'manitou', 1),
    ('TMNP008', 'excavadora', 1),
    ('TMNP009', 'jumbo', 1),
    ('TMNP010', 'plano', 1);

INSERT INTO vehicle_company (vehicle_id, company_id, active)
SELECT v.id, c.id, TRUE
FROM vehicles v
JOIN company c
  ON c.name = 'Telemining';

-- ============================================================
-- 6) EQUIPOS
-- ============================================================

WITH tele AS (
    SELECT id FROM company WHERE name = 'Telemining' LIMIT 1
),
crit AS (
    SELECT id FROM equipment_type WHERE code = 'CRIT' LIMIT 1
)
INSERT INTO equipment (
    equipment_type_id,
    company_id,
    code,
    name,
    description,
    critical,
    active
)
VALUES
    ((SELECT id FROM crit), (SELECT id FROM tele), 'TM-EQ-001', 'Taladro Hilti TE-60', 'Equipo critico sin tag productivo', TRUE, TRUE),
    ((SELECT id FROM crit), (SELECT id FROM tele), 'TM-EQ-002', 'Taladro Hilti TE-80', 'Equipo critico sin tag productivo', TRUE, TRUE),
    ((SELECT id FROM crit), (SELECT id FROM tele), 'TM-EQ-003', 'Fusionadora FO', 'Equipo critico sin tag productivo', TRUE, TRUE),
    ((SELECT id FROM crit), (SELECT id FROM tele), 'TM-EQ-004', 'OTDR EXFO', 'Equipo critico sin tag productivo', TRUE, TRUE),
    ((SELECT id FROM crit), (SELECT id FROM tele), 'TM-EQ-005', 'Camara Termografica FLIR', 'Equipo critico sin tag productivo', TRUE, TRUE),
    ((SELECT id FROM crit), (SELECT id FROM tele), 'TM-EQ-006', 'Detector Multigas', 'Equipo critico sin tag productivo', TRUE, TRUE),
    ((SELECT id FROM crit), (SELECT id FROM tele), 'TM-EQ-007', 'GPS RTK', 'Equipo critico sin tag productivo', TRUE, TRUE),
    ((SELECT id FROM crit), (SELECT id FROM tele), 'TM-EQ-008', 'Estacion Total', 'Equipo critico sin tag productivo', TRUE, TRUE),
    ((SELECT id FROM crit), (SELECT id FROM tele), 'TM-EQ-009', 'Analizador de Energia', 'Equipo critico sin tag productivo', TRUE, TRUE),
    ((SELECT id FROM crit), (SELECT id FROM tele), 'TM-EQ-010', 'Generador 15kVA', 'Equipo critico sin tag productivo', TRUE, TRUE);

-- ============================================================
-- 7) TAG RFID REGISTRADO Y ASIGNADO
--    - sin accesos ni historial: las lecturas seran reales
-- ============================================================

INSERT INTO tag (code)
VALUES ('000000000000000000112630');

INSERT INTO tag_assignment (tag_id, entity_type, entity_id, display_name, active)
SELECT
    t.id,
    'person',
    p.id,
    p.full_name,
    TRUE
FROM tag t
JOIN person p
  ON p.rut = '16006352-1'
WHERE t.code = '000000000000000000112630';

COMMIT;
