-- V15: demo semaforos (3 por plano) + bindings
DO $$
BEGIN
  INSERT INTO public.semaforo_device (site_id, code, name, ip, plc_type, profile, port, unit_id, enabled, tags_json)
  SELECT s.id, x.device_code, x.device_name, x.ip, 'delta', 'delta', 502, 1, TRUE,
         jsonb_build_object('rojo_tag', x.rojo_tag, 'verde_tag', x.verde_tag, 'emergency_tag', 'M0', 'power_tag', 'M10')
  FROM public.site s
  JOIN (VALUES
    ('diamante','diamante_cd1_tablero_1','PLC CD1 Tablero 1','192.168.1.10','M2','M1'),
    ('diamante','diamante_cd1_tablero_2','PLC CD1 Tablero 2','192.168.1.30','M2','M1'),

    ('andesita','andesita_vial_01','Andesita Vial 01','192.168.20.10','M2','M1'),
    ('andesita','andesita_vial_02','Andesita Vial 02','192.168.20.11','M4','M3'),
    ('andesita','andesita_vial_03','Andesita Vial 03','192.168.20.12','M6','M5'),

    ('andes_norte','andes_norte_vial_01','Andes Norte Vial 01','192.168.30.10','M2','M1'),
    ('andes_norte','andes_norte_vial_02','Andes Norte Vial 02','192.168.30.11','M4','M3'),
    ('andes_norte','andes_norte_vial_03','Andes Norte Vial 03','192.168.30.12','M6','M5'),

    ('andes_norte_tunel_correa','andes_norte_tunel_correa_vial_01','Túnel Correa Vial 01','192.168.40.10','M2','M1'),
    ('andes_norte_tunel_correa','andes_norte_tunel_correa_vial_02','Túnel Correa Vial 02','192.168.40.11','M4','M3'),
    ('andes_norte_tunel_correa','andes_norte_tunel_correa_vial_03','Túnel Correa Vial 03','192.168.40.12','M6','M5'),

    ('pilar_norte','pilar_norte_vial_01','Pilar Norte Vial 01','192.168.50.10','M2','M1'),
    ('pilar_norte','pilar_norte_vial_02','Pilar Norte Vial 02','192.168.50.11','M4','M3'),
    ('pilar_norte','pilar_norte_vial_03','Pilar Norte Vial 03','192.168.50.12','M6','M5'),

    ('esmeralda','esmeralda_vial_01','Esmeralda Vial 01','192.168.60.10','M7','M8'),
    ('esmeralda','esmeralda_vial_02','Esmeralda Vial 02','192.168.60.11','M9','M8'),
    ('esmeralda','esmeralda_vial_03','Esmeralda Vial 03','192.168.60.12','M9','M8')
  ) AS x(site_code, device_code, device_name, ip, rojo_tag, verde_tag)
    ON s.code = x.site_code
  WHERE NOT EXISTS (
    SELECT 1 FROM public.semaforo_device d WHERE d.code = x.device_code
  );

  INSERT INTO public.semaforo_binding (
    semaforo_device_id, site_code, map_code, site_map_code, polygon_code, button_action, trigger_kind, enabled
  )
  SELECT d.id, x.site_code, x.map_code, x.map_code, x.polygon_code, 'rojo', 'manual', TRUE
  FROM public.semaforo_device d
  JOIN (VALUES
    ('diamante_cd1_tablero_1','diamante','diamante-main','diamante-pipa'),
    ('diamante_cd1_tablero_1','diamante','diamante-main','footprint-fw'),
    ('diamante_cd1_tablero_1','diamante','diamante-main','footprint-hw'),
    ('diamante_cd1_tablero_1','diamante','diamante-main','bde-centro'),
    ('diamante_cd1_tablero_2','diamante','diamante-main','diamante-pipa'),
    ('diamante_cd1_tablero_2','diamante','diamante-main','footprint-fw'),
    ('diamante_cd1_tablero_2','diamante','diamante-main','footprint-hw'),
    ('diamante_cd1_tablero_2','diamante','diamante-main','bde-centro'),

    ('andesita_vial_01','andesita','andesita-main','andesita-norte-hw'),
    ('andesita_vial_02','andesita','andesita-main','andesita-norte-fw'),
    ('andesita_vial_03','andesita','andesita-main','andesita-sur-hw'),

    ('andes_norte_vial_01','andes_norte','andes-norte-main','p-4600'),
    ('andes_norte_vial_02','andes_norte','andes-norte-main','tc-oim'),
    ('andes_norte_vial_03','andes_norte','andes-norte-main','pacifico'),

    ('andes_norte_tunel_correa_vial_01','andes_norte_tunel_correa','andes_norte_tunel_correa','tc-oim'),
    ('andes_norte_tunel_correa_vial_02','andes_norte_tunel_correa','andes_norte_tunel_correa','cabecera-hw'),
    ('andes_norte_tunel_correa_vial_03','andes_norte_tunel_correa','andes_norte_tunel_correa','cabecera-fw-norte'),

    ('pilar_norte_vial_01','pilar_norte','pilar_norte','poligono-pilar-2'),
    ('pilar_norte_vial_02','pilar_norte','pilar_norte','adit-74-75'),
    ('pilar_norte_vial_03','pilar_norte','pilar_norte','inicio-caving'),

    ('esmeralda_vial_01','esmeralda','esmeralda','bde-inferior'),
    ('esmeralda_vial_02','esmeralda','esmeralda','bde-centro'),
    ('esmeralda_vial_03','esmeralda','esmeralda','bde-superior')
  ) AS x(device_code, site_code, map_code, polygon_code)
    ON d.code = x.device_code
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.semaforo_binding sb
    WHERE sb.semaforo_device_id = d.id
      AND COALESCE(sb.map_code, sb.site_map_code, '') = x.map_code
      AND COALESCE(sb.polygon_code, '') = x.polygon_code
  );
END $$;