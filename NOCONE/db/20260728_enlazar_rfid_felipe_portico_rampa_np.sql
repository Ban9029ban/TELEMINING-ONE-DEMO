-- Deja operativo el flujo RFID real GAO -> LoRa -> listener -> backend.
-- Fuente de identidad: zenit_piloto_produccion.sql.
-- EPC verificado en el listener: 000000000000000000112630.

BEGIN;

-- El seed demo usaba este RUT para Samuel; el perfil productivo lo reserva
-- para Felipe Alfonso Cabezas Cisterna.
UPDATE person
SET full_name = 'Felipe Alfonso Cabezas Cisterna',
    first_name = 'Felipe',
    last_name = 'Cabezas Cisterna',
    phone = '+56 9 5555 0001',
    position = 'Ingeniero',
    group_name = 'Telemining',
    active = TRUE
WHERE rut = '16006352-1';

-- El backend identifica las lecturas RFID por reader_code/reader_host.
INSERT INTO gateway (name)
SELECT '192.168.100.50'
WHERE NOT EXISTS (
  SELECT 1 FROM gateway WHERE name = '192.168.100.50'
);

-- Asocia el lector GAO y su antena 1 al pórtico operativo solicitado.
UPDATE access_portico
SET gateway_id = (SELECT id FROM gateway WHERE name = '192.168.100.50'),
    listener_aliases = ARRAY['192.168.100.50', '192.168.100.50:ANT1'],
    antenna_in_port = 1,
    active = TRUE,
    updated_at = NOW()
WHERE name = '1.-SOC. ACC RAMPA NP';

-- Registra y asigna el EPC físico actualmente recibido por GAO a Felipe.
INSERT INTO tag (code)
SELECT '000000000000000000112630'
WHERE NOT EXISTS (
  SELECT 1 FROM tag WHERE code = '000000000000000000112630'
);

UPDATE tag_assignment
SET active = FALSE,
    valid_to = NOW(),
    updated_at = NOW()
WHERE tag_id = (SELECT id FROM tag WHERE code = '000000000000000000112630')
  AND active = TRUE;

INSERT INTO tag_assignment (tag_id, entity_type, entity_id, display_name, active, valid_from)
SELECT t.id, 'person', p.id, p.full_name, TRUE, NOW()
FROM tag t
JOIN person p ON p.rut = '16006352-1'
WHERE t.code = '000000000000000000112630';

COMMIT;
