-- 006_runtime_compat_and_semaforo_bindings.sql
-- Compatibilidad de esquema + seed de semáforos por plano

BEGIN;

ALTER TABLE IF EXISTS app_user ADD COLUMN IF NOT EXISTS email VARCHAR(180) NULL;
ALTER TABLE IF EXISTS app_user ADD COLUMN IF NOT EXISTS role VARCHAR(40) NULL;
UPDATE app_user SET role = COALESCE(role, role_code, 'viewer') WHERE role IS NULL;
UPDATE app_user SET email = COALESCE(email, username || '@local.invalid') WHERE email IS NULL;

ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS config_id BIGINT NULL;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS map_object_id BIGINT NULL;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS button_label VARCHAR(40) NULL;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS color_hex VARCHAR(20) NULL;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE polygon_ui_state_option SET button_label = COALESCE(button_label, label, state_code) WHERE button_label IS NULL;
UPDATE polygon_ui_state_option SET color_hex = COALESCE(color_hex, button_color, overlay_color, fill_color) WHERE color_hex IS NULL;
UPDATE polygon_ui_state_option pso
SET map_object_id = cfg.map_object_id
FROM polygon_ui_config cfg
WHERE pso.map_object_id IS NULL
  AND (pso.config_id = cfg.id OR pso.polygon_ui_config_id = cfg.id);
UPDATE polygon_ui_state_option pso
SET config_id = cfg.id
FROM polygon_ui_config cfg
WHERE pso.config_id IS NULL
  AND pso.map_object_id = cfg.map_object_id;

CREATE TABLE IF NOT EXISTS semaforo_binding (
  id BIGSERIAL PRIMARY KEY,
  semaforo_device_id BIGINT NOT NULL REFERENCES semaforo_device(id) ON DELETE CASCADE,
  map_object_id BIGINT NULL REFERENCES map_object(id) ON DELETE CASCADE,
  trigger_kind VARCHAR(40) NOT NULL DEFAULT 'manual_alert',
  red_command VARCHAR(40) NOT NULL DEFAULT 'rojo',
  green_command VARCHAR(40) NOT NULL DEFAULT 'verde',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(semaforo_device_id, map_object_id, trigger_kind)
);

-- Sitios faltantes
INSERT INTO site (organization_id, code, name, is_active)
SELECT 1, 'esmeralda', 'Esmeralda', TRUE
WHERE NOT EXISTS (SELECT 1 FROM site WHERE code = 'esmeralda');
INSERT INTO site (organization_id, code, name, is_active)
SELECT 1, 'andes_norte_tunel_correa', 'Andes Norte Tunel Correa', TRUE
WHERE NOT EXISTS (SELECT 1 FROM site WHERE code = 'andes_norte_tunel_correa');
INSERT INTO site (organization_id, code, name, is_active)
SELECT 1, 'pilar_norte', 'Pilar Norte', TRUE
WHERE NOT EXISTS (SELECT 1 FROM site WHERE code = 'pilar_norte');

INSERT INTO site_map (site_id, code, name, image_url, is_active)
SELECT s.id, 'esmeralda_main', 'Esmeralda principal', '/assets/legacy/map.png', TRUE FROM site s
WHERE s.code='esmeralda' AND NOT EXISTS (SELECT 1 FROM site_map WHERE code='esmeralda_main');
INSERT INTO site_map (site_id, code, name, image_url, is_active)
SELECT s.id, 'andes_norte_tunel_correa_main', 'Tunel Correa principal', '/legacy/tunnelcorrea/TC.jpg', TRUE FROM site s
WHERE s.code='andes_norte_tunel_correa' AND NOT EXISTS (SELECT 1 FROM site_map WHERE code='andes_norte_tunel_correa_main');
INSERT INTO site_map (site_id, code, name, image_url, is_active)
SELECT s.id, 'pilar_norte_main', 'Pilar Norte principal', '/assets/legacy/ANNI/ANNI.jpg', TRUE FROM site s
WHERE s.code='pilar_norte' AND NOT EXISTS (SELECT 1 FROM site_map WHERE code='pilar_norte_main');

-- Map objects mínimos para amarrar bindings si faltan
INSERT INTO map_object (site_map_id, code, name, object_type, geometry_type, geometry_json, state_code, is_active)
SELECT sm.id, 'esmeralda_centro', 'Bajo Diamante Esmeralda', 'polygon', 'polygon', '{"points":[[760,420],[1040,420],[1040,560],[760,560]]}'::jsonb, 'centro', TRUE
FROM site_map sm WHERE sm.code='esmeralda_main'
  AND NOT EXISTS (SELECT 1 FROM map_object WHERE code='esmeralda_centro');
INSERT INTO map_object (site_map_id, code, name, object_type, geometry_type, geometry_json, state_code, is_active)
SELECT sm.id, 'poligono_pilar_2', 'Poligono Pilar 2', 'polygon', 'polygon', '{"points":[[960,360],[1030,360],[1030,430],[960,430]]}'::jsonb, 'centro', TRUE
FROM site_map sm WHERE sm.code='pilar_norte_main'
  AND NOT EXISTS (SELECT 1 FROM map_object WHERE code='poligono_pilar_2' AND site_map_id=sm.id);
