BEGIN;

ALTER TABLE IF EXISTS semaforo_binding ADD COLUMN IF NOT EXISTS site_code VARCHAR(80);
ALTER TABLE IF EXISTS semaforo_binding ADD COLUMN IF NOT EXISTS map_code VARCHAR(80);
ALTER TABLE IF EXISTS semaforo_binding ADD COLUMN IF NOT EXISTS site_map_code VARCHAR(80);
ALTER TABLE IF EXISTS semaforo_binding ADD COLUMN IF NOT EXISTS site_map_id BIGINT;
ALTER TABLE IF EXISTS semaforo_binding ADD COLUMN IF NOT EXISTS map_object_id BIGINT;
ALTER TABLE IF EXISTS semaforo_binding ADD COLUMN IF NOT EXISTS polygon_code VARCHAR(120);
ALTER TABLE IF EXISTS semaforo_binding ADD COLUMN IF NOT EXISTS button_action VARCHAR(40);
ALTER TABLE IF EXISTS semaforo_binding ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE IF EXISTS semaforo_binding ADD COLUMN IF NOT EXISTS trigger_kind VARCHAR(40) NOT NULL DEFAULT 'manual';

ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS color_hex VARCHAR(20);
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS button_color VARCHAR(40);
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS overlay_color VARCHAR(40);
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS fill_color VARCHAR(40);
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS button_label VARCHAR(80);
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS map_object_id BIGINT;
ALTER TABLE IF EXISTS polygon_ui_state_option ADD COLUMN IF NOT EXISTS config_id BIGINT;

UPDATE polygon_ui_state_option pso
SET config_id = puc.id
FROM polygon_ui_config puc
WHERE pso.config_id IS NULL
  AND pso.map_object_id IS NOT NULL
  AND puc.map_object_id = pso.map_object_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='polygon_ui_state_option' AND column_name='polygon_ui_config_id'
  ) THEN
    EXECUTE 'UPDATE polygon_ui_state_option SET polygon_ui_config_id = COALESCE(polygon_ui_config_id, config_id) WHERE polygon_ui_config_id IS NULL';
  END IF;
END $$;

UPDATE semaforo_binding sb
SET map_code = sm.code
FROM site_map sm
WHERE sb.map_code IS NULL AND sb.site_map_id = sm.id;

UPDATE semaforo_binding sb
SET site_map_code = COALESCE(sb.site_map_code, sb.map_code)
WHERE sb.site_map_code IS NULL;

UPDATE semaforo_binding sb
SET polygon_code = mo.code
FROM map_object mo
WHERE sb.polygon_code IS NULL AND sb.map_object_id = mo.id;

WITH site_targets AS (
  SELECT s.id AS site_id, s.code AS site_code,
         CASE s.code
           WHEN 'diamante' THEN '192.168.10.'
           WHEN 'andesita' THEN '192.168.20.'
           WHEN 'andes_norte' THEN '192.168.30.'
           WHEN 'andes_norte_tunel_correa' THEN '192.168.40.'
           WHEN 'pilar_norte' THEN '192.168.50.'
           WHEN 'esmeralda' THEN '192.168.60.'
           ELSE NULL
         END AS prefix
  FROM site s
  WHERE s.code IN ('diamante','andesita','andes_norte','andes_norte_tunel_correa','pilar_norte','esmeralda')
), numbered AS (
  SELECT site_id, site_code, prefix, n
  FROM site_targets CROSS JOIN generate_series(1,3) AS n
  WHERE prefix IS NOT NULL
)
INSERT INTO semaforo_device (site_id, code, name, ip, plc_type, profile, port, unit_id, enabled, tags_json)
SELECT n.site_id,
       n.site_code || '_vial_' || LPAD(n.n::text, 2, '0'),
       INITCAP(REPLACE(n.site_code, '_', ' ')) || ' Vial ' || LPAD(n.n::text, 2, '0'),
       n.prefix || (9 + n.n)::text,
       'delta', 'delta', 502, 1, TRUE,
       CASE n.site_code
         WHEN 'diamante' THEN jsonb_build_object('verde_tag', CASE n.n WHEN 1 THEN 'M1' WHEN 2 THEN 'M3' ELSE 'M5' END, 'rojo_tag', CASE n.n WHEN 1 THEN 'M2' WHEN 2 THEN 'M4' ELSE 'M6' END)
         ELSE jsonb_build_object('verde_tag', 'M1', 'rojo_tag', 'M2')
       END
FROM numbered n
WHERE NOT EXISTS (
  SELECT 1 FROM semaforo_device sd
  WHERE sd.site_id = n.site_id AND sd.ip = n.prefix || (9 + n.n)::text
);

INSERT INTO semaforo_binding (semaforo_device_id, site_code, map_code, site_map_code, trigger_kind, enabled)
SELECT sd.id, s.code, s.code, s.code, 'manual', TRUE
FROM semaforo_device sd
JOIN site s ON s.id = sd.site_id
WHERE NOT EXISTS (
  SELECT 1 FROM semaforo_binding sb WHERE sb.semaforo_device_id = sd.id
);

COMMIT;
