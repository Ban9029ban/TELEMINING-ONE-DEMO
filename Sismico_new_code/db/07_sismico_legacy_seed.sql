-- Seed adicional para monitoreo legado
INSERT INTO screen_heartbeat (id, screen_id, browser_session_id, current_url, status_code)
VALUES
(100, 1, 'seed-central', 'http://localhost:15173/legacy-sismico', 'online'),
(101, 2, 'seed-diamante', 'http://localhost:15173/legacy-sismico/diamante', 'online'),
(102, 3, 'seed-andesita', 'http://localhost:15173/legacy-sismico/andesita', 'online')
ON CONFLICT (id) DO NOTHING;
