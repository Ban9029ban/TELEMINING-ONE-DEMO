-- Extensión de datos por persona (gestión temprana)
--
-- Importante:
-- - Este script se ejecuta automáticamente SOLO cuando la base de datos se inicializa desde cero
--   (docker-entrypoint-initdb.d). Si ya tienes la BD creada, ejecútalo manualmente.

CREATE TABLE IF NOT EXISTS person_extra (
  person_id             BIGINT PRIMARY KEY REFERENCES person(id) ON DELETE CASCADE,

  driver_license         TEXT,
  driver_license_exp     DATE,
  medical_exams          TEXT,
  medical_exams_exp      DATE,
  entry_type             TEXT,
  entry_exp              DATE,
  site_induction         TEXT,
  site_induction_exp     DATE,
  height_work_cert       TEXT,
  height_work_cert_exp   DATE,
  contract_end           DATE,
  allergies              TEXT,
  medical_notes          TEXT,
  address                TEXT,
  phone_primary          TEXT,
  phone_emergency        TEXT,
  emergency_contact_name TEXT,
  blood_type             TEXT,
  ppe_size               TEXT,
  photo_url              TEXT,

  extra                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_person_extra_updated_at ON person_extra(updated_at);
