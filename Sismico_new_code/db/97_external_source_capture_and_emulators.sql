CREATE TABLE IF NOT EXISTS external_source_capture (
    id BIGSERIAL PRIMARY KEY,
    batch_id VARCHAR(64) NOT NULL,
    site_id BIGINT NULL REFERENCES site(id),
    remote_source_id BIGINT NULL REFERENCES remote_source(id),
    remote_endpoint_id BIGINT NULL REFERENCES remote_endpoint(id),
    site_code VARCHAR(80) NULL,
    source_code VARCHAR(120) NULL,
    endpoint_code VARCHAR(120) NULL,
    endpoint_name VARCHAR(180) NULL,
    endpoint_url TEXT NOT NULL,
    parser_type VARCHAR(80) NULL,
    endpoint_kind VARCHAR(80) NULL,
    content_type VARCHAR(200) NULL,
    http_status INTEGER NULL,
    ok BOOLEAN NOT NULL DEFAULT FALSE,
    is_binary BOOLEAN NOT NULL DEFAULT FALSE,
    body_text TEXT NULL,
    body_base64 TEXT NULL,
    body_sha256 VARCHAR(64) NULL,
    body_size INTEGER NULL,
    request_duration_ms INTEGER NULL,
    source_origin VARCHAR(40) NOT NULL DEFAULT 'external',
    derived_from_url TEXT NULL,
    extra_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_external_source_capture_endpoint_code ON external_source_capture(endpoint_code);
CREATE INDEX IF NOT EXISTS idx_external_source_capture_site_code ON external_source_capture(site_code);
CREATE INDEX IF NOT EXISTS idx_external_source_capture_observed_at ON external_source_capture(observed_at DESC);
