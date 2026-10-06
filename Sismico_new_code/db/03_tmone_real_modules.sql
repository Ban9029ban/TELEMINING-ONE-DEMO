CREATE TABLE IF NOT EXISTS module_ai_faq (
  id BIGSERIAL PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS module_ai_consult_log (
  id BIGSERIAL PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT
);

CREATE TABLE IF NOT EXISTS module_productivity_event (
  id BIGSERIAL PRIMARY KEY,
  sector_name VARCHAR(120) NOT NULL,
  event_count INTEGER NOT NULL,
  energy_value NUMERIC(12,2) NOT NULL,
  event_date DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE TABLE IF NOT EXISTS module_zones_det (
  id BIGSERIAL PRIMARY KEY,
  zone_name VARCHAR(120) NOT NULL,
  zone_key VARCHAR(60) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

TRUNCATE TABLE module_ai_faq RESTART IDENTITY CASCADE;
TRUNCATE TABLE module_productivity_event RESTART IDENTITY CASCADE;
TRUNCATE TABLE module_zones_det RESTART IDENTITY CASCADE;

INSERT INTO module_ai_faq (question, answer) VALUES
('Diccionario minería (sinónimos que entiende el agente).', 'Respuesta desde BD: diccionario minero cargado.'),
('Lístame las personas de la empresa CODELCO.', 'Respuesta desde BD simulada: listado referencial de personas CODELCO.'),
('Lístame las personas de la empresa CODELCO que están activas hoy.', 'Respuesta desde BD simulada: personas activas hoy en la operación.'),
('Dame un resumen de dónde están las personas ahora mismo.', 'Respuesta desde BD simulada: resumen de ubicación actual.'),
('Lístame las últimas entradas y salidas de personas por pórtico.', 'Respuesta desde BD simulada: últimos movimientos por pórtico.'),
('Muéstrame cuántos accesos tuvo cada pórtico en los últimos 7 días.', 'Respuesta desde BD simulada: accesos acumulados por pórtico.'),
('Cuáles son las zonas con más tiempo de permanencia no productiva hoy.', 'Respuesta desde BD simulada: ranking de permanencia no productiva.');

INSERT INTO module_productivity_event (sector_name, event_count, energy_value, event_date) VALUES
('Panel 21', 3, 18.00, CURRENT_DATE),
('Galería Norte', 3, 12.00, CURRENT_DATE);

ALTER TABLE module_zones_det
ADD COLUMN IF NOT EXISTS zone_key VARCHAR(60);

INSERT INTO module_zones_det (zone_name, zone_key, sort_order) VALUES
('Andes Norte','andes',1),('Andesita','andesita',2),('Diamante','diamante',3),('Esmeralda','esmeralda',4),
('Dacita','dacita',5),('Diablo Regimiento','diablo',6),('Recursos Norte','recursos',7),('Pacífico Superior','pacifico',8),
('TTE4 Sur','tte4',9),('Reservas Norte','reservas',10),('Pilar Norte','pilar_N',11),('Corbata','corbata',12),('Pipa Norte','pipa_N',13);
