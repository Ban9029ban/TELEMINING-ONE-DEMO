-- V15: compatibility patches for mixed legacy/current schemas
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='organization') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='organization' AND column_name='id') THEN
      IF NOT EXISTS (SELECT 1 FROM information_schema.sequences WHERE sequence_schema='public' AND sequence_name='organization_id_seq') THEN
        CREATE SEQUENCE public.organization_id_seq;
      END IF;
      EXECUTE 'SELECT setval(''public.organization_id_seq'', GREATEST(COALESCE((SELECT MAX(id) FROM public.organization), 0), 1), true)';
      ALTER TABLE public.organization ALTER COLUMN id SET DEFAULT nextval('public.organization_id_seq');
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='site') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='site' AND column_name='id') THEN
      IF NOT EXISTS (SELECT 1 FROM information_schema.sequences WHERE sequence_schema='public' AND sequence_name='site_id_seq') THEN
        CREATE SEQUENCE public.site_id_seq;
      END IF;
      EXECUTE 'SELECT setval(''public.site_id_seq'', GREATEST(COALESCE((SELECT MAX(id) FROM public.site), 0), 1), true)';
      ALTER TABLE public.site ALTER COLUMN id SET DEFAULT nextval('public.site_id_seq');
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='site_map') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='site_map' AND column_name='id') THEN
      IF NOT EXISTS (SELECT 1 FROM information_schema.sequences WHERE sequence_schema='public' AND sequence_name='site_map_id_seq') THEN
        CREATE SEQUENCE public.site_map_id_seq;
      END IF;
      EXECUTE 'SELECT setval(''public.site_map_id_seq'', GREATEST(COALESCE((SELECT MAX(id) FROM public.site_map), 0), 1), true)';
      ALTER TABLE public.site_map ALTER COLUMN id SET DEFAULT nextval('public.site_map_id_seq');
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='map_object') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='map_object' AND column_name='id') THEN
      IF NOT EXISTS (SELECT 1 FROM information_schema.sequences WHERE sequence_schema='public' AND sequence_name='map_object_id_seq') THEN
        CREATE SEQUENCE public.map_object_id_seq;
      END IF;
      EXECUTE 'SELECT setval(''public.map_object_id_seq'', GREATEST(COALESCE((SELECT MAX(id) FROM public.map_object), 0), 1), true)';
      ALTER TABLE public.map_object ALTER COLUMN id SET DEFAULT nextval('public.map_object_id_seq');
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='polygon_ui_config') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='polygon_ui_config' AND column_name='id') THEN
      IF NOT EXISTS (SELECT 1 FROM information_schema.sequences WHERE sequence_schema='public' AND sequence_name='polygon_ui_config_id_seq') THEN
        CREATE SEQUENCE public.polygon_ui_config_id_seq;
      END IF;
      EXECUTE 'SELECT setval(''public.polygon_ui_config_id_seq'', GREATEST(COALESCE((SELECT MAX(id) FROM public.polygon_ui_config), 0), 1), true)';
      ALTER TABLE public.polygon_ui_config ALTER COLUMN id SET DEFAULT nextval('public.polygon_ui_config_id_seq');
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='polygon_ui_state_option') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='polygon_ui_state_option' AND column_name='id') THEN
      IF NOT EXISTS (SELECT 1 FROM information_schema.sequences WHERE sequence_schema='public' AND sequence_name='polygon_ui_state_option_id_seq') THEN
        CREATE SEQUENCE public.polygon_ui_state_option_id_seq;
      END IF;
      EXECUTE 'SELECT setval(''public.polygon_ui_state_option_id_seq'', GREATEST(COALESCE((SELECT MAX(id) FROM public.polygon_ui_state_option), 0), 1), true)';
      ALTER TABLE public.polygon_ui_state_option ALTER COLUMN id SET DEFAULT nextval('public.polygon_ui_state_option_id_seq');
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='semaforo_binding') THEN
    CREATE TABLE public.semaforo_binding (
      id bigserial PRIMARY KEY,
      semaforo_device_id bigint NOT NULL REFERENCES public.semaforo_device(id) ON DELETE CASCADE,
      site_code varchar(100),
      map_code varchar(100),
      site_map_code varchar(100),
      polygon_code varchar(100),
      button_action varchar(50),
      trigger_kind varchar(50) DEFAULT 'manual',
      enabled boolean DEFAULT TRUE,
      created_at timestamptz DEFAULT now()
    );
  END IF;
END $$;

ALTER TABLE public.object_current_state
  ADD COLUMN IF NOT EXISTS site_id bigint,
  ADD COLUMN IF NOT EXISTS source_status varchar(50);

ALTER TABLE public.object_state_event
  ADD COLUMN IF NOT EXISTS site_id bigint,
  ADD COLUMN IF NOT EXISTS sync_run_id bigint,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

ALTER TABLE public.site_map
  ADD COLUMN IF NOT EXISTS image_path text,
  ADD COLUMN IF NOT EXISTS display_order integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT TRUE;

ALTER TABLE public.app_user
  ADD COLUMN IF NOT EXISTS email varchar(255),
  ADD COLUMN IF NOT EXISTS role varchar(100);

ALTER TABLE public.map_object
  ADD COLUMN IF NOT EXISTS object_type varchar(50),
  ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT TRUE;

ALTER TABLE public.polygon_ui_config
  ADD COLUMN IF NOT EXISTS site_map_id bigint,
  ADD COLUMN IF NOT EXISTS map_object_id bigint,
  ADD COLUMN IF NOT EXISTS is_manual_enabled boolean DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS is_automatic_enabled boolean DEFAULT TRUE;

ALTER TABLE public.polygon_ui_state_option
  ADD COLUMN IF NOT EXISTS polygon_ui_config_id bigint,
  ADD COLUMN IF NOT EXISTS config_id bigint,
  ADD COLUMN IF NOT EXISTS map_object_id bigint,
  ADD COLUMN IF NOT EXISTS button_label varchar(100),
  ADD COLUMN IF NOT EXISTS label varchar(100),
  ADD COLUMN IF NOT EXISTS color_hex varchar(20),
  ADD COLUMN IF NOT EXISTS button_color varchar(20),
  ADD COLUMN IF NOT EXISTS overlay_color varchar(20),
  ADD COLUMN IF NOT EXISTS fill_color varchar(20),
  ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_visible boolean DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS is_enabled boolean DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT TRUE;

ALTER TABLE public.semaforo_binding
  ADD COLUMN IF NOT EXISTS site_code varchar(100),
  ADD COLUMN IF NOT EXISTS map_code varchar(100),
  ADD COLUMN IF NOT EXISTS site_map_code varchar(100),
  ADD COLUMN IF NOT EXISTS polygon_code varchar(100),
  ADD COLUMN IF NOT EXISTS button_action varchar(50),
  ADD COLUMN IF NOT EXISTS trigger_kind varchar(50) DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT TRUE;