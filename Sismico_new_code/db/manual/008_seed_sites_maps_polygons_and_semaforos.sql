BEGIN;

ALTER TABLE IF EXISTS app_user ADD COLUMN IF NOT EXISTS email VARCHAR(150) NULL;
ALTER TABLE IF EXISTS app_user ADD COLUMN IF NOT EXISTS role VARCHAR(50) NULL;
UPDATE app_user SET role = COALESCE(role, role_code, 'viewer') WHERE role IS NULL;

CREATE TABLE IF NOT EXISTS semaforo_binding (
  id BIGSERIAL PRIMARY KEY,
  semaforo_device_id BIGINT NOT NULL REFERENCES semaforo_device(id) ON DELETE CASCADE,
  site_code VARCHAR(80) NOT NULL,
  site_map_id BIGINT NULL REFERENCES site_map(id) ON DELETE SET NULL,
  map_object_id BIGINT NULL REFERENCES map_object(id) ON DELETE SET NULL,
  map_code VARCHAR(80) NOT NULL,
  polygon_code VARCHAR(120) NULL,
  polygon_name VARCHAR(180) NULL,
  trigger_kind VARCHAR(40) NOT NULL DEFAULT 'manual_alert',
  red_command VARCHAR(40) NOT NULL DEFAULT 'rojo',
  green_command VARCHAR(40) NOT NULL DEFAULT 'verde',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_semaforo_binding_device_map_polygon_kind
ON semaforo_binding (semaforo_device_id, map_code, COALESCE(polygon_code, ''), trigger_kind);

-- compatibility for polygon ui tables
CREATE TABLE IF NOT EXISTS polygon_ui_config (
  id BIGSERIAL PRIMARY KEY,
  map_object_id BIGINT NOT NULL UNIQUE REFERENCES map_object(id) ON DELETE CASCADE,
  control_mode VARCHAR(40) NOT NULL DEFAULT 'manual',
  manual_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  automatic_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  state_set_code VARCHAR(40) NOT NULL DEFAULT 'binary_alert',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS polygon_ui_config_id BIGINT NULL;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS config_id BIGINT NULL;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS map_object_id BIGINT NULL;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS button_label VARCHAR(100) NULL;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS label VARCHAR(100) NULL;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS color_hex VARCHAR(20) NULL;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS button_color VARCHAR(20) NULL;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS overlay_color VARCHAR(20) NULL;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS overlay_opacity NUMERIC(5,4) NOT NULL DEFAULT 0.35;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE polygon_ui_state_option
SET polygon_ui_config_id = COALESCE(polygon_ui_config_id, config_id),
    config_id = COALESCE(config_id, polygon_ui_config_id),
    button_label = COALESCE(button_label, label, state_code),
    label = COALESCE(label, button_label, state_code),
    color_hex = COALESCE(color_hex, button_color, overlay_color),
    button_color = COALESCE(button_color, color_hex)
WHERE TRUE;

WITH org AS (
  SELECT id FROM organization ORDER BY id LIMIT 1
), s AS (
  SELECT * FROM (VALUES
    ('diamante','Diamante','diamante_main','Diamante principal','/legacy/diamante/map.png'),
    ('andesita','Andesita','andesita_main','Andesita principal','/legacy/andesita/ANDESITAMAP.jpg'),
    ('andes_norte','Andes Norte','andes_norte_main','Andes Norte principal','/legacy/andesnorte/ANNI/ANNI.jpg'),
    ('andes_norte_tunel_correa','Andes Norte Túnel Correa','andes_norte_tunel_correa','Túnel Correa','/legacy/tunnelcorrea/TC.jpg'),
    ('pilar_norte','Pilar Norte','pilar_norte_main','Pilar Norte principal','/legacy/andesnorte/ANNI/ANNI.jpg'),
    ('esmeralda','Esmeralda','esmeralda_main','Esmeralda principal','/legacy/diamante/map.png')
  ) AS t(site_code,site_name,map_code,map_name,image_url)
)
INSERT INTO site (id, organization_id, code, name, timezone, is_active)
SELECT COALESCE((SELECT MAX(id) FROM site),0) + ROW_NUMBER() OVER (), org.id, s.site_code, s.site_name, 'America/Santiago', TRUE
FROM s CROSS JOIN org
WHERE NOT EXISTS (SELECT 1 FROM site x WHERE x.code = s.site_code);

WITH m AS (
  SELECT * FROM (VALUES
    ('diamante','diamante_main','Diamante principal','/legacy/diamante/map.png'),
    ('andesita','andesita_main','Andesita principal','/legacy/andesita/ANDESITAMAP.jpg'),
    ('andes_norte','andes_norte_main','Andes Norte principal','/legacy/andesnorte/ANNI/ANNI.jpg'),
    ('andes_norte_tunel_correa','andes_norte_tunel_correa','Túnel Correa','/legacy/tunnelcorrea/TC.jpg'),
    ('pilar_norte','pilar_norte_main','Pilar Norte principal','/legacy/andesnorte/ANNI/ANNI.jpg'),
    ('esmeralda','esmeralda_main','Esmeralda principal','/legacy/diamante/map.png')
  ) AS t(site_code,map_code,map_name,image_url)
)
INSERT INTO site_map (id, site_id, code, name, image_url, is_active)
SELECT COALESCE((SELECT MAX(id) FROM site_map),0) + ROW_NUMBER() OVER (), s.id, m.map_code, m.map_name, m.image_url, TRUE
FROM m JOIN site s ON s.code = m.site_code
WHERE NOT EXISTS (SELECT 1 FROM site_map x WHERE x.code = m.map_code);

WITH objects(site_code,map_code,obj_code,obj_name,state_code) AS (
  VALUES
    ('diamante','diamante_main','diamante_pipa','Diamante PIPA','normal'),
    ('diamante','diamante_main','diamante_footprint_hw','FootPrint HW','normal'),
    ('diamante','diamante_main','diamante_footprint_fw','FootPrint FW','normal'),
    ('diamante','diamante_main','diamante_bajo_diamante_esmeralda','Bajo Diamante Esmeralda','centro'),
    ('andesita','andesita_main','andesita_norte_hw','Andesita Norte HW','centro'),
    ('andesita','andesita_main','andesita_norte_fw','Andesita Norte FW','centro'),
    ('andesita','andesita_main','andesita_sur_hw','Andesita Sur HW','centro'),
    ('andesita','andesita_main','andesita_sur_fw','Andesita Sur FW','centro'),
    ('andes_norte','andes_norte_main','ann_pilar_2','POLIGONO PILAR 2','centro'),
    ('andes_norte','andes_norte_main','ann_p4600','P 4600','normal'),
    ('andes_norte','andes_norte_main','ann_tc_oim','TC OIM','normal'),
    ('andes_norte_tunel_correa','andes_norte_tunel_correa','tc_oim','TC OIM','normal'),
    ('andes_norte_tunel_correa','andes_norte_tunel_correa','p_4600','P 4600','normal'),
    ('andes_norte_tunel_correa','andes_norte_tunel_correa','pilar_2_profundo','Polígono Pilar 2 Profundo','centro'),
    ('pilar_norte','pilar_norte_main','ann_pilar_2','POLIGONO PILAR 2','centro'),
    ('pilar_norte','pilar_norte_main','p_4600','P 4600','normal'),
    ('pilar_norte','pilar_norte_main','tc_oim','TC OIM','normal'),
    ('esmeralda','esmeralda_main','diamante_bajo_diamante_esmeralda','Bajo Diamante Esmeralda','centro'),
    ('esmeralda','esmeralda_main','esmeralda_sector_2','Esmeralda Sector 2','centro'),
    ('esmeralda','esmeralda_main','esmeralda_sector_3','Esmeralda Sector 3','centro')
)
INSERT INTO map_object (id, site_map_id, code, name, object_type, geometry_type, geometry_json, state_code, is_active)
SELECT COALESCE((SELECT MAX(id) FROM map_object),0) + ROW_NUMBER() OVER (), sm.id, o.obj_code, o.obj_name, 'polygon', 'polygon', '{}'::jsonb, o.state_code, TRUE
FROM objects o
JOIN site_map sm ON sm.code = o.map_code
WHERE NOT EXISTS (SELECT 1 FROM map_object x WHERE x.site_map_id = sm.id AND x.code = o.obj_code);

INSERT INTO polygon_ui_config (map_object_id, control_mode, manual_enabled, automatic_enabled, state_set_code, is_active)
SELECT mo.id,
       'manual', TRUE, TRUE,
       CASE WHEN mo.state_code IN ('inferior','centro','superior') THEN 'three_level' ELSE 'binary_alert' END,
       TRUE
FROM map_object mo
WHERE NOT EXISTS (SELECT 1 FROM polygon_ui_config cfg WHERE cfg.map_object_id = mo.id);

INSERT INTO polygon_ui_state_option (polygon_ui_config_id, config_id, map_object_id, state_code, button_label, label, color_hex, button_color, overlay_color, overlay_opacity, sort_order, is_visible, is_enabled)
SELECT cfg.id, cfg.id, mo.id, 'normal', 'NORMAL', 'NORMAL', '#67c46f', '#67c46f', '#67c46f', 0.35, 1, TRUE, TRUE
FROM polygon_ui_config cfg JOIN map_object mo ON mo.id = cfg.map_object_id
WHERE cfg.state_set_code = 'binary_alert'
  AND NOT EXISTS (SELECT 1 FROM polygon_ui_state_option x WHERE (x.map_object_id = mo.id OR x.polygon_ui_config_id = cfg.id OR x.config_id = cfg.id) AND x.state_code = 'normal');

INSERT INTO polygon_ui_state_option (polygon_ui_config_id, config_id, map_object_id, state_code, button_label, label, color_hex, button_color, overlay_color, overlay_opacity, sort_order, is_visible, is_enabled)
SELECT cfg.id, cfg.id, mo.id, 'alerta', 'ALERTA', 'ALERTA', '#d68a60', '#d68a60', '#d68a60', 0.35, 2, TRUE, TRUE
FROM polygon_ui_config cfg JOIN map_object mo ON mo.id = cfg.map_object_id
WHERE cfg.state_set_code = 'binary_alert'
  AND NOT EXISTS (SELECT 1 FROM polygon_ui_state_option x WHERE (x.map_object_id = mo.id OR x.polygon_ui_config_id = cfg.id OR x.config_id = cfg.id) AND x.state_code = 'alerta');

INSERT INTO polygon_ui_state_option (polygon_ui_config_id, config_id, map_object_id, state_code, button_label, label, color_hex, button_color, overlay_color, overlay_opacity, sort_order, is_visible, is_enabled)
SELECT cfg.id, cfg.id, mo.id, 'inferior', 'INFERIOR', 'INFERIOR', '#d68a60', '#d68a60', '#d68a60', 0.35, 1, TRUE, TRUE
FROM polygon_ui_config cfg JOIN map_object mo ON mo.id = cfg.map_object_id
WHERE cfg.state_set_code = 'three_level'
  AND NOT EXISTS (SELECT 1 FROM polygon_ui_state_option x WHERE (x.map_object_id = mo.id OR x.polygon_ui_config_id = cfg.id OR x.config_id = cfg.id) AND x.state_code = 'inferior');

INSERT INTO polygon_ui_state_option (polygon_ui_config_id, config_id, map_object_id, state_code, button_label, label, color_hex, button_color, overlay_color, overlay_opacity, sort_order, is_visible, is_enabled)
SELECT cfg.id, cfg.id, mo.id, 'centro', 'CENTRO', 'CENTRO', '#67c46f', '#67c46f', '#67c46f', 0.35, 2, TRUE, TRUE
FROM polygon_ui_config cfg JOIN map_object mo ON mo.id = cfg.map_object_id
WHERE cfg.state_set_code = 'three_level'
  AND NOT EXISTS (SELECT 1 FROM polygon_ui_state_option x WHERE (x.map_object_id = mo.id OR x.polygon_ui_config_id = cfg.id OR x.config_id = cfg.id) AND x.state_code = 'centro');

INSERT INTO polygon_ui_state_option (polygon_ui_config_id, config_id, map_object_id, state_code, button_label, label, color_hex, button_color, overlay_color, overlay_opacity, sort_order, is_visible, is_enabled)
SELECT cfg.id, cfg.id, mo.id, 'superior', 'SUPERIOR', 'SUPERIOR', '#d68a60', '#d68a60', '#d68a60', 0.35, 3, TRUE, TRUE
FROM polygon_ui_config cfg JOIN map_object mo ON mo.id = cfg.map_object_id
WHERE cfg.state_set_code = 'three_level'
  AND NOT EXISTS (SELECT 1 FROM polygon_ui_state_option x WHERE (x.map_object_id = mo.id OR x.polygon_ui_config_id = cfg.id OR x.config_id = cfg.id) AND x.state_code = 'superior');

WITH defs(site_code,site_name,net_prefix,obj1,obj2,obj3) AS (
  VALUES
    ('diamante','Diamante','192.168.10','diamante_pipa','diamante_footprint_hw','diamante_footprint_fw'),
    ('andesita','Andesita','192.168.20','andesita_norte_hw','andesita_norte_fw','andesita_sur_hw'),
    ('andes_norte','Andes Norte','192.168.30','ann_pilar_2','ann_p4600','ann_tc_oim'),
    ('andes_norte_tunel_correa','Túnel Correa','192.168.40','tc_oim','p_4600','pilar_2_profundo'),
    ('pilar_norte','Pilar Norte','192.168.50','ann_pilar_2','p_4600','tc_oim'),
    ('esmeralda','Esmeralda','192.168.60','diamante_bajo_diamante_esmeralda','esmeralda_sector_2','esmeralda_sector_3')
)
INSERT INTO semaforo_device (site_id, code, name, ip, plc_type, profile, port, unit_id, enabled, tags_json)
SELECT s.id,
       lower(replace(defs.site_code,'-','_')) || '_vial_0' || n.idx,
       defs.site_name || ' Vial 0' || n.idx,
       defs.net_prefix || '.' || (9 + n.idx),
       'delta', 'delta', 502, 1, TRUE,
       jsonb_build_object('verde_tag', CASE n.idx WHEN 1 THEN 'M1' WHEN 2 THEN 'M3' ELSE 'M5' END,
                          'rojo_tag', CASE n.idx WHEN 1 THEN 'M2' WHEN 2 THEN 'M4' ELSE 'M6' END)
FROM defs
JOIN site s ON s.code = defs.site_code
CROSS JOIN (VALUES (1),(2),(3)) AS n(idx)
WHERE NOT EXISTS (
  SELECT 1 FROM semaforo_device d
  WHERE d.code = lower(replace(defs.site_code,'-','_')) || '_vial_0' || n.idx
);

WITH defs(site_code,map_code,obj1,obj2,obj3) AS (
  VALUES
    ('diamante','diamante_main','diamante_pipa','diamante_footprint_hw','diamante_footprint_fw'),
    ('andesita','andesita_main','andesita_norte_hw','andesita_norte_fw','andesita_sur_hw'),
    ('andes_norte','andes_norte_main','ann_pilar_2','ann_p4600','ann_tc_oim'),
    ('andes_norte_tunel_correa','andes_norte_tunel_correa','tc_oim','p_4600','pilar_2_profundo'),
    ('pilar_norte','pilar_norte_main','ann_pilar_2','p_4600','tc_oim'),
    ('esmeralda','esmeralda_main','diamante_bajo_diamante_esmeralda','esmeralda_sector_2','esmeralda_sector_3')
), bindings AS (
  SELECT d.id AS semaforo_device_id,
         s.code AS site_code,
         defs.map_code,
         CASE right(d.code,1)
           WHEN '1' THEN defs.obj1
           WHEN '2' THEN defs.obj2
           ELSE defs.obj3
         END AS polygon_code
  FROM semaforo_device d
  JOIN site s ON s.id = d.site_id
  JOIN defs ON defs.site_code = s.code
)
INSERT INTO semaforo_binding (semaforo_device_id, site_code, site_map_id, map_object_id, map_code, polygon_code, polygon_name, trigger_kind, red_command, green_command, enabled)
SELECT b.semaforo_device_id, b.site_code, sm.id, mo.id, b.map_code, b.polygon_code, mo.name, 'manual_alert', 'rojo', 'verde', TRUE
FROM bindings b
LEFT JOIN site_map sm ON sm.code = b.map_code
LEFT JOIN map_object mo ON mo.site_map_id = sm.id AND mo.code = b.polygon_code
WHERE NOT EXISTS (
  SELECT 1 FROM semaforo_binding x
  WHERE x.semaforo_device_id = b.semaforo_device_id
    AND x.map_code = b.map_code
    AND COALESCE(x.polygon_code,'') = COALESCE(b.polygon_code,'')
    AND x.trigger_kind = 'manual_alert'
);

COMMIT;
