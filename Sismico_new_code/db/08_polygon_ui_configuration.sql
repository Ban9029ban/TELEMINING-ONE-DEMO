CREATE TABLE IF NOT EXISTS polygon_ui_config (
    id BIGSERIAL PRIMARY KEY,
    map_object_id BIGINT NOT NULL UNIQUE REFERENCES map_object(id) ON DELETE CASCADE,
    control_mode VARCHAR(20) NOT NULL DEFAULT 'manual',
    manual_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    automatic_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    state_set_code VARCHAR(50) NOT NULL DEFAULT 'binary_alert',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS polygon_ui_state_option (
    id BIGSERIAL PRIMARY KEY,
    polygon_ui_config_id BIGINT NOT NULL REFERENCES polygon_ui_config(id) ON DELETE CASCADE,
    state_code VARCHAR(50) NOT NULL,
    button_label VARCHAR(100) NOT NULL,
    button_color VARCHAR(20),
    overlay_color VARCHAR(20),
    overlay_opacity NUMERIC(5,4) NOT NULL DEFAULT 0.35,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE(polygon_ui_config_id, state_code)
);

CREATE INDEX IF NOT EXISTS idx_polygon_ui_config_map_object_id
    ON polygon_ui_config(map_object_id);

CREATE INDEX IF NOT EXISTS idx_polygon_ui_state_option_config_id
    ON polygon_ui_state_option(polygon_ui_config_id);

INSERT INTO polygon_ui_config (
    map_object_id,
    control_mode,
    manual_enabled,
    automatic_enabled,
    state_set_code,
    is_active
)
SELECT
    mo.id,
    'manual',
    TRUE,
    TRUE,
    CASE
        WHEN s.code IN ('andesita', 'andes-norte', 'andes_norte') THEN 'triple_level'
        ELSE 'binary_alert'
    END,
    TRUE
FROM map_object mo
JOIN site_map sm ON sm.id = mo.site_map_id
JOIN site s ON s.id = sm.site_id
LEFT JOIN polygon_ui_config cfg ON cfg.map_object_id = mo.id
WHERE cfg.id IS NULL;

INSERT INTO polygon_ui_state_option (
    polygon_ui_config_id,
    state_code,
    button_label,
    button_color,
    overlay_color,
    overlay_opacity,
    sort_order,
    is_enabled
)
SELECT
    cfg.id,
    vals.state_code,
    vals.button_label,
    vals.button_color,
    vals.overlay_color,
    vals.overlay_opacity,
    vals.sort_order,
    TRUE
FROM polygon_ui_config cfg
JOIN (
    SELECT
        'binary_alert'::varchar AS state_set_code,
        'normal'::varchar AS state_code,
        'NORMAL'::varchar AS button_label,
        '#9AC66D'::varchar AS button_color,
        NULL::varchar AS overlay_color,
        0.0000::numeric AS overlay_opacity,
        10 AS sort_order
    UNION ALL
    SELECT
        'binary_alert',
        'alerta',
        'ALERTA',
        '#CF815E',
        '#FF0000',
        0.3500,
        20
    UNION ALL
    SELECT
        'triple_level',
        'inferior',
        'INFERIOR',
        '#CF815E',
        NULL,
        0.0000,
        10
    UNION ALL
    SELECT
        'triple_level',
        'centro',
        'CENTRO',
        '#9AC66D',
        '#00FF00',
        0.3500,
        20
    UNION ALL
    SELECT
        'triple_level',
        'superior',
        'SUPERIOR',
        '#CF815E',
        '#FF0000',
        0.3500,
        30
) AS vals
    ON vals.state_set_code = cfg.state_set_code
LEFT JOIN polygon_ui_state_option existing
    ON existing.polygon_ui_config_id = cfg.id
   AND existing.state_code = vals.state_code
WHERE existing.id IS NULL;

CREATE OR REPLACE FUNCTION set_polygon_ui_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_polygon_ui_config_updated_at ON polygon_ui_config;

CREATE TRIGGER trg_polygon_ui_config_updated_at
BEFORE UPDATE ON polygon_ui_config
FOR EACH ROW
EXECUTE FUNCTION set_polygon_ui_config_updated_at();
