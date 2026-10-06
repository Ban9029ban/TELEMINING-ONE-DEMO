DO $$
DECLARE
    t TEXT;
    seq_name TEXT;
    max_id BIGINT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'organization','site','site_map','map_object','screen','screen_heartbeat',
        'alert_event','remote_source','remote_endpoint','polling_run','app_user',
        'sismico_sync_run','object_current_state','object_state_event',
        'semaforo_device','semaforo_rule','semaforo_action_log'
    ] LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
            seq_name := t || '_id_seq';
            EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I', seq_name);
            EXECUTE format('ALTER TABLE %I ALTER COLUMN id SET DEFAULT nextval(%L::regclass)', t, seq_name);
            EXECUTE format('SELECT COALESCE(MAX(id), 0) FROM %I', t) INTO max_id;
            EXECUTE format('SELECT setval(%L::regclass, %s, true)', seq_name, max_id);
        END IF;
    END LOOP;
END $$;

ALTER TABLE object_current_state ADD COLUMN IF NOT EXISTS site_id BIGINT;
UPDATE object_current_state ocs
SET site_id = sm.site_id
FROM map_object mo
JOIN site_map sm ON sm.id = mo.site_map_id
WHERE mo.id = ocs.map_object_id
  AND ocs.site_id IS NULL;
ALTER TABLE object_current_state ALTER COLUMN site_id SET NOT NULL;
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'object_current_state' AND constraint_name = 'object_current_state_site_id_fkey'
    ) THEN
        ALTER TABLE object_current_state ADD CONSTRAINT object_current_state_site_id_fkey FOREIGN KEY (site_id) REFERENCES site(id);
    END IF;
END $$;
ALTER TABLE object_current_state ADD COLUMN IF NOT EXISTS source_status VARCHAR(20) NOT NULL DEFAULT 'unknown';

ALTER TABLE object_state_event ADD COLUMN IF NOT EXISTS site_id BIGINT;
UPDATE object_state_event ose
SET site_id = sm.site_id
FROM map_object mo
JOIN site_map sm ON sm.id = mo.site_map_id
WHERE mo.id = ose.map_object_id
  AND ose.site_id IS NULL;
ALTER TABLE object_state_event ALTER COLUMN site_id SET NOT NULL;
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'object_state_event' AND constraint_name = 'object_state_event_site_id_fkey'
    ) THEN
        ALTER TABLE object_state_event ADD CONSTRAINT object_state_event_site_id_fkey FOREIGN KEY (site_id) REFERENCES site(id);
    END IF;
END $$;
ALTER TABLE object_state_event ADD COLUMN IF NOT EXISTS sync_run_id BIGINT;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sismico_sync_run')
       AND NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'object_state_event' AND constraint_name = 'object_state_event_sync_run_id_fkey'
    ) THEN
        ALTER TABLE object_state_event ADD CONSTRAINT object_state_event_sync_run_id_fkey FOREIGN KEY (sync_run_id) REFERENCES sismico_sync_run(id);
    END IF;
END $$;
ALTER TABLE object_state_event ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE sismico_sync_run ADD COLUMN IF NOT EXISTS site_code VARCHAR(80);
UPDATE sismico_sync_run sr
SET site_code = s.code
FROM site s
WHERE s.id = sr.site_id
  AND sr.site_code IS NULL;
