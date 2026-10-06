BEGIN;
SET client_encoding = 'UTF8';

WITH
male_first_names AS (
  SELECT unnest(ARRAY[
    'Agustín','Alan','Alberto','Alejandro','Alfonso','Alfredo','Álvaro','Amaro','Américo','Andrés',
    'Antonio','Ariel','Arturo','Axel','Bastián','Benjamín','Bruno','Camilo','Carlos','César',
    'Cristián','Cristóbal','Damián','David','Diego','Eduardo','Emilio','Enrique','Esteban','Felipe',
    'Fernando','Francisco','Gabriel','Gaspar','Germán','Gonzalo','Guillermo','Gustavo','Héctor','Hernán',
    'Hugo','Ian','Ignacio','Ismael','Iván','Javier','Jerónimo','Joaquín','Jorge','José',
    'Juan','Julián','Kevin','Lautaro','Leandro','Leonardo','Lucas','Luis','Manuel','Marcelo',
    'Marco','Marcos','Mario','Martín','Matías','Maximiliano','Miguel','Nicolás','Octavio','Óscar',
    'Pablo','Patricio','Pedro','Rafael','Ramiro','Raúl','Ricardo','Rodrigo','Rubén','Samuel',
    'Santiago','Sebastián','Sergio','Simón','Tomás','Valentín','Vicente','Víctor'
  ]) AS fn
),
female_first_names AS (
  SELECT unnest(ARRAY[
    'Abril','Agustina','Ainhoa','Alba','Alejandra','Alicia','Amanda','Amelia','Ana','Andrea',
    'Ángela','Antonella','Antonia','Ariana','Astrid','Bárbara','Beatriz','Belén','Camila','Carla',
    'Carolina','Catalina','Cecilia','Celeste','Claudia','Constanza','Daniela','Débora','Dominga','Elena',
    'Elisa','Emilia','Emma','Erika','Estefanía','Eugenia','Eva','Fabiola','Fernanda','Florencia',
    'Francisca','Gabriela','Gloria','Graciela','Inés','Isabel','Isidora','Ivana','Javiera','Jessica',
    'Josefa','Julieta','Karla','Karen','Katherine','Laura','Leticia','Lorena','Lucía','Magdalena',
    'Manuela','Marcela','María','Mariana','Martina','Melanie','Micaela','Monserrat','Natalia','Nicole',
    'Olivia','Paloma','Pamela','Paola','Patricia','Paulina','Pía','Priscila','Rafaela','Renata',
    'Rocío','Romina','Rosario','Sabrina','Sofía','Tamara','Teresa','Trinidad','Valentina','Valeria',
    'Vanesa','Verónica','Violeta','Ximena'
  ]) AS fn
),
last_names AS (
  SELECT unnest(ARRAY[
    'Pérez','González','Muñoz','Rojas','Díaz','Contreras','Silva','Martínez','Sepúlveda','Morales',
    'Rodríguez','López','Fuentes','Hernández','Torres','Castillo','Flores','Espinoza','Valenzuela','Vargas',
    'Soto','Rivera','Cortés','Navarro','Reyes','Bravo','Gutiérrez','Carrasco','Pino','Rivas',
    'Olivares','Tapia','Sandoval','Cifuentes','Figueroa','Campos','Saavedra','Vergara','Orellana','Salinas',
    'Gallardo','Cisternas','Lagos'
  ]) AS ln
),
name_pool AS (
  SELECT
    fn,
    ln1 AS last_name_1,
    ln2 AS last_name_2,
    (fn || ' ' || ln1 || ' ' || ln2) AS full_name,
    md5(fn || '|' || ln1 || '|' || ln2) AS sort_key
  FROM (
    SELECT fn FROM male_first_names
    UNION ALL
    SELECT fn FROM female_first_names
  ) f
  CROSS JOIN last_names l1(ln1)
  CROSS JOIN last_names l2(ln2)
  WHERE l1.ln1 <> l2.ln2
),
generated_people AS (
  SELECT
    row_number() OVER (ORDER BY sort_key) AS id,
    full_name,
    fn AS first_name,
    (last_name_1 || ' ' || last_name_2) AS last_name
  FROM name_pool
  ORDER BY sort_key
  LIMIT 500
),
manual_people_raw AS (
  SELECT row_number() OVER (ORDER BY ordinal) + 500 AS id, full_name
  FROM (VALUES
    (1, 'Juan Pérez'),
    (2, 'María González'),
    (3, 'Carlos Díaz'),
    (4, 'Francisca Muñoz'),
    (5, 'Ricardo Torres'),
    (6, 'Claudio Soto'),
    (7, 'Andrés Fuentes'),
    (8, 'Camila Rojas'),
    (9, 'Tomás Valenzuela'),
    (10, 'Daniela Arriagada'),
    (11, 'Felipe Cisternas'),
    (12, 'Javiera Lagos'),
    (13, 'Marcelo Contreras'),
    (14, 'Rodrigo Salinas'),
    (15, 'Sebastián Herrera'),
    (16, 'Natalia Cornejo'),
    (17, 'Diego Mena'),
    (18, 'Paula Fernández'),
    (19, 'Constanza Saavedra'),
    (20, 'Mauricio Hidalgo'),
    (21, 'Cristóbal Sepúlveda'),
    (22, 'Alejandra Bravo'),
    (23, 'Gonzalo Vásquez'),
    (24, 'Lucía Araya'),
    (25, 'Matías Pardo'),
    (26, 'Valentina Jofré'),
    (27, 'Ignacio Barros'),
    (28, 'Trinidad Correa'),
    (29, 'Benjamín Navarro'),
    (30, 'Josefa Arévalo'),
    (31, 'Pablo Cáceres'),
    (32, 'Isidora Palma'),
    (33, 'Leandro Castillo'),
    (34, 'Camilo Riveros'),
    (35, 'Tamara Bustamante'),
    (36, 'Miguel Carrasco'),
    (37, 'Roxana Pino'),
    (38, 'Hernán Rivas'),
    (39, 'Carolina Olivares'),
    (40, 'Jorge Tapia'),
    (41, 'Reinaldo Riffo'),
    (42, 'Nicole Vargas'),
    (43, 'Patricio Sandoval'),
    (44, 'Yasna Cifuentes'),
    (45, 'Cristian Figueroa'),
    (46, 'Lorena Avendaño'),
    (47, 'Fabián Alarcón'),
    (48, 'Pedro Morales'),
    (49, 'Andrea Venegas')
  ) AS t(ordinal, full_name)
),
manual_people AS (
  SELECT
    id,
    full_name,
    split_part(full_name, ' ', 1) AS first_name,
    regexp_replace(full_name, '^[^ ]+ ', '') AS last_name
  FROM manual_people_raw
),
expected_people AS (
  SELECT * FROM generated_people
  UNION ALL
  SELECT * FROM manual_people
)
UPDATE person p
SET
  full_name = e.full_name,
  first_name = e.first_name,
  last_name = e.last_name
