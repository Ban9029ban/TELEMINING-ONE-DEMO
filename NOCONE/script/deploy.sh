#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# Carga variables del .env (APP_ENV, POSTGRES_*, PROD_DB_*, etc.)
if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

env_raw="${APP_ENV:-develop}"
# normaliza (minúsculas y sin espacios)
env="$(echo "$env_raw" | tr '[:upper:]' '[:lower:]' | tr -d ' ')"

if [[ "$env" == "produccion" || "$env" == "prod" || "$env" == "production" ]]; then
  echo "[deploy] APP_ENV=$env_raw -> producción: usando PostgreSQL del host (NO levanta db contenedor)"
  docker compose up -d --build
else
  echo "[deploy] APP_ENV=$env_raw -> desarrollo: usando PostgreSQL en contenedor (levanta db con --profile dev)"
  docker compose --profile dev up -d --build
fi
