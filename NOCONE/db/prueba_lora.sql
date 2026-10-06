-- PRUEBA LORA: base operativa limpia para validar
-- GAO -> sender -> LoRa -> receiver -> listener -> backend.
--
-- Conserva: pórticos, gateways, mapas, cámaras y demás módulos.
-- Limpia: historial de accesos y clima de pórticos.
-- Alcance de activos: solo personas, vehículos y equipos de Telemining.
-- RFID habilitado: Felipe Alfonso Cabezas Cisterna, Camila Andrea Rojas Silva,
-- Rodrigo Esteban Muñoz Pérez y Daniela Fernanda Soto Morales.
-- EPCs: 000000000000000000112630, 000000000000000000062461,
--       000000000000000000062462 y 000000000000000000062463.
-- pórtico 1.-SOC. ACC RAMPA NP, reader 192.168.100.50 / ANT1.

BEGIN;

-- Este seed es autocontenido: puede ejecutarse sobre 00_init.sql sin depender
-- de un seed demo previo. No carga movimientos ni datos ficticios.
INSERT INTO company (name, rut, address, phone, email)
VALUES ('Telemining', '76.999.333-1', 'Av. Apoquindo 4500', '+56 2 2980 2010', 'info@telemining.cl')
ON CONFLICT (name) DO NOTHING;

INSERT INTO access_portico_type (code, name, description)
VALUES ('BASIC', 'Portico estandar', 'Portico operativo sin clima')
ON CONFLICT (code) DO NOTHING;

INSERT INTO gateway (name)
SELECT '192.168.100.50'
WHERE NOT EXISTS (SELECT 1 FROM gateway WHERE name = '192.168.100.50');

INSERT INTO access_portico (
  gateway_id, map_point_id, name, specific_name, street_name, trench_name,
  site, nivel, site_code, listener_aliases, zone, portico_type_id,
  operating_mode, antenna_in_port, antenna_out_port,
  sequence_window_seconds, display_shape, has_climate, active
)
SELECT
  g.id, NULL, '1.-SOC. ACC RAMPA NP', 'TMONE_TTE_001', 'SOC', 'ACC RAMPA NP',
  'Diamante', 'NP', 'TMONE_TTE_001', ARRAY[
    '192.168.100.50',
    '192.168.100.50:ANT1',
    'gao-192.168.100.50',
    'gao-192.168.100.50:ANT1'
  ],
  'Rampa NP', pt.id, 'READ', 1, NULL, 15, 'circle', FALSE, TRUE
FROM gateway g
JOIN access_portico_type pt ON pt.code = 'BASIC'
WHERE g.name = '192.168.100.50'
  AND NOT EXISTS (
    SELECT 1 FROM access_portico WHERE name = '1.-SOC. ACC RAMPA NP'
  );

-- Pulso tecnico: se actualiza por cada EPC recibido, aunque no este
-- asignado, para que Tracking refleje comunicacion sin crear accesos falsos.
CREATE TABLE IF NOT EXISTS portico_communication (
  portico_id       BIGINT PRIMARY KEY REFERENCES access_portico(id) ON DELETE CASCADE,
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_reader_code VARCHAR(120),
  last_epc         VARCHAR(160)
);

-- 1. Historial limpio: desde este punto solo se persistirá lo que ingrese
--    desde el listener. No se tocan cámaras, pórticos, mapas ni configuraciones.
TRUNCATE TABLE access_event, access_portico_climate_reading RESTART IDENTITY;

-- 2. El módulo de acceso queda acotado a activos de Telemining.
DELETE FROM tag_assignment;
DELETE FROM tag;

DELETE FROM vehicle_company vc
USING company c
WHERE vc.company_id = c.id
  AND c.name <> 'Telemining';

DELETE FROM vehicles v
WHERE NOT EXISTS (
  SELECT 1
  FROM vehicle_company vc
  JOIN company c ON c.id = vc.company_id
  WHERE vc.vehicle_id = v.id
    AND vc.active = TRUE
    AND c.name = 'Telemining'
);

DELETE FROM equipment e
USING company c
WHERE e.company_id = c.id
  AND c.name <> 'Telemining';

DELETE FROM person p
USING company c
WHERE p.company_id = c.id
  AND c.name <> 'Telemining';

-- 3. Perfil productivo de Felipe (el seed demo reutilizaba el RUT para otro
--    nombre). Se corrige sin crear una segunda identidad.
UPDATE person
SET company_id = (SELECT id FROM company WHERE name = 'Telemining'),
    full_name = 'Felipe Alfonso Cabezas Cisterna',
    first_name = 'Felipe',
    last_name = 'Cabezas Cisterna',
    phone = '+56 9 5555 0001',
    position = 'Ingeniero',
    group_name = 'Telemining',
    active = TRUE
