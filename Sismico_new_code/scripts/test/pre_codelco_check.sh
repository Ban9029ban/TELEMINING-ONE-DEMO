#!/bin/sh
set -eu

echo "[1/8] docker compose ps"
docker compose ps

echo "\n[2/8] backend health"
curl -fsS http://127.0.0.1:18000/health

echo "\n[3/8] capture endpoints"
curl -fsS http://127.0.0.1:18000/api/sismico/capture/endpoints

echo "\n[4/8] capture list"
curl -fsS "http://127.0.0.1:18000/api/sismico/capture/captures?limit=5"

echo "\n[5/8] poller logs"
docker compose logs --tail=120 sismico_poller

echo "\n[6/8] backend logs"
docker compose logs --tail=120 backend

echo "\n[7/8] inventory remote_endpoint"
docker compose exec db psql -U admin -d dashboard_sismico -c "
SELECT
  re.code,
  s.code AS site_code,
  re.endpoint_url,
  re.parser_type,
  re.is_enabled
FROM remote_endpoint re
LEFT JOIN site s ON s.id = re.site_id
ORDER BY s.code, re.code;
"

echo "\n[8/8] latest captures"
docker compose exec db psql -U admin -d dashboard_sismico -c "
SELECT
  id,
  site_code,
  endpoint_code,
  http_status,
  content_type,
  body_size,
  source_origin,
  observed_at
FROM external_source_capture
ORDER BY observed_at DESC, id DESC
LIMIT 20;
"
