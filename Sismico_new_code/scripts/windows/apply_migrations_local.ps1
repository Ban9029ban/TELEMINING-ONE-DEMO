docker compose -f docker-compose.local.yml exec -T db psql -U admin -d dashboard_sismico < db/20_sismico_reusable_core.sql
docker compose -f docker-compose.local.yml exec -T db psql -U admin -d dashboard_sismico < db/21_sismico_runtime_and_semaforos.sql
docker compose -f docker-compose.local.yml exec -T db psql -U admin -d dashboard_sismico < db/22_system_configuration_profiles.sql
