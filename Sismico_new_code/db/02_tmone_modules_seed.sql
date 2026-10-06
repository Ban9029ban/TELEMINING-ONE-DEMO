CREATE TABLE IF NOT EXISTS module_ai_faq (
  id BIGSERIAL PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT NOT NULL
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
  sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO module_ai_faq (question, answer) VALUES
('Diccionario minería (sinónimos que entiende el agente).', 'Respuesta simulada del diccionario minero.'),
('Lístame las personas de la empresa CODELCO.', 'Respuesta simulada desde la BD para personas CODELCO.'),
('Lístame las personas de la empresa CODELCO que están activas hoy.', 'Respuesta simulada de personas activas hoy.'),
('Dame un resumen de dónde están las personas ahora mismo.', 'Respuesta simulada de ubicación actual.'),
('Lístame las últimas entradas y salidas de personas por pórtico.', 'Respuesta simulada de accesos.'),
('Muéstrame cuántos accesos tuvo cada pórtico en los últimos 7 días.', 'Respuesta simulada por pórtico.'),
('Cuáles son las zonas con más tiempo de permanencia no productiva hoy.', 'Respuesta simulada de permanencia no productiva.')
ON CONFLICT DO NOTHING;

INSERT INTO module_productivity_event (sector_name, event_count, energy_value, event_date) VALUES
('Panel 21', 3, 18.00, CURRENT_DATE),
('Galería Norte', 3, 12.00, CURRENT_DATE)
ON CONFLICT DO NOTHING;

INSERT INTO module_zones_det (zone_name, sort_order) VALUES
('Andes Norte',1),('Andesita',2),('Diamante',3),('Esmeralda',4),('Dacita',5),
('Diablo Regimiento',6),('Recursos Norte',7),('Pacífico Superior',8),('TTE4 Sur',9),
('Reservas Norte',10),('Pilar Norte',11),('Corbata',12)
ON CONFLICT DO NOTHING;
