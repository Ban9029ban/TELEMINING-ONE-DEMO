CREATE TABLE IF NOT EXISTS sismico_site (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(120) NOT NULL,
  project_label VARCHAR(180),
  logo_path TEXT,
  map_image_path TEXT,
  status_code VARCHAR(20) NOT NULL DEFAULT 'normal',
  shell_variant VARCHAR(30) NOT NULL DEFAULT 'dashboard',
  emergency_active BOOLEAN NOT NULL DEFAULT FALSE,
  last_record_at TIMESTAMP NULL,
  display_order INT NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS sismico_object (
  id SERIAL PRIMARY KEY,
  site_code VARCHAR(50) NOT NULL REFERENCES sismico_site(code) ON DELETE CASCADE,
  group_name VARCHAR(120) NOT NULL,
  code VARCHAR(80) NOT NULL,
  label VARCHAR(180) NOT NULL,
  state_mode VARCHAR(20) NOT NULL DEFAULT 'binary',
  state_code VARCHAR(20) NOT NULL DEFAULT 'normal',
  secondary_state VARCHAR(20),
  display_order INT NOT NULL DEFAULT 100,
  geometry_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS sismico_alert (
  id SERIAL PRIMARY KEY,
  site_code VARCHAR(50) NOT NULL REFERENCES sismico_site(code) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  message TEXT,
  severity VARCHAR(20) NOT NULL DEFAULT 'medium',
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sismico_screen (
  id SERIAL PRIMARY KEY,
  site_code VARCHAR(50) NOT NULL REFERENCES sismico_site(code) ON DELETE CASCADE,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(180) NOT NULL,
  status_code VARCHAR(20) NOT NULL DEFAULT 'online',
  current_url TEXT,
  last_heartbeat_at TIMESTAMP NULL
);

INSERT INTO sismico_site(code,name,project_label,logo_path,map_image_path,status_code,shell_variant,emergency_active,last_record_at,display_order)
VALUES
('diamante','Diamante','Proyecto Diamante','/sismico_ui/DIAMANTE.png','/sismico_ui/map.png','alerta','diamante',TRUE,NOW(),1),
('andesita','Andesita','Proyecto Andesita','/sismico_ui/ANDESITA.png','/sismico_ui/img_andesita/ANDESITAMAP.jpg','normal','andesita',FALSE,NOW(),2),
('andes-norte','Andes Norte','Proyecto Andes Norte','/sismico_ui/ANLOGO.png','/sismico_ui/ANNI/ANNI.jpg','normal','andes-norte',FALSE,NOW(),3)
ON CONFLICT (code) DO UPDATE SET
  name=EXCLUDED.name, project_label=EXCLUDED.project_label, logo_path=EXCLUDED.logo_path,
  map_image_path=EXCLUDED.map_image_path, status_code=EXCLUDED.status_code,
  shell_variant=EXCLUDED.shell_variant, emergency_active=EXCLUDED.emergency_active,
  last_record_at=EXCLUDED.last_record_at, display_order=EXCLUDED.display_order;

DELETE FROM sismico_object;
INSERT INTO sismico_object(site_code,group_name,code,label,state_mode,state_code,secondary_state,display_order,geometry_json) VALUES
('diamante','Polígonos Sismicidad — Diamante','diamante-pipa','Diamante PIPA','binary','normal','alerta',10,'{"x":14,"y":15,"w":10,"h":12}'),
('diamante','Polígonos Sismicidad — Diamante','footprint-hw','FootPrint HW','binary','normal','alerta',20,'{"x":42,"y":10,"w":34,"h":58}'),
('diamante','Polígonos Sismicidad — Diamante','footprint-fw','FootPrint Fw','binary','normal','alerta',30,'{"x":77,"y":15,"w":15,"h":12}'),
('diamante','Polígonos Sismicidad — Diamante','bde','Bajo Diamante Esmeralda','ternary','centro',null,40,'{"x":48,"y":44,"w":18,"h":15}'),

('andesita','Tabla de Polígonos – ANDESITA','andesita-norte-hw','Andesita Norte HW','binary','normal',null,10,'{"x":58,"y":26,"w":10,"h":12}'),
('andesita','Tabla de Polígonos – ANDESITA','andesita-norte-fw','Andesita Norte FW','binary','normal',null,20,'{"x":86,"y":27,"w":10,"h":12}'),
('andesita','Tabla de Polígonos – ANDESITA','andesita-sur-hw','Andesita Sur HW','binary','normal',null,30,'{"x":58,"y":57,"w":26,"h":18}'),
('andesita','Tabla de Polígonos – ANDESITA','andesita-sur-fw','Andesita Sur FW','binary','normal',null,40,'{"x":74,"y":61,"w":12,"h":12}'),

('andes-norte','Polígono Profundo','monitoreo-post-evento-2025','Monitoreo Post Evento 2025','ternary','centro',null,10,'{"x":54,"y":17,"w":26,"h":24}'),
('andes-norte','Polígono Profundo','adit-74-75','ADIT 74 - 75','ternary','centro',null,20,'{"x":55,"y":19,"w":13,"h":19}'),
('andes-norte','Polígono Profundo','poligono-pilar-2','Poligono Pilar 2','ternary','centro',null,30,'{"x":60,"y":40,"w":8,"h":8}'),
('andes-norte','Polígono Producción','inicio-caving','Inicio Caving','ternary','centro',null,40,'{"x":70,"y":24,"w":10,"h":12}'),
('andes-norte','Polígonos Locales','p-4600','P 4600','binary','normal','alerta',50,'{"x":24,"y":35,"w":8,"h":10}'),
('andes-norte','Polígonos Locales','tc-oim','TC OIM','binary','normal','alerta',60,'{"x":38,"y":55,"w":19,"h":14}'),
('andes-norte','Polígonos Locales','pacifico','Pacífico','binary','normal','alerta',70,'{"x":12,"y":35,"w":15,"h":10}'),
('andes-norte','Polígonos Locales','cabecera-hw','Cabecera HW','binary','normal','alerta',80,'{"x":56,"y":17,"w":13,"h":12}'),
('andes-norte','Polígonos Locales','an-norte-hw','AN Norte HW','binary','normal','alerta',90,'{"x":50,"y":17,"w":11,"h":18}'),
('andes-norte','Polígonos Locales','an-norte-fw','AN Norte FW','binary','normal','alerta',100,'{"x":74,"y":17,"w":12,"h":19}'),
('andes-norte','Polígonos Locales','an-sur-hw','AN Sur HW','binary','normal','alerta',110,'{"x":66,"y":48,"w":24,"h":28}'),
('andes-norte','Polígonos Locales','cabecera-fw-norte','Cabecera FW Norte','binary','normal','alerta',120,'{"x":85,"y":34,"w":9,"h":9}'),
('andes-norte','Polígonos Locales','monitoreo-post-evento-fw','Monitoreo Post Evento FW','binary','normal','alerta',130,'{"x":50,"y":13,"w":7,"h":9}');

DELETE FROM sismico_alert;
INSERT INTO sismico_alert(site_code,title,message,severity,status,created_at) VALUES
('diamante','Evacuación activa','Semáforo vial cambiado a rojo por alerta crítica.','critical','open',NOW()),
('andesita','JSON degradado a HTML','Falla JSON, probando HTML.','medium','open',NOW()),
('andes-norte','Heartbeat pantalla DET-02','Pantalla activa y sincronizada.','low','closed',NOW());

DELETE FROM sismico_screen;
INSERT INTO sismico_screen(site_code,code,name,status_code,current_url,last_heartbeat_at) VALUES
('diamante','det-01','Pantalla Diamante 1','online','/sismico/diamante',NOW()),
('andesita','det-02','Pantalla Andesita 1','online','/sismico/andesita',NOW()),
('andes-norte','det-03','Pantalla Andes Norte 1','online','/sismico/andes-norte',NOW());
