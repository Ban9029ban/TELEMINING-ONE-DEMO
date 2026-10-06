Write-Host "[1/8] docker compose ps" -ForegroundColor Cyan
docker compose ps

Write-Host "`n[2/8] backend health" -ForegroundColor Cyan
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:18000/health | Select-Object -ExpandProperty Content

Write-Host "`n[3/8] capture endpoints" -ForegroundColor Cyan
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:18000/api/sismico/capture/endpoints | Select-Object -ExpandProperty Content

Write-Host "`n[4/8] capture list" -ForegroundColor Cyan
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:18000/api/sismico/capture/captures?limit=5 | Select-Object -ExpandProperty Content

Write-Host "`n[5/8] poller logs" -ForegroundColor Cyan
docker compose logs --tail=120 sismico_poller

Write-Host "`n[6/8] backend logs" -ForegroundColor Cyan
docker compose logs --tail=120 backend

Write-Host "`n[7/8] inventory remote_endpoint" -ForegroundColor Cyan
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

Write-Host "`n[8/8] latest captures" -ForegroundColor Cyan
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
