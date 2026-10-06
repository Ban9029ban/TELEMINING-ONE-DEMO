-- Alertas autonomas: un equipo se considera fuera de pórtico cuando su
-- último RFID válido se recibe en un pórtico distinto al autorizado.
CREATE TABLE IF NOT EXISTS equipment_portico_rule (
    equipment_id       BIGINT PRIMARY KEY REFERENCES equipment(id) ON DELETE CASCADE,
    allowed_portico_id BIGINT NOT NULL REFERENCES access_portico(id),
    active             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_equipment_portico_rule_allowed
    ON equipment_portico_rule (allowed_portico_id)
    WHERE active = TRUE;
