CREATE TABLE IF NOT EXISTS object_current_state (
    id BIGSERIAL PRIMARY KEY,
    map_object_id BIGINT NOT NULL UNIQUE REFERENCES map_object(id),
    state_code VARCHAR(40) NOT NULL DEFAULT 'unknown',
    raw_value VARCHAR(80),
    source_name VARCHAR(120),
    observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS object_state_event (
    id BIGSERIAL PRIMARY KEY,
    map_object_id BIGINT NOT NULL REFERENCES map_object(id),
    state_code VARCHAR(40) NOT NULL,
    raw_value VARCHAR(80),
    source_name VARCHAR(120),
    observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS sismico_sync_run (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT REFERENCES site(id),
    site_code VARCHAR(80) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'completed',
    source_status VARCHAR(20) NOT NULL DEFAULT 'online',
    trigger_type VARCHAR(20) NOT NULL DEFAULT 'manual',
    processed_objects BIGINT NOT NULL DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);
