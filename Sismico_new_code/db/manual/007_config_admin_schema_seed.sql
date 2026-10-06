BEGIN;

ALTER TABLE IF EXISTS app_user ADD COLUMN IF NOT EXISTS email VARCHAR(150) NULL;
ALTER TABLE IF EXISTS app_user ADD COLUMN IF NOT EXISTS role VARCHAR(50) NULL;
UPDATE app_user SET role = COALESCE(role, role_code, 'user') WHERE role IS NULL;

ALTER TABLE IF EXISTS polygon_ui_config ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE IF EXISTS polygon_ui_config ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS polygon_ui_config_id BIGINT NULL;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS config_id BIGINT NULL;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS map_object_id BIGINT NULL;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS button_label VARCHAR(100) NULL;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS label VARCHAR(100) NULL;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS button_color VARCHAR(20) NULL;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS color_hex VARCHAR(20) NULL;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS overlay_color VARCHAR(20) NULL;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS overlay_opacity NUMERIC(5,4) NOT NULL DEFAULT 0.35;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE polygon_ui_state_option SET polygon_ui_config_id = config_id WHERE polygon_ui_config_id IS NULL AND config_id IS NOT NULL;
UPDATE polygon_ui_state_option SET config_id = polygon_ui_config_id WHERE config_id IS NULL AND polygon_ui_config_id IS NOT NULL;
UPDATE polygon_ui_state_option pso
SET map_object_id = cfg.map_object_id
FROM polygon_ui_config cfg
WHERE pso.map_object_id IS NULL
  AND ((pso.config_id IS NOT NULL AND pso.config_id = cfg.id)
    OR (pso.polygon_ui_config_id IS NOT NULL AND pso.polygon_ui_config_id = cfg.id));
UPDATE polygon_ui_state_option SET button_label = COALESCE(button_label, label, state_code) WHERE button_label IS NULL;
UPDATE polygon_ui_state_option SET label = COALESCE(label, button_label, state_code) WHERE label IS NULL;
UPDATE polygon_ui_state_option SET color_hex = COALESCE(color_hex, button_color) WHERE color_hex IS NULL AND button_color IS NOT NULL;
UPDATE polygon_ui_state_option SET button_color = COALESCE(button_color, color_hex) WHERE button_color IS NULL AND color_hex IS NOT NULL;