FROM expected_people e
WHERE p.id = e.id;

UPDATE tag_assignment ta
SET display_name = p.full_name
FROM person p
WHERE ta.entity_type = 'person'
  AND ta.entity_id = p.id
  AND ta.display_name IS DISTINCT FROM p.full_name;

WITH tool_names AS (
  SELECT ARRAY[
    'Fusionadora de Fibra Óptica Fujikura',
    'OTDR EXFO',
    'Medidor de Potencia Óptica',
    'Microscopio Inspección Conectores FO',
    'Fluke Networks Certificador',
    'Analizador de Vibraciones SKF',
    'Cámara Termográfica FLIR',
    'Detector Multigás Industrial',
    'Luxómetro Profesional',
    'Sonómetro Clase 1',
    'Tacómetro Láser',
    'Torquímetro Digital',
    'Taladro Hilti TE-60',
    'Taladro Hilti TE-80',
    'Martillo Demoledor Hilti TE-3000',
    'Esmeril Angular Makita 7in',
    'Soldadora Inverter 200A',
    'Planta Soldadora MIG 250A',
    'Generador 15kVA',
    'Compresor Atlas Copco XR',
    'Bomba de Agua 3in',
    'Bomba de Lodos',
    'GPS RTK Topografía',
    'Estación Total Topográfica',
    'Nivel Láser Rotativo',
    'Dron DJI Enterprise',
    'Cámara Endoscópica Industrial',
    'Medidor de Aislamiento (Megóhmetro)',
    'Pinza Amperimétrica TRMS',
    'Osciloscopio Portátil',
    'Analizador de Calidad de Energía',
    'Medidor de Espesor Ultrasonido'
  ] AS arr
)
UPDATE equipment e
SET
  name = (
    SELECT arr[((e.id - 1) % array_length(arr, 1)) + 1] || ' ' || lpad(e.id::text, 3, '0')
    FROM tool_names
  ),
  description = 'Herramienta de alto valor (demo funcional con trazabilidad por pórticos)'
