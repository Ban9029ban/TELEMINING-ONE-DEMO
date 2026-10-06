ALTER TABLE IF EXISTS object_current_state ADD COLUMN IF NOT EXISTS site_id BIGINT NULL;
ALTER TABLE IF EXISTS object_current_state ADD COLUMN IF NOT EXISTS source_status VARCHAR(20) NOT NULL DEFAULT 'unknown';
ALTER TABLE IF EXISTS object_state_event ADD COLUMN IF NOT EXISTS site_id BIGINT NULL;
ALTER TABLE IF EXISTS object_state_event ADD COLUMN IF NOT EXISTS sync_run_id BIGINT NULL;
ALTER TABLE IF EXISTS object_state_event ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE object_current_state ocs
SET site_id = sm.site_id
FROM map_object mo
JOIN site_map sm ON sm.id = mo.site_map_id
WHERE mo.id = ocs.map_object_id
  AND ocs.site_id IS NULL;

DO $$
DECLARE
    t text;
    seq_name text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'organization','site','site_map','map_object','remote_source','remote_endpoint',
        'sismico_sync_run','object_current_state','object_state_event',
        'semaforo_device','semaforo_rule','semaforo_action_log'
    ]
    LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = t
        ) THEN
            seq_name := format('%I_id_seq', t);
            EXECUTE format('CREATE SEQUENCE IF NOT EXISTS public.%I', seq_name);
            EXECUTE format(
                'ALTER TABLE public.%I ALTER COLUMN id SET DEFAULT nextval(%L::regclass)',
                t,
                format('public.%I', seq_name)
            );
            EXECUTE format(
                'SELECT setval(%L::regclass, COALESCE((SELECT MAX(id) FROM public.%I), 0), true)',
                format('public.%I', seq_name),
                t
            );
        END IF;
    END LOOP;
END $$;