CREATE TABLE IF NOT EXISTS semaforo_binding (
    id BIGSERIAL PRIMARY KEY,
    semaforo_device_id BIGINT NOT NULL REFERENCES semaforo_device(id) ON DELETE CASCADE,
    site_id BIGINT NULL REFERENCES site(id) ON DELETE CASCADE,
    site_map_id BIGINT NULL REFERENCES site_map(id) ON DELETE CASCADE,
    map_object_id BIGINT NULL REFERENCES map_object(id) ON DELETE CASCADE,
    trigger_kind VARCHAR(40) NOT NULL DEFAULT 'manual_alert',
    red_command VARCHAR(20) NOT NULL DEFAULT 'rojo',
    green_command VARCHAR(20) NOT NULL DEFAULT 'verde',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

WITH site_seed(code,name,img) AS (
  VALUES
    ('diamante','Diamante','/legacy/diamante/map.png'),
    ('andesita','Andesita','/legacy/andesita/ANDESITAMAP.jpg'),
    ('andes_norte','Andes Norte','/legacy/andesnorte/ANNI/ANNI.jpg'),
    ('andes_norte_tunel_correa','Andes Norte Tunel Correa','/legacy/tunnelcorrea/TC.jpg'),
    ('pilar_norte','Pilar Norte','/legacy/andesnorte/ANNI/ANNI.jpg'),
    ('esmeralda','Esmeralda','/legacy/diamante/map.png')
)
INSERT INTO site (organization_id, code, name, timezone, is_active)
SELECT 1, code, name, 'America/Santiago', TRUE FROM site_seed ss
WHERE NOT EXISTS (SELECT 1 FROM site s WHERE s.code = ss.code);

WITH site_map_seed AS (
  SELECT s.id AS site_id, s.code AS site_code,
         s.code || '_main' AS map_code,
         s.name || ' principal' AS map_name,
         CASE s.code
           WHEN 'diamante' THEN '/legacy/diamante/map.png'
           WHEN 'andesita' THEN '/legacy/andesita/ANDESITAMAP.jpg'
           WHEN 'andes_norte' THEN '/legacy/andesnorte/ANNI/ANNI.jpg'
           WHEN 'andes_norte_tunel_correa' THEN '/legacy/tunnelcorrea/TC.jpg'
           WHEN 'pilar_norte' THEN '/legacy/andesnorte/ANNI/ANNI.jpg'
           WHEN 'esmeralda' THEN '/legacy/diamante/map.png'
         END AS image_url
  FROM site s
  WHERE s.code IN ('diamante','andesita','andes_norte','andes_norte_tunel_correa','pilar_norte','esmeralda')
)
INSERT INTO site_map (site_id, code, name, image_url, is_active)
SELECT site_id, map_code, map_name, image_url, TRUE
FROM site_map_seed sms
WHERE NOT EXISTS (SELECT 1 FROM site_map sm WHERE sm.code = sms.map_code);

WITH objects(site_code, map_code, code, name, state_code, geometry_json) AS (
  VALUES
    ('andes_norte_tunel_correa','andes_norte_tunel_correa_main','tc_tc_oim','TC OIM','normal','[[1120,150],[1410,150],[1410,360],[1120,360]]'),
    ('andes_norte_tunel_correa','andes_norte_tunel_correa_main','tc_p_4600','P 4600','normal','[[520,420],[930,420],[930,770],[520,770]]'),
    ('andes_norte_tunel_correa','andes_norte_tunel_correa_main','tc_pilar_2_profundo','Polígono Pilar 2 Profundo','centro','[[980,350],[1310,350],[1310,780],[980,780]]'),
    ('pilar_norte','pilar_norte_main','pilar_norte_inferior','Pilar Norte Inferior','inferior','[[930,320],[1010,320],[1010,390],[930,390]]'),
    ('pilar_norte','pilar_norte_main','pilar_norte_centro','Pilar Norte Centro','centro','[[950,350],[1035,350],[1035,430],[950,430]]'),
    ('pilar_norte','pilar_norte_main','pilar_norte_superior','Pilar Norte Superior','superior','[[970,380],[1060,380],[1060,470],[970,470]]'),
    ('esmeralda','esmeralda_main','esmeralda_inferior','Esmeralda Inferior','inferior','[[780,430],[1040,430],[1040,530],[780,530]]'),
    ('esmeralda','esmeralda_main','esmeralda_centro','Esmeralda Centro','centro','[[810,460],[1010,460],[1010,560],[810,560]]'),
    ('esmeralda','esmeralda_main','esmeralda_superior','Esmeralda Superior','superior','[[840,490],[980,490],[980,590],[840,590]]')
)
INSERT INTO map_object (site_map_id, code, name, geometry_json, state_code, is_active)
SELECT sm.id, o.code, o.name, o.geometry_json::jsonb, o.state_code, TRUE
FROM objects o
JOIN site_map sm ON sm.code = o.map_code
WHERE NOT EXISTS (SELECT 1 FROM map_object mo WHERE mo.site_map_id = sm.id AND mo.code = o.code);

INSERT INTO polygon_ui_config (map_object_id, control_mode, manual_enabled, automatic_enabled, state_set_code, is_active)
SELECT mo.id,
       'manual',
       TRUE,
       TRUE,
       CASE WHEN LOWER(mo.state_code) IN ('inferior','centro','superior') THEN 'three_level' ELSE 'binary_alert' END,
       TRUE
FROM map_object mo
LEFT JOIN polygon_ui_config cfg ON cfg.map_object_id = mo.id
WHERE cfg.id IS NULL;

WITH cfg AS (
  SELECT cfg.id AS cfg_id, mo.id AS map_object_id,
         CASE WHEN LOWER(mo.state_code) IN ('inferior','centro','superior') THEN 'three_level' ELSE 'binary_alert' END AS state_set_code
  FROM polygon_ui_config cfg
  JOIN map_object mo ON mo.id = cfg.map_object_id
)
INSERT INTO polygon_ui_state_option (
    polygon_ui_config_id, config_id, map_object_id, state_code, button_label, label,
    button_color, color_hex, overlay_color, overlay_opacity, sort_order, is_visible, is_enabled
)
SELECT cfg.cfg_id, cfg.cfg_id, cfg.map_object_id, x.state_code, x.button_label, x.button_label,
       x.color_hex, x.color_hex, x.color_hex, 0.3500, x.sort_order, TRUE, TRUE
FROM cfg
JOIN LATERAL (
  SELECT * FROM (
    VALUES
      ('binary_alert','normal','NORMAL','#67c46f',1),
      ('binary_alert','alerta','ALERTA','#d68a60',2),
      ('three_level','inferior','INFERIOR','#d68a60',1),
      ('three_level','centro','CENTRO','#67c46f',2),
      ('three_level','superior','SUPERIOR','#d68a60',3)
  ) AS v(state_set_code, state_code, button_label, color_hex, sort_order)
  WHERE v.state_set_code = cfg.state_set_code
) x ON TRUE
LEFT JOIN polygon_ui_state_option existing
  ON existing.map_object_id = cfg.map_object_id
 AND existing.state_code = x.state_code
WHERE existing.id IS NULL;

WITH site_net AS (
  VALUES
    ('diamante','192.168.10.'),
    ('andesita','192.168.20.'),
    ('andes_norte','192.168.30.'),
    ('andes_norte_tunel_correa','192.168.40.'),
    ('pilar_norte','192.168.50.'),
    ('esmeralda','192.168.60.')
), device_seed AS (
  SELECT s.id AS site_id, s.code AS site_code, s.name AS site_name, net.column2 AS ip_prefix, gs AS idx
  FROM site s
  JOIN site_net net(column1,column2) ON net.column1 = s.code
  CROSS JOIN generate_series(1,3) gs
)
INSERT INTO semaforo_device (site_id, code, name, ip, plc_type, profile, port, unit_id, enabled, tags_json)
SELECT ds.site_id,
       ds.site_code || '_vial_' || lpad(ds.idx::text,2,'0'),
       ds.site_name || ' Vial ' || lpad(ds.idx::text,2,'0'),
       ds.ip_prefix || (9 + ds.idx)::text,
       'delta', 'delta', 502, 1, TRUE,
       jsonb_build_object('verde_tag','M' || ((ds.idx*2)-1)::text, 'rojo_tag','M' || (ds.idx*2)::text)
FROM device_seed ds
WHERE NOT EXISTS (
  SELECT 1 FROM semaforo_device sd WHERE sd.code = ds.site_code || '_vial_' || lpad(ds.idx::text,2,'0')
);

WITH ranked_objects AS (
  SELECT s.id AS site_id, sm.id AS site_map_id, mo.id AS map_object_id,
         row_number() OVER (PARTITION BY s.id ORDER BY mo.id) AS rn
  FROM site s
  JOIN site_map sm ON sm.site_id = s.id AND sm.code = s.code || '_main'
  JOIN map_object mo ON mo.site_map_id = sm.id AND COALESCE(mo.is_active, TRUE) = TRUE
  WHERE s.code IN ('diamante','andesita','andes_norte','andes_norte_tunel_correa','pilar_norte','esmeralda')
), devices AS (
  SELECT sd.id AS semaforo_device_id, sd.site_id,
         row_number() OVER (PARTITION BY sd.site_id ORDER BY sd.id) AS rn
  FROM semaforo_device sd
  JOIN site s ON s.id = sd.site_id
  WHERE s.code IN ('diamante','andesita','andes_norte','andes_norte_tunel_correa','pilar_norte','esmeralda')
)
INSERT INTO semaforo_binding (semaforo_device_id, site_id, site_map_id, map_object_id, trigger_kind, red_command, green_command, enabled)
SELECT d.semaforo_device_id, ro.site_id, ro.site_map_id, ro.map_object_id,
       'manual_alert', 'rojo', 'verde', TRUE
FROM ranked_objects ro
JOIN devices d ON d.site_id = ro.site_id AND d.rn = ro.rn
LEFT JOIN semaforo_binding sb ON sb.semaforo_device_id = d.semaforo_device_id AND sb.map_object_id = ro.map_object_id
WHERE ro.rn <= 3 AND sb.id IS NULL;

COMMIT;