WHERE rut = '16006352-1';

INSERT INTO person (
  company_id, rut, full_name, first_name, last_name, phone, position, group_name, active
)
SELECT
  c.id, '16006352-1', 'Felipe Alfonso Cabezas Cisterna', 'Felipe',
  'Cabezas Cisterna', '+56 9 5555 0001', 'Ingeniero', 'Telemining', TRUE
FROM company c
WHERE c.name = 'Telemining'
  AND NOT EXISTS (SELECT 1 FROM person WHERE rut = '16006352-1');

-- Perfiles ficticios para prueba de las lecturas LoRa/RFID. Los RUT, contactos
-- y datos personales son exclusivamente de laboratorio.
INSERT INTO person (
  company_id, rut, full_name, first_name, last_name, birth_date, address,
  blood_type, phone, emergency_phone, position, group_name, active
)
SELECT
  c.id, seed.rut, seed.full_name, seed.first_name, seed.last_name,
  seed.birth_date, seed.address, seed.blood_type, seed.phone,
  seed.emergency_phone, seed.position, 'Telemining', TRUE
FROM company c
CROSS JOIN (
  VALUES
    ('19.876.543-0', 'Camila Andrea Rojas Silva', 'Camila', 'Rojas Silva',
     DATE '1993-04-18', 'Pasaje Los Cobre 241, Santiago', 'O+',
     '+56 9 7000 2461', '+56 9 7100 2461', 'Técnica de terreno'),
    ('18.765.432-7', 'Rodrigo Esteban Muñoz Pérez', 'Rodrigo', 'Muñoz Pérez',
     DATE '1988-11-02', 'Avenida La Mina 850, Santiago', 'A+',
     '+56 9 7000 2462', '+56 9 7100 2462', 'Operador de pórtico'),
    ('17.654.321-3', 'Daniela Fernanda Soto Morales', 'Daniela', 'Soto Morales',
     DATE '1991-07-26', 'Calle Cordillera 73, Santiago', 'B+',
     '+56 9 7000 2463', '+56 9 7100 2463', 'Supervisora de turno')
) AS seed(
  rut, full_name, first_name, last_name, birth_date, address, blood_type,
  phone, emergency_phone, position
)
WHERE c.name = 'Telemining'
  AND NOT EXISTS (
    SELECT 1
    FROM person p
    WHERE p.company_id = c.id
      AND (p.rut = seed.rut OR p.full_name = seed.full_name)
  );

-- 4. Enlace inequívoco del reader GAO / ANT1 al pórtico físico de la prueba.
INSERT INTO gateway (name)
SELECT '192.168.100.50'
WHERE NOT EXISTS (SELECT 1 FROM gateway WHERE name = '192.168.100.50');

UPDATE access_portico
SET gateway_id = (SELECT id FROM gateway WHERE name = '192.168.100.50'),
    -- El sender puede propagar el hostname del reader como
    -- "gao-192.168.100.50" o bien la IP. Cubrimos ambos formatos.
    listener_aliases = ARRAY[
      '192.168.100.50',
      '192.168.100.50:ANT1',
      'gao-192.168.100.50',
      'gao-192.168.100.50:ANT1'
    ],
    antenna_in_port = 1,
    antenna_out_port = NULL,
    operating_mode = 'READ',
    active = TRUE,
    updated_at = NOW()
WHERE name = '1.-SOC. ACC RAMPA NP';

-- 5. Tags RFID autorizados para esta prueba LoRa.
INSERT INTO tag (code)
SELECT seed.code
FROM (
  VALUES
    ('000000000000000000112630'),
    ('000000000000000000062461'),
    ('000000000000000000062462'),
    ('000000000000000000062463')
) AS seed(code)
WHERE NOT EXISTS (SELECT 1 FROM tag t WHERE t.code = seed.code);

INSERT INTO tag_assignment (
  tag_id, entity_type, entity_id, display_name, active, valid_from
)
SELECT
  t.id, 'person', p.id, p.full_name, TRUE, NOW()
FROM tag t
JOIN (
  VALUES
    ('000000000000000000112630', '16006352-1'),
    ('000000000000000000062461', '19.876.543-0'),
    ('000000000000000000062462', '18.765.432-7'),
    ('000000000000000000062463', '17.654.321-3')
) AS assignment(code, rut) ON assignment.code = t.code
JOIN person p ON p.rut = assignment.rut;

COMMIT;

-- Actualiza estadísticas del planificador después de la limpieza masiva.
ANALYZE access_event;
ANALYZE access_portico_climate_reading;
ANALYZE tag;
ANALYZE tag_assignment;
ANALYZE person;
ANALYZE vehicles;
ANALYZE equipment;
