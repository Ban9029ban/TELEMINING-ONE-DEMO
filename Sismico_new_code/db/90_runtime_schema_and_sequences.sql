-- V15: runtime sequences (safe / idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.sequences WHERE sequence_schema='public' AND sequence_name='screen_heartbeat_id_seq') THEN
    CREATE SEQUENCE public.screen_heartbeat_id_seq;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.sequences WHERE sequence_schema='public' AND sequence_name='sismico_sync_run_id_seq') THEN
    CREATE SEQUENCE public.sismico_sync_run_id_seq;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.sequences WHERE sequence_schema='public' AND sequence_name='object_current_state_id_seq') THEN
    CREATE SEQUENCE public.object_current_state_id_seq;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.sequences WHERE sequence_schema='public' AND sequence_name='object_state_event_id_seq') THEN
    CREATE SEQUENCE public.object_state_event_id_seq;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.sequences WHERE sequence_schema='public' AND sequence_name='semaforo_device_id_seq') THEN
    CREATE SEQUENCE public.semaforo_device_id_seq;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.sequences WHERE sequence_schema='public' AND sequence_name='semaforo_rule_id_seq') THEN
    CREATE SEQUENCE public.semaforo_rule_id_seq;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.sequences WHERE sequence_schema='public' AND sequence_name='semaforo_action_log_id_seq') THEN
    CREATE SEQUENCE public.semaforo_action_log_id_seq;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.sequences WHERE sequence_schema='public' AND sequence_name='system_config_id_seq') THEN
    CREATE SEQUENCE public.system_config_id_seq;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.sequences WHERE sequence_schema='public' AND sequence_name='feature_flag_id_seq') THEN
    CREATE SEQUENCE public.feature_flag_id_seq;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.sequences WHERE sequence_schema='public' AND sequence_name='plc_device_id_seq') THEN
    CREATE SEQUENCE public.plc_device_id_seq;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.sequences WHERE sequence_schema='public' AND sequence_name='traffic_command_log_id_seq') THEN
    CREATE SEQUENCE public.traffic_command_log_id_seq;
  END IF;
END $$;