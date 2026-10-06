-- Control matricial PLC / polígonos / auditoría
CREATE TABLE IF NOT EXISTS control_polygon (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES site(id) ON DELETE CASCADE,
    site_map_id BIGINT NULL REFERENCES site_map(id) ON DELETE SET NULL,
    map_object_id BIGINT NOT NULL UNIQUE REFERENCES map_object(id) ON DELETE CASCADE,
    polygon_code VARCHAR(120) NOT NULL UNIQUE,
    polygon_name VARCHAR(180) NOT NULL,
    plane_code VARCHAR(120) NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS control_polygon_plc (
    id BIGSERIAL PRIMARY KEY,
    control_polygon_id BIGINT NOT NULL REFERENCES control_polygon(id) ON DELETE CASCADE,
    semaforo_device_id BIGINT NOT NULL REFERENCES semaforo_device(id) ON DELETE CASCADE,
    execution_order INTEGER NOT NULL DEFAULT 1,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(control_polygon_id, semaforo_device_id)
);

CREATE TABLE IF NOT EXISTS control_state_matrix (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES site(id) ON DELETE CASCADE,
    control_polygon_id BIGINT NOT NULL REFERENCES control_polygon(id) ON DELETE CASCADE,
    semaforo_device_id BIGINT NOT NULL REFERENCES semaforo_device(id) ON DELETE CASCADE,
    target_state VARCHAR(40) NOT NULL,
    signal_code VARCHAR(40) NOT NULL,
    signal_value INTEGER NOT NULL DEFAULT 1,
    action_mode VARCHAR(20) NOT NULL DEFAULT 'write',
    pulse_ms INTEGER NULL,
    execution_order INTEGER NOT NULL DEFAULT 1,
    exclusive_group VARCHAR(120) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(control_polygon_id, semaforo_device_id, target_state, signal_code)
);

CREATE TABLE IF NOT EXISTS control_emergency_matrix (
    id BIGSERIAL PRIMARY KEY,
    scope_type VARCHAR(20) NOT NULL DEFAULT 'site',
    site_id BIGINT NULL REFERENCES site(id) ON DELETE CASCADE,
    control_polygon_id BIGINT NULL REFERENCES control_polygon(id) ON DELETE CASCADE,
    semaforo_device_id BIGINT NOT NULL REFERENCES semaforo_device(id) ON DELETE CASCADE,
    signal_code VARCHAR(40) NOT NULL,
    signal_value INTEGER NOT NULL DEFAULT 1,
    action_mode VARCHAR(20) NOT NULL DEFAULT 'write',
    pulse_ms INTEGER NULL,
    execution_order INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS control_reset_matrix (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES site(id) ON DELETE CASCADE,
    control_polygon_id BIGINT NULL REFERENCES control_polygon(id) ON DELETE CASCADE,
    semaforo_device_id BIGINT NOT NULL REFERENCES semaforo_device(id) ON DELETE CASCADE,
    signal_code VARCHAR(40) NOT NULL,
    signal_value INTEGER NOT NULL DEFAULT 0,
    action_mode VARCHAR(20) NOT NULL DEFAULT 'write',
    pulse_ms INTEGER NULL,
    execution_order INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS control_audit_log (
    id BIGSERIAL PRIMARY KEY,
    request_id VARCHAR(80) NOT NULL UNIQUE,
    site_id BIGINT NULL REFERENCES site(id) ON DELETE SET NULL,
    site_code VARCHAR(80) NULL,
    plane_code VARCHAR(120) NULL,
    polygon_code VARCHAR(120) NULL,
    action_type VARCHAR(40) NOT NULL DEFAULT 'state_change',
    target_state VARCHAR(40) NULL,
    requested_by VARCHAR(120) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    resolved_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    execution_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS control_audit_log_detail (
    id BIGSERIAL PRIMARY KEY,
    audit_log_id BIGINT NOT NULL REFERENCES control_audit_log(id) ON DELETE CASCADE,
    semaforo_device_id BIGINT NULL REFERENCES semaforo_device(id) ON DELETE SET NULL,
    device_ip VARCHAR(80) NULL,
    signal_code VARCHAR(40) NOT NULL,
    signal_value INTEGER NOT NULL DEFAULT 0,
    action_mode VARCHAR(20) NOT NULL DEFAULT 'write',
    pulse_ms INTEGER NULL,
    execution_order INTEGER NOT NULL DEFAULT 1,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    stdout TEXT NULL,
    stderr TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_control_state_matrix_polygon_state ON control_state_matrix(control_polygon_id, target_state);
CREATE INDEX IF NOT EXISTS idx_control_state_matrix_device ON control_state_matrix(semaforo_device_id);
CREATE INDEX IF NOT EXISTS idx_control_emergency_matrix_scope ON control_emergency_matrix(scope_type, site_id, control_polygon_id);
CREATE INDEX IF NOT EXISTS idx_control_reset_matrix_polygon ON control_reset_matrix(control_polygon_id);
CREATE INDEX IF NOT EXISTS idx_control_audit_log_request ON control_audit_log(request_id);
