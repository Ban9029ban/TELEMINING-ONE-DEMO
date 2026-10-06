CREATE TABLE IF NOT EXISTS semaforo_binding (
    id BIGSERIAL PRIMARY KEY,
    semaforo_device_id BIGINT NOT NULL REFERENCES semaforo_device(id) ON DELETE CASCADE,
    site_code VARCHAR(80) NULL,
    site_map_code VARCHAR(120) NULL,
    map_object_code VARCHAR(120) NULL,
    polygon_name VARCHAR(180) NULL,
    trigger_kind VARCHAR(40) NOT NULL DEFAULT 'any',
    red_command VARCHAR(40) NOT NULL DEFAULT 'rojo',
    green_command VARCHAR(40) NOT NULL DEFAULT 'verde',
    emergency_scope VARCHAR(40) NOT NULL DEFAULT 'site',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE semaforo_action_log ADD COLUMN IF NOT EXISTS site_code VARCHAR(80) NULL;
ALTER TABLE semaforo_action_log ADD COLUMN IF NOT EXISTS map_object_code VARCHAR(120) NULL;
ALTER TABLE semaforo_action_log ADD COLUMN IF NOT EXISTS device_ip VARCHAR(80) NULL;
ALTER TABLE semaforo_action_log ADD COLUMN IF NOT EXISTS payload_json JSONB NULL;
