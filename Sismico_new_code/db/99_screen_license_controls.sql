-- Screen licensing / MAC tracking
ALTER TABLE IF EXISTS screen ADD COLUMN IF NOT EXISTS client_ip VARCHAR(80) NULL;
ALTER TABLE IF EXISTS screen ADD COLUMN IF NOT EXISTS mac_address VARCHAR(80) NULL;
ALTER TABLE IF EXISTS screen ADD COLUMN IF NOT EXISTS license_plan VARCHAR(30) NOT NULL DEFAULT 'unlimited';
ALTER TABLE IF EXISTS screen ADD COLUMN IF NOT EXISTS license_status VARCHAR(30) NOT NULL DEFAULT 'licensed';
ALTER TABLE IF EXISTS screen ADD COLUMN IF NOT EXISTS license_expires_at TIMESTAMPTZ NULL;
ALTER TABLE IF EXISTS screen ADD COLUMN IF NOT EXISTS license_days INTEGER NULL;

UPDATE screen SET license_plan = COALESCE(NULLIF(license_plan, ''), 'unlimited');
UPDATE screen SET license_status = COALESCE(NULLIF(license_status, ''), 'licensed');
