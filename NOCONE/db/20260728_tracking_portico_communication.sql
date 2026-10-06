-- Estado tecnico de comunicacion por portico para el mapa de Tracking.
-- No genera accesos ni cambia la asignacion de EPCs.
CREATE TABLE IF NOT EXISTS portico_communication (
  portico_id       BIGINT PRIMARY KEY REFERENCES access_portico(id) ON DELETE CASCADE,
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_reader_code VARCHAR(120),
  last_epc         VARCHAR(160)
);

CREATE INDEX IF NOT EXISTS idx_portico_communication_last_seen
  ON portico_communication (last_seen_at DESC);