INSERT INTO map_object (site_map_id, code, name, object_type, geometry_type, geometry_json, state_code, is_active)
SELECT sm.id, 'tc_oim', 'TC OIM', 'polygon', 'polygon', '{"points":[[1120,150],[1410,150],[1410,360],[1120,360]]}'::jsonb, 'normal', TRUE
FROM site_map sm WHERE sm.code='andes_norte_tunel_correa_main'
  AND NOT EXISTS (SELECT 1 FROM map_object WHERE code='tc_oim' AND site_map_id=sm.id);

-- 3 semáforos por plano / segmento de red
WITH seed(site_code, idx, ip, red_tag, green_tag) AS (
  VALUES
    ('diamante',1,'192.168.10.10','M2','M1'),('diamante',2,'192.168.10.11','M4','M3'),('diamante',3,'192.168.10.12','M6','M5'),
    ('andesita',1,'192.168.20.10','M2','M1'),('andesita',2,'192.168.20.11','M4','M3'),('andesita',3,'192.168.20.12','M6','M5'),
    ('andes_norte',1,'192.168.30.10','M2','M1'),('andes_norte',2,'192.168.30.11','M4','M3'),('andes_norte',3,'192.168.30.12','M6','M5'),
    ('andes_norte_tunel_correa',1,'192.168.40.10','M2','M1'),('andes_norte_tunel_correa',2,'192.168.40.11','M4','M3'),('andes_norte_tunel_correa',3,'192.168.40.12','M6','M5'),
    ('pilar_norte',1,'192.168.50.10','M2','M1'),('pilar_norte',2,'192.168.50.11','M4','M3'),('pilar_norte',3,'192.168.50.12','M6','M5'),
    ('esmeralda',1,'192.168.60.10','M2','M1'),('esmeralda',2,'192.168.60.11','M4','M3'),('esmeralda',3,'192.168.60.12','M6','M5')
)
INSERT INTO semaforo_device (site_id, code, name, ip, plc_type, profile, port, unit_id, enabled, tags_json)
SELECT s.id,
       seed.site_code || '_vial_' || LPAD(seed.idx::text, 2, '0'),
       INITCAP(REPLACE(seed.site_code, '_', ' ')) || ' Vial ' || LPAD(seed.idx::text, 2, '0'),
       seed.ip,
       'delta','delta',502,1,TRUE,
       jsonb_build_object('verde_tag', seed.green_tag, 'rojo_tag', seed.red_tag)
FROM seed
JOIN site s ON s.code = seed.site_code
WHERE NOT EXISTS (
  SELECT 1 FROM semaforo_device d WHERE d.code = seed.site_code || '_vial_' || LPAD(seed.idx::text, 2, '0')
);

-- reglas por sitio
INSERT INTO semaforo_rule (site_id, code, name, enabled, action_enabled, trigger_source, target_state_code, min_consecutive_polls, dwell_seconds, command_on_trigger, command_on_recover, allow_touch_traffic, site_scope_json)
SELECT s.id, s.code || '_critical_all_red', s.name || ' crítico -> todos rojo', TRUE, TRUE, 'remote_state', 'critical', 1, 30, 'rojo', 'verde', TRUE,
       jsonb_build_object('site_code', s.code, 'scope', 'all')
FROM site s
WHERE s.code IN ('diamante','andesita','andes_norte','andes_norte_tunel_correa','pilar_norte','esmeralda')
  AND NOT EXISTS (SELECT 1 FROM semaforo_rule r WHERE r.code = s.code || '_critical_all_red');

-- bindings: cada semáforo queda amarrado al sitio y a un polígono real del plano si existe
WITH candidate_objects AS (
  SELECT s.code AS site_code, mo.id AS map_object_id, mo.name,
         ROW_NUMBER() OVER (PARTITION BY s.code ORDER BY mo.id) AS rn
  FROM site s
  JOIN site_map sm ON sm.site_id = s.id
  JOIN map_object mo ON mo.site_map_id = sm.id
  WHERE s.code IN ('diamante','andesita','andes_norte','andes_norte_tunel_correa','pilar_norte','esmeralda')
), candidate_devices AS (
  SELECT s.code AS site_code, d.id AS semaforo_device_id,
         ROW_NUMBER() OVER (PARTITION BY s.code ORDER BY d.id) AS rn
  FROM semaforo_device d
  JOIN site s ON s.id = d.site_id
  WHERE s.code IN ('diamante','andesita','andes_norte','andes_norte_tunel_correa','pilar_norte','esmeralda')
)
INSERT INTO semaforo_binding (semaforo_device_id, map_object_id, trigger_kind, red_command, green_command, enabled)
SELECT d.semaforo_device_id, o.map_object_id, 'manual_alert', 'rojo', 'verde', TRUE
FROM candidate_devices d
JOIN candidate_objects o ON o.site_code = d.site_code AND o.rn = d.rn
WHERE NOT EXISTS (
  SELECT 1 FROM semaforo_binding sb WHERE sb.semaforo_device_id = d.semaforo_device_id AND sb.map_object_id = o.map_object_id AND sb.trigger_kind='manual_alert'
);

COMMIT;
