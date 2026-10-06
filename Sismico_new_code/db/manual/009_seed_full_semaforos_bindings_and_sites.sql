-- Compatibilidad base
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS email TEXT NULL;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS role VARCHAR(40) NULL;
UPDATE app_user SET role = COALESCE(role, role_code, 'viewer') WHERE role IS NULL;

CREATE TABLE IF NOT EXISTS semaforo_binding (
  id BIGSERIAL PRIMARY KEY,
  semaforo_device_id BIGINT NOT NULL REFERENCES semaforo_device(id) ON DELETE CASCADE,
  site_code VARCHAR(80) NULL,
  map_code VARCHAR(80) NULL,
  polygon_code VARCHAR(120) NULL,
  button_action VARCHAR(40) NULL,
  trigger_kind VARCHAR(40) NOT NULL DEFAULT 'manual',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE polygon_ui_state_option ADD COLUMN IF NOT EXISTS config_id BIGINT NULL;
ALTER TABLE polygon_ui_state_option ADD COLUMN IF NOT EXISTS map_object_id BIGINT NULL;
ALTER TABLE polygon_ui_state_option ADD COLUMN IF NOT EXISTS button_label VARCHAR(80) NULL;
ALTER TABLE polygon_ui_state_option ADD COLUMN IF NOT EXISTS color_hex VARCHAR(20) NULL;
ALTER TABLE polygon_ui_state_option ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE polygon_ui_state_option ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT TRUE;

INSERT INTO site (id, organization_id, code, name, timezone, is_active)
SELECT COALESCE((SELECT MAX(id) FROM site),0)+1, 1, v.code, v.name, 'America/Santiago', TRUE
FROM (VALUES
  ('andes_norte_tunel_correa','Andes Norte Túnel Correa'),
  ('pilar_norte','Pilar Norte'),
  ('esmeralda','Esmeralda')
) v(code,name)
WHERE NOT EXISTS (SELECT 1 FROM site s WHERE s.code=v.code);

INSERT INTO site_map (id, site_id, code, name, image_url, is_active)
SELECT COALESCE((SELECT MAX(id) FROM site_map),0)+ROW_NUMBER() OVER (), s.id, x.code, x.name, x.image_url, TRUE
FROM (
  VALUES
  ('diamante','diamante','Diamante','/legacy/diamante/map.png'),
  ('andesita','andesita','Andesita','/legacy/andesita/mapa_andesita.png'),
  ('andes_norte','andes_norte','Andes Norte','/legacy/andesnorte/ANNI/ANNI.jpg'),
  ('andes_norte_tunel_correa','andes_norte_tunel_correa','Andes Norte Túnel Correa','/legacy/tunnelcorrea/TC.jpg'),
  ('pilar_norte','pilar_norte','Pilar Norte','/legacy/andesnorte/ANNI/ANNI.jpg'),
  ('esmeralda','esmeralda','Esmeralda','/legacy/diamante/map.png')
) x(site_code, code, name, image_url)
JOIN site s ON s.code = x.site_code
WHERE NOT EXISTS (SELECT 1 FROM site_map sm WHERE sm.code=x.code);

INSERT INTO map_object (id, site_map_id, code, name, state_code, is_active)
SELECT COALESCE((SELECT MAX(id) FROM map_object),0)+ROW_NUMBER() OVER (), sm.id, x.code, x.name, x.state_code, TRUE
FROM (
  VALUES
  ('diamante','diamante_pipa','Diamante PIPA','normal'),
  ('diamante','diamante_footprint_fw','Diamante Footprint FW','normal'),
  ('diamante','diamante_footprint_hw','Diamante Footprint HW','normal'),
  ('diamante','diamante_bajo_diamante_esmeralda','Bajo Diamante Esmeralda','centro'),
  ('andes_norte','ann_pilar_2','POLIGONO PILAR 2','centro'),
  ('andes_norte_tunel_correa','tc_oim','TC OIM','normal'),
  ('andes_norte_tunel_correa','p_4600','P 4600','normal'),
  ('andes_norte_tunel_correa','pilar_2_profundo','POLÍGONO PILAR 2 PROFUNDO','centro'),
  ('pilar_norte','ann_pilar_2','POLIGONO PILAR 2','centro'),
  ('esmeralda','diamante_bajo_diamante_esmeralda','Bajo Diamante Esmeralda','centro')
) x(map_code, code, name, state_code)
JOIN site_map sm ON sm.code = x.map_code
WHERE NOT EXISTS (SELECT 1 FROM map_object mo WHERE mo.site_map_id = sm.id AND mo.code = x.code);

INSERT INTO polygon_ui_config (id, map_object_id, control_mode, manual_enabled, automatic_enabled, state_set_code, is_active)
SELECT COALESCE((SELECT MAX(id) FROM polygon_ui_config),0)+ROW_NUMBER() OVER (), mo.id, 'manual', TRUE, TRUE,
       CASE WHEN LOWER(mo.name) LIKE '%esmeralda%' OR LOWER(mo.name) LIKE '%pilar%' THEN 'three_level' ELSE 'binary_alert' END,
       TRUE
FROM map_object mo
LEFT JOIN polygon_ui_config cfg ON cfg.map_object_id = mo.id
WHERE cfg.id IS NULL;

UPDATE polygon_ui_state_option pso
SET config_id = COALESCE(config_id, polygon_ui_config_id, puc.id)
FROM polygon_ui_config puc
WHERE pso.map_object_id = puc.map_object_id AND (pso.config_id IS NULL OR (pso.polygon_ui_config_id IS NOT NULL AND pso.config_id IS NULL));

INSERT INTO polygon_ui_state_option (config_id, map_object_id, state_code, button_label, color_hex, sort_order, is_visible, is_enabled)
SELECT cfg.id, mo.id, x.state_code, x.button_label, x.color_hex, x.sort_order, TRUE, TRUE
FROM polygon_ui_config cfg
JOIN map_object mo ON mo.id = cfg.map_object_id
JOIN (
  VALUES
  ('binary_alert','normal','NORMAL','#67c46f',1),
  ('binary_alert','alerta','ALERTA','#d68a60',2),
  ('three_level','inferior','INFERIOR','#d68a60',1),
  ('three_level','centro','CENTRO','#67c46f',2),
  ('three_level','superior','SUPERIOR','#d68a60',3)
) x(state_set_code,state_code,button_label,color_hex,sort_order) ON x.state_set_code = cfg.state_set_code
WHERE NOT EXISTS (
  SELECT 1 FROM polygon_ui_state_option pso
  WHERE pso.map_object_id = mo.id AND pso.state_code = x.state_code
);

-- 3 semáforos por plano
INSERT INTO semaforo_device (id, site_id, code, name, ip, plc_type, profile, port, unit_id, enabled, tags_json)
SELECT COALESCE((SELECT MAX(id) FROM semaforo_device),0)+ROW_NUMBER() OVER (), s.id, x.code, x.name, x.ip, 'delta', 'delta', 502, 1, TRUE, CAST(x.tags_json AS jsonb)
FROM (
  VALUES
  ('diamante','diamante_vial_01','Diamante Vial 01','192.168.10.10','{"verde_tag":"M1","rojo_tag":"M2"}'),
  ('diamante','diamante_vial_02','Diamante Vial 02','192.168.10.11','{"verde_tag":"M3","rojo_tag":"M4"}'),
  ('diamante','diamante_vial_03','Diamante Vial 03','192.168.10.12','{"verde_tag":"M5","rojo_tag":"M6"}'),
  ('andesita','andesita_vial_01','Andesita Vial 01','192.168.20.10','{"verde_tag":"M1","rojo_tag":"M2"}'),
  ('andesita','andesita_vial_02','Andesita Vial 02','192.168.20.11','{"verde_tag":"M3","rojo_tag":"M4"}'),
  ('andesita','andesita_vial_03','Andesita Vial 03','192.168.20.12','{"verde_tag":"M5","rojo_tag":"M6"}'),
  ('andes_norte','andes_norte_vial_01','Andes Norte 01','192.168.30.10','{"verde_tag":"M1","rojo_tag":"M2"}'),
  ('andes_norte','andes_norte_vial_02','Andes Norte 02','192.168.30.11','{"verde_tag":"M3","rojo_tag":"M4"}'),
  ('andes_norte','andes_norte_vial_03','Andes Norte 03','192.168.30.12','{"verde_tag":"M5","rojo_tag":"M6"}'),
  ('andes_norte_tunel_correa','tunel_correa_vial_01','Tunel Correa 01','192.168.40.10','{"verde_tag":"M1","rojo_tag":"M2"}'),
  ('andes_norte_tunel_correa','tunel_correa_vial_02','Tunel Correa 02','192.168.40.11','{"verde_tag":"M3","rojo_tag":"M4"}'),
  ('andes_norte_tunel_correa','tunel_correa_vial_03','Tunel Correa 03','192.168.40.12','{"verde_tag":"M5","rojo_tag":"M6"}'),
  ('pilar_norte','pilar_norte_vial_01','Pilar Norte 01','192.168.50.10','{"verde_tag":"M1","rojo_tag":"M2"}'),
  ('pilar_norte','pilar_norte_vial_02','Pilar Norte 02','192.168.50.11','{"verde_tag":"M3","rojo_tag":"M4"}'),
  ('pilar_norte','pilar_norte_vial_03','Pilar Norte 03','192.168.50.12','{"verde_tag":"M5","rojo_tag":"M6"}'),
  ('esmeralda','esmeralda_vial_01','Esmeralda 01','192.168.60.10','{"verde_tag":"M7","rojo_tag":"M8"}'),
  ('esmeralda','esmeralda_vial_02','Esmeralda 02','192.168.60.11','{"verde_tag":"M8","rojo_tag":"M9"}'),
  ('esmeralda','esmeralda_vial_03','Esmeralda 03','192.168.60.12','{"verde_tag":"M7","rojo_tag":"M9"}')
) x(site_code, code, name, ip, tags_json)
JOIN site s ON s.code = x.site_code
WHERE NOT EXISTS (SELECT 1 FROM semaforo_device d WHERE d.code = x.code);

INSERT INTO semaforo_binding (semaforo_device_id, site_code, map_code, polygon_code, button_action, trigger_kind, enabled)
SELECT d.id, x.site_code, x.map_code, x.polygon_code, x.button_action, x.trigger_kind, TRUE
FROM (
  VALUES
  ('diamante_vial_01','diamante','diamante','diamante_pipa','alerta','manual'),
  ('diamante_vial_02','diamante','diamante','diamante_footprint_fw','alerta','manual'),
  ('diamante_vial_03','diamante','diamante','diamante_footprint_hw','alerta','manual'),
  ('andes_norte_vial_01','andes_norte','andes_norte','ann_pilar_2','superior','manual'),
  ('andes_norte_vial_02','andes_norte','andes_norte','ann_pilar_2','centro','automatic'),
  ('andes_norte_vial_03','andes_norte','andes_norte','ann_pilar_2','inferior','manual'),
  ('tunel_correa_vial_01','andes_norte_tunel_correa','andes_norte_tunel_correa','tc_oim','alerta','manual'),
  ('tunel_correa_vial_02','andes_norte_tunel_correa','andes_norte_tunel_correa','p_4600','alerta','manual'),
  ('tunel_correa_vial_03','andes_norte_tunel_correa','andes_norte_tunel_correa','pilar_2_profundo','superior','automatic'),
  ('pilar_norte_vial_01','pilar_norte','pilar_norte','ann_pilar_2','inferior','manual'),
  ('pilar_norte_vial_02','pilar_norte','pilar_norte','ann_pilar_2','centro','automatic'),
  ('pilar_norte_vial_03','pilar_norte','pilar_norte','ann_pilar_2','superior','manual'),
  ('esmeralda_vial_01','esmeralda','esmeralda','diamante_bajo_diamante_esmeralda','inferior','manual'),
  ('esmeralda_vial_02','esmeralda','esmeralda','diamante_bajo_diamante_esmeralda','centro','automatic'),
  ('esmeralda_vial_03','esmeralda','esmeralda','diamante_bajo_diamante_esmeralda','superior','manual')
) x(device_code, site_code, map_code, polygon_code, button_action, trigger_kind)
JOIN semaforo_device d ON d.code = x.device_code
WHERE NOT EXISTS (
  SELECT 1 FROM semaforo_binding sb WHERE sb.semaforo_device_id = d.id AND sb.polygon_code = x.polygon_code
);

INSERT INTO semaforo_rule (id, site_id, code, name, enabled, action_enabled, trigger_source, target_state_code, min_consecutive_polls, dwell_seconds, command_on_trigger, command_on_recover, allow_touch_traffic, site_scope_json)
SELECT COALESCE((SELECT MAX(id) FROM semaforo_rule),0)+ROW_NUMBER() OVER (), s.id, x.code, x.name, TRUE, TRUE, 'remote_state', 'critical', 1, 30, 'rojo', 'verde', TRUE,
       CAST(('{"site_code":"' || x.site_code || '","scope":"all"}') AS jsonb)
FROM (
  VALUES
  ('diamante','diamante_auto_red','Diamante crítico -> rojo'),
  ('andesita','andesita_auto_red','Andesita crítico -> rojo'),
  ('andes_norte','andes_norte_auto_red','Andes Norte crítico -> rojo'),
  ('andes_norte_tunel_correa','tunel_correa_auto_red','Tunel Correa crítico -> rojo'),
  ('pilar_norte','pilar_norte_auto_red','Pilar Norte crítico -> rojo'),
  ('esmeralda','esmeralda_auto_red','Esmeralda crítico -> rojo')
) x(site_code, code, name)
JOIN site s ON s.code = x.site_code
WHERE NOT EXISTS (SELECT 1 FROM semaforo_rule r WHERE r.code = x.code);
