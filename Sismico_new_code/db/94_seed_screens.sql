-- V15: screen catalog / runtime screens
CREATE TABLE IF NOT EXISTS public.screens (
  id bigserial PRIMARY KEY,
  name varchar(255) NOT NULL,
  site_code varchar(100),
  url varchar(500),
  is_active boolean DEFAULT TRUE,
  created_at timestamptz DEFAULT now()
);

INSERT INTO public.screens (name, site_code, url, is_active)
SELECT * FROM (VALUES
  ('Pantalla Principal Diamante', 'diamante', '/legacy-sismico/diamante', TRUE),
  ('Pantalla Principal Andesita', 'andesita', '/legacy-sismico/andesita', TRUE),
  ('Pantalla Principal Andes Norte', 'andes_norte', '/legacy-sismico/andes-norte', TRUE),
  ('Pantalla Principal Túnel Correa', 'andes_norte_tunel_correa', '/legacy-sismico/andes-norte-tunel-correa', TRUE),
  ('Pantalla Principal Pilar Norte', 'pilar_norte', '/legacy-sismico/pilar-norte', TRUE),
  ('Pantalla Principal Esmeralda', 'esmeralda', '/legacy-sismico/esmeralda', TRUE)
) AS x(name, site_code, url, is_active)
WHERE NOT EXISTS (
  SELECT 1 FROM public.screens s WHERE s.site_code = x.site_code
);