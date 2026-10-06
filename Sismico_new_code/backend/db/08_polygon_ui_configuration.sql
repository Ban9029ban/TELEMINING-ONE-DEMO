CREATE TABLE IF NOT EXISTS polygon_ui_config (
    id BIGSERIAL PRIMARY KEY,
    map_object_id BIGINT NOT NULL UNIQUE REFERENCES map_object(id) ON DELETE CASCADE,
    control_mode VARCHAR(40) NOT NULL DEFAULT 'manual_off',
    manual_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    automatic_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    state_set_code VARCHAR(40) NOT NULL DEFAULT 'binary_alert',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE polygon_ui_config ALTER COLUMN control_mode TYPE VARCHAR(40);
ALTER TABLE polygon_ui_config ALTER COLUMN state_set_code TYPE VARCHAR(40);

CREATE TABLE IF NOT EXISTS polygon_ui_state_option (
    id BIGSERIAL PRIMARY KEY,
    config_id BIGINT NULL REFERENCES polygon_ui_config(id) ON DELETE CASCADE,
    map_object_id BIGINT NULL REFERENCES map_object(id) ON DELETE CASCADE,
    state_code VARCHAR(20) NOT NULL,
    button_label VARCHAR(40) NOT NULL,
    color_hex VARCHAR(20) NULL,
    sort_order INTEGER NOT NULL DEFAULT 1,
    is_visible BOOLEAN NOT NULL DEFAULT TRUE,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE polygon_ui_state_option ADD COLUMN IF NOT EXISTS config_id BIGINT NULL;
ALTER TABLE polygon_ui_state_option ADD COLUMN IF NOT EXISTS map_object_id BIGINT NULL;
ALTER TABLE polygon_ui_state_option ALTER COLUMN button_label TYPE VARCHAR(40);
ALTER TABLE polygon_ui_state_option ALTER COLUMN color_hex TYPE VARCHAR(20);

UPDATE polygon_ui_state_option pso
SET map_object_id = cfg.map_object_id
FROM polygon_ui_config cfg
WHERE pso.map_object_id IS NULL
  AND pso.config_id IS NOT NULL
  AND cfg.id = pso.config_id;

UPDATE polygon_ui_state_option pso
SET config_id = cfg.id
FROM polygon_ui_config cfg
WHERE pso.config_id IS NULL
  AND pso.map_object_id IS NOT NULL
  AND cfg.map_object_id = pso.map_object_id;
