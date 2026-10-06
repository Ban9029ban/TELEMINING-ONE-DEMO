ALTER TABLE module_zones_det ADD COLUMN IF NOT EXISTS zone_key VARCHAR(60);

UPDATE module_zones_det
SET zone_key = CASE lower(trim(zone_name))
  WHEN 'andes norte' THEN 'andes'
  WHEN 'andesita' THEN 'andesita'
  WHEN 'diamante' THEN 'diamante'
  WHEN 'esmeralda' THEN 'esmeralda'
  WHEN 'dacita' THEN 'dacita'
  WHEN 'diablo regimiento' THEN 'diablo'
  WHEN 'recursos norte' THEN 'recursos'
  WHEN 'pacífico superior' THEN 'pacifico'
  WHEN 'pacifico superior' THEN 'pacifico'
  WHEN 'tte4 sur' THEN 'tte4'
  WHEN 'reservas norte' THEN 'reservas'
  WHEN 'pilar norte' THEN 'pilar_N'
  WHEN 'corbata' THEN 'corbata'
  WHEN 'pipa norte' THEN 'pipa_N'
  ELSE lower(replace(replace(trim(zone_name), ' ', '_'), '-', '_'))
END
WHERE zone_key IS NULL OR trim(zone_key) = '';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'screen_heartbeat'
      AND column_name = 'id'
      AND column_default IS NULL
  ) THEN
    CREATE SEQUENCE IF NOT EXISTS screen_heartbeat_id_seq;
    IF EXISTS (SELECT 1 FROM screen_heartbeat) THEN
      PERFORM setval('screen_heartbeat_id_seq', (SELECT MAX(id) FROM screen_heartbeat), true);
    ELSE
      PERFORM setval('screen_heartbeat_id_seq', 1, false);
    END IF;
    ALTER TABLE screen_heartbeat ALTER COLUMN id SET DEFAULT nextval('screen_heartbeat_id_seq');
    ALTER SEQUENCE screen_heartbeat_id_seq OWNED BY screen_heartbeat.id;
  END IF;
END $$;