WHERE e.id BETWEEN 1 AND 50;

UPDATE equipment
SET
  name = CONCAT('Equipo crítico ', id - 50),
  description = 'Equipo crítico industrial'
WHERE id BETWEEN 51 AND 55;

UPDATE equipment_type
SET
  name = 'Equipamiento Crítico',
  description = 'Equipos que deben ser monitoreados 24/7'
WHERE code = 'CRIT';

UPDATE access_portico_type
SET
  name = CASE code
    WHEN 'BASIC' THEN 'Pórtico Básico'
    WHEN 'CLIMATE' THEN 'Pórtico con clima'
    ELSE name
  END,
  description = CASE code
    WHEN 'BASIC' THEN 'Pórtico sin clima'
    WHEN 'CLIMATE' THEN 'Pórtico con sensores de clima'
    ELSE description
  END
WHERE code IN ('BASIC', 'CLIMATE');

UPDATE access_climate_var
SET unit = '°C'
WHERE code = 'TEMP';

UPDATE map_device
SET label = CONCAT('Cámara IA ', ref_id)
WHERE kind = 'camera';

INSERT INTO person_extra (
  person_id,
  driver_license,
  driver_license_exp,
  medical_exams,
  medical_exams_exp,
  entry_type,
  entry_exp,
  site_induction,
  site_induction_exp,
  height_work_cert,
  height_work_cert_exp,
  contract_end,
  allergies,
  medical_notes,
  address,
  phone_primary,
  phone_emergency,
  emergency_contact_name,
  blood_type,
  ppe_size,
  photo_url
)
WITH ranked AS (
  SELECT
    p.id,
    p.full_name,
    COALESCE(p.address, 'Campamento norte') AS base_address,
    COALESCE(p.phone, '+56 9 6000 ' || LPAD((p.id % 10000)::text, 4, '0')) AS base_phone,
    COALESCE(p.emergency_phone, '+56 9 7000 ' || LPAD((p.id % 10000)::text, 4, '0')) AS base_emergency_phone,
    COALESCE(p.blood_type, (ARRAY['O+','A+','B+','AB+'])[1 + (p.id % 4)::int]) AS base_blood_type,
    ROW_NUMBER() OVER (ORDER BY p.id) AS rn
  FROM person p
  WHERE p.active = TRUE
)
SELECT
  r.id,
  (CASE (r.id % 4)::int
    WHEN 0 THEN 'A2'
    WHEN 1 THEN 'B'
    WHEN 2 THEN 'D'
    ELSE 'A4'
  END) || ' / TM-' || LPAD(r.id::text, 4, '0') AS driver_license,
  CASE
    WHEN r.rn BETWEEN 1 AND 5 THEN CURRENT_DATE - (r.rn::int)
    ELSE CURRENT_DATE + (180 + ((r.rn - 1) % 120)::int)
  END,
  'Ocupacional mina subterranea',
  CASE
    WHEN r.rn BETWEEN 6 AND 10 THEN CURRENT_DATE - ((r.rn - 5)::int)
    ELSE CURRENT_DATE + (210 + ((r.rn - 1) % 120)::int)
  END,
  CASE (r.id % 3)::int
    WHEN 0 THEN 'permanente'
    WHEN 1 THEN 'contratista'
    ELSE 'pase_visita'
  END AS entry_type,
  CASE
    WHEN r.rn BETWEEN 11 AND 15 THEN CURRENT_DATE + ((r.rn - 10)::int)
    ELSE CURRENT_DATE + (240 + ((r.rn - 1) % 120)::int)
  END,
  (ARRAY[
    'Induccion Diamante NP',
    'Induccion Andes Norte',
    'Induccion UCL',
    'Induccion Mina Central'
  ])[1 + ((r.id - 1) % 4)::int],
  CASE
    WHEN r.rn BETWEEN 16 AND 20 THEN CURRENT_DATE + ((r.rn - 15)::int)
    ELSE CURRENT_DATE + (270 + ((r.rn - 1) % 120)::int)
  END,
  CASE WHEN (r.id % 2)::int = 0 THEN 'Certificacion vigente' ELSE 'Certificacion base' END,
  CASE
    WHEN r.rn BETWEEN 21 AND 25 THEN CURRENT_DATE + (15 + (r.rn - 20)::int)
    ELSE CURRENT_DATE + (300 + ((r.rn - 1) % 120)::int)
  END,
  CASE
    WHEN r.rn BETWEEN 26 AND 30 THEN CURRENT_DATE + (15 + (r.rn - 25)::int)
    ELSE CURRENT_DATE + (330 + ((r.rn - 1) % 120)::int)
  END,
  CASE
    WHEN (r.id % 5)::int = 0 THEN 'Penicilina'
    WHEN (r.id % 7)::int = 0 THEN 'Polvo'
    ELSE 'Sin alergias declaradas'
  END,
  'Ficha demo para monitoreo de vencimientos y alertas operacionales.',
  r.base_address,
  r.base_phone,
  r.base_emergency_phone,
  split_part(r.full_name, ' ', 1) || ' Contacto',
  r.base_blood_type,
  (ARRAY['S','M','L','XL'])[1 + (r.id % 4)::int],
  NULL
FROM ranked r
ON CONFLICT (person_id) DO UPDATE
SET
  driver_license = EXCLUDED.driver_license,
  driver_license_exp = EXCLUDED.driver_license_exp,
  medical_exams = EXCLUDED.medical_exams,
  medical_exams_exp = EXCLUDED.medical_exams_exp,
  entry_type = EXCLUDED.entry_type,
  entry_exp = EXCLUDED.entry_exp,
  site_induction = EXCLUDED.site_induction,
  site_induction_exp = EXCLUDED.site_induction_exp,
  height_work_cert = EXCLUDED.height_work_cert,
  height_work_cert_exp = EXCLUDED.height_work_cert_exp,
  contract_end = EXCLUDED.contract_end,
  allergies = EXCLUDED.allergies,
  medical_notes = EXCLUDED.medical_notes,
  address = EXCLUDED.address,
  phone_primary = EXCLUDED.phone_primary,
  phone_emergency = EXCLUDED.phone_emergency,
  emergency_contact_name = EXCLUDED.emergency_contact_name,
  blood_type = EXCLUDED.blood_type,
  ppe_size = EXCLUDED.ppe_size,
  photo_url = EXCLUDED.photo_url,
  updated_at = now();

COMMIT;
