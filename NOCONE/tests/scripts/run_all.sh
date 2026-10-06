#!/usr/bin/env bash
set -euo pipefail

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.tests.yml"

$COMPOSE run --rm test_backend_unit || true
$COMPOSE run --rm test_backend_integration || true
$COMPOSE run --rm test_backend_security || true
$COMPOSE run --rm test_listener_unit || true
$COMPOSE run --rm test_listener_security || true
$COMPOSE run --rm test_frontend_unit || true
$COMPOSE run --rm test_frontend_build || true
$COMPOSE run --rm test_frontend_security || true

$COMPOSE up -d test_db test_backend_app test_listener_app test_frontend_app
$COMPOSE run --rm test_smoke || true
$COMPOSE run --rm test_summary
