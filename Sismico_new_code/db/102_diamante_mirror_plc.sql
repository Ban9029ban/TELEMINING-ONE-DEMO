-- V18: Diamante CD1 PLC espejo real (192.168.1.10 / 192.168.1.30)
-- Ambos tableros comparten la misma programación M0..M10.

DO $$
DECLARE
  v_site_id BIGINT;
  v_dev1_id BIGINT;
  v_dev2_id BIGINT;
BEGIN
  SELECT id INTO v_site_id FROM site WHERE code = 'diamante' LIMIT 1;
  IF v_site_id IS NULL THEN
    RAISE NOTICE 'Sitio diamante no existe, se omite patch espejo CD1';
    RETURN;
  END IF;

  -- Desactivar semáforos demo antiguos de diamante
  UPDATE semaforo_device
     SET enabled = FALSE,
         name = CASE WHEN name LIKE '%[LEGACY DEMO]%' THEN name ELSE name || ' [LEGACY DEMO]' END,
         tags_json = COALESCE(tags_json, '{}'::jsonb)
           || '{"legacy_demo": true, "replaced_by": ["diamante_cd1_tablero_1", "diamante_cd1_tablero_2"]}'::jsonb
   WHERE site_id = v_site_id
     AND code IN ('diamante_vial_01', 'diamante_vial_02', 'diamante_vial_03');

  INSERT INTO semaforo_device (site_id, code, name, ip, plc_type, profile, port, unit_id, enabled, tags_json)
  SELECT v_site_id,
         'diamante_cd1_tablero_1',
         'PLC CD1 Tablero 1',
         '192.168.1.10',
         'delta',
         'delta',
         502,
         1,
         TRUE,
         jsonb_build_object(
           'mirror_mode', true,
           'mirror_group', 'diamante_cd1_mirror',
           'site_code', 'diamante',
           'plane_code', 'diamante',
           'plane_codes', jsonb_build_array('diamante'),
           'polygon_codes', jsonb_build_array('diamante_pipa', 'diamante_footprint_fw', 'diamante_footprint_hw', 'diamante_bajo_diamante_esmeralda'),
           'hmi_ip', '192.168.1.20',
           'field_ip', '192.168.1.10',
           'test_ip', '192.168.1.11',
           'normal_tag', 'M1', 'alert_tag', 'M2', 'inferior_tag', 'M7', 'centro_tag', 'M8', 'superior_tag', 'M9', 'emergency_tag', 'M0',
           'signals', jsonb_build_object(
             'M0', 'Estado de emergencia - parpadean luces rojas',
             'M1', 'Luz verde normal PIPA',
             'M2', 'Luz roja alerta PIPA',
             'M3', 'Luz verde normal Diamante FW',
             'M4', 'Luz roja alerta Diamante FW',
             'M5', 'Luz verde normal Diamante HW',
             'M6', 'Luz roja alerta Diamante HW',
             'M7', 'Luz roja inferior BDE',
             'M8', 'Luz verde centro BDE',
             'M9', 'Luz roja superior BDE',
             'M10', 'Detección alimentación externa'
           )
         )
  WHERE NOT EXISTS (SELECT 1 FROM semaforo_device WHERE code = 'diamante_cd1_tablero_1');

  INSERT INTO semaforo_device (site_id, code, name, ip, plc_type, profile, port, unit_id, enabled, tags_json)
  SELECT v_site_id,
         'diamante_cd1_tablero_2',
         'PLC CD1 Tablero 2',
         '192.168.1.30',
         'delta',
         'delta',
         502,
         1,
         TRUE,
         jsonb_build_object(
           'mirror_mode', true,
           'mirror_group', 'diamante_cd1_mirror',
           'site_code', 'diamante',
           'plane_code', 'diamante',
           'plane_codes', jsonb_build_array('diamante'),
           'polygon_codes', jsonb_build_array('diamante_pipa', 'diamante_footprint_fw', 'diamante_footprint_hw', 'diamante_bajo_diamante_esmeralda'),
           'hmi_ip', '192.168.1.40',
           'field_ip', '192.168.1.30',
           'test_ip', '192.168.1.12',
           'normal_tag', 'M1', 'alert_tag', 'M2', 'inferior_tag', 'M7', 'centro_tag', 'M8', 'superior_tag', 'M9', 'emergency_tag', 'M0',
           'signals', jsonb_build_object(
             'M0', 'Estado de emergencia - parpadean luces rojas',
             'M1', 'Luz verde normal PIPA',
             'M2', 'Luz roja alerta PIPA',
             'M3', 'Luz verde normal Diamante FW',
             'M4', 'Luz roja alerta Diamante FW',
             'M5', 'Luz verde normal Diamante HW',
             'M6', 'Luz roja alerta Diamante HW',
             'M7', 'Luz roja inferior BDE',
             'M8', 'Luz verde centro BDE',
             'M9', 'Luz roja superior BDE',
             'M10', 'Detección alimentación externa'
           )
         )
  WHERE NOT EXISTS (SELECT 1 FROM semaforo_device WHERE code = 'diamante_cd1_tablero_2');
END $$;
