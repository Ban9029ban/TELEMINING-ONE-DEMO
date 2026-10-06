-- V15: base runtime seed (sites, maps, polygons, polygon ui)
DO $$
DECLARE
  v_org_id bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='organization' AND column_name='id'
  ) THEN
    SELECT id INTO v_org_id FROM public.organization ORDER BY id LIMIT 1;
    IF v_org_id IS NULL THEN
      INSERT INTO public.organization (id, code, name)
      VALUES (1, 'default', 'Default')
      ON CONFLICT DO NOTHING;
      v_org_id := 1;
    END IF;
  END IF;

  INSERT INTO public.site (organization_id, code, name, is_active)
  SELECT v_org_id, x.code, x.name, TRUE
  FROM (VALUES
    ('diamante', 'Diamante'),
    ('andesita', 'Andesita'),
    ('andes_norte', 'Andes Norte'),
    ('andes_norte_tunel_correa', 'Andes Norte Túnel Correa'),
    ('pilar_norte', 'Pilar Norte'),
    ('esmeralda', 'Esmeralda')
  ) AS x(code, name)
  WHERE NOT EXISTS (SELECT 1 FROM public.site s WHERE s.code = x.code);

  INSERT INTO public.site_map (site_id, code, name, image_path, display_order, is_active)
  SELECT s.id, x.code, x.name, x.image_path, 1, TRUE
  FROM public.site s
  JOIN (VALUES
    ('diamante', 'diamante-main', 'Diamante principal', '/placeholder/diamante-main.png'),
    ('andesita', 'andesita-main', 'Andesita principal', '/placeholder/andesita-main.png'),
    ('andes_norte', 'andes-norte-main', 'Andes Norte principal', '/placeholder/andes-norte-main.png'),
    ('andes_norte_tunel_correa', 'andes_norte_tunel_correa', 'Andes Norte Túnel Correa', '/placeholder/andes_norte_tunel_correa.png'),
    ('pilar_norte', 'pilar_norte', 'Pilar Norte principal', '/placeholder/pilar_norte.png'),
    ('esmeralda', 'esmeralda', 'Esmeralda principal', '/placeholder/esmeralda.png')
  ) AS x(site_code, code, name, image_path)
    ON s.code = x.site_code
  WHERE NOT EXISTS (SELECT 1 FROM public.site_map sm WHERE sm.code = x.code);

  INSERT INTO public.map_object (site_map_id, code, name, object_type, sort_order, is_active)
  SELECT sm.id, x.object_code, x.object_name, 'polygon', x.sort_order, TRUE
  FROM public.site_map sm
  JOIN (VALUES
    ('diamante-main','diamante-pipa','Diamante PIPA',1),
    ('diamante-main','footprint-fw','FootPrint FW',2),
    ('diamante-main','footprint-hw','FootPrint HW',3),
    ('andesita-main','andesita-norte-hw','Andesita Norte HW',1),
    ('andesita-main','andesita-norte-fw','Andesita Norte FW',2),
    ('andesita-main','andesita-sur-hw','Andesita Sur HW',3),
    ('andes-norte-main','p-4600','P-4600',1),
    ('andes-norte-main','tc-oim','TC OIM',2),
    ('andes-norte-main','pacifico','Pacífico',3),
    ('andes_norte_tunel_correa','tc-oim','TC OIM',1),
    ('andes_norte_tunel_correa','cabecera-hw','Cabecera HW',2),
    ('andes_norte_tunel_correa','cabecera-fw-norte','Cabecera FW Norte',3),
    ('pilar_norte','poligono-pilar-2','Polígono Pilar 2',1),
    ('pilar_norte','adit-74-75','Adit 74-75',2),
    ('pilar_norte','inicio-caving','Inicio Caving',3),
    ('esmeralda','bde-inferior','BDE Inferior',1),
    ('esmeralda','bde-centro','BDE Centro',2),
    ('esmeralda','bde-superior','BDE Superior',3)
  ) AS x(map_code, object_code, object_name, sort_order)
    ON sm.code = x.map_code
  WHERE NOT EXISTS (
    SELECT 1 FROM public.map_object mo
    WHERE mo.site_map_id = sm.id AND mo.code = x.object_code
  );

  INSERT INTO public.polygon_ui_config (site_map_id, map_object_id, is_manual_enabled, is_automatic_enabled)
  SELECT mo.site_map_id, mo.id, TRUE, TRUE
  FROM public.map_object mo
  WHERE NOT EXISTS (
    SELECT 1 FROM public.polygon_ui_config c WHERE c.map_object_id = mo.id
  );

  INSERT INTO public.polygon_ui_state_option (
    polygon_ui_config_id, config_id, map_object_id,
    state_code, button_label, label,
    color_hex, button_color, overlay_color, fill_color,
    sort_order, is_visible, is_enabled, is_active
  )
  SELECT c.id, c.id, c.map_object_id,
         x.state_code, x.button_label, x.button_label,
         x.color_hex, x.color_hex, x.color_hex, x.color_hex,
         x.sort_order, TRUE, TRUE, TRUE
  FROM public.polygon_ui_config c
  CROSS JOIN (VALUES
    ('normal', 'NORMAL', '#67c46f', 1),
    ('alerta', 'ALERTA', '#f2c94c', 2),
    ('rojo', 'ROJO', '#eb5757', 3)
  ) AS x(state_code, button_label, color_hex, sort_order)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.polygon_ui_state_option o
    WHERE (o.polygon_ui_config_id = c.id OR o.config_id = c.id OR o.map_object_id = c.map_object_id)
      AND o.state_code = x.state_code
  );
END $$;