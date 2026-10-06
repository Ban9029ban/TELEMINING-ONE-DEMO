ALTER TABLE public.semaforo_action_log
  ADD COLUMN IF NOT EXISTS site_code varchar(100);

ALTER TABLE public.semaforo_action_log
  ADD COLUMN IF NOT EXISTS map_code varchar(100);

ALTER TABLE public.semaforo_action_log
  ADD COLUMN IF NOT EXISTS polygon_code varchar(100);