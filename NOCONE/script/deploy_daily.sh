#!/usr/bin/env bash
set -euo pipefail

# =========================
# FLAGS (editables)
# =========================
GIT="${GIT:-false}"
PRUNE_IMAGES="${PRUNE_IMAGES:-true}"
DOWN_UP="${DOWN_UP:-true}"
BUILD="${BUILD:-true}"
PULL="${PULL:-true}"
NO_CACHE="${NO_CACHE:-true}"

RESET_DB="${RESET_DB:-true}"
RESET_OLLAMA="${RESET_OLLAMA:-false}"
APPLY_POST_INIT_SQL="${APPLY_POST_INIT_SQL:-true}"
LOAD_DEMO_90_DAYS="${LOAD_DEMO_90_DAYS:-true}"

ROOT_DIR="${ROOT_DIR:-/home/tmone/TmOne}"
BRANCH="${BRANCH:-server_main}"
PROFILE="${PROFILE:-dev}"
WAIT_SECONDS="${WAIT_SECONDS:-600}"

timestamp() {
  date '+%F %T'
}

normalize_project_name() {
  local raw_name="${1:-project}"
  printf '%s' "$raw_name" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9_-]+/_/g; s/^_+//; s/_+$//'
}

if [[ ! -d "$ROOT_DIR" ]]; then
  echo "[error] ROOT_DIR no existe: $ROOT_DIR" >&2
  exit 1
fi

cd "$ROOT_DIR"

if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

POSTGRES_DB="${POSTGRES_DB:-zenit}"
POSTGRES_USER="${POSTGRES_USER:-zenit}"
API_PORT="${API_PORT:-8000}"
WEB_PORT="${WEB_PORT:-8081}"
LISTENER_PORT="${LISTENER_PORT:-8080}"

COMPOSE_PROJECT_NAME_EFFECTIVE="${COMPOSE_PROJECT_NAME:-$(normalize_project_name "$(basename "$ROOT_DIR")")}"
DB_VOLUME_NAME="${DB_VOLUME_NAME:-${COMPOSE_PROJECT_NAME_EFFECTIVE}_dbdata}"
OLLAMA_VOLUME_NAME="${OLLAMA_VOLUME_NAME:-${COMPOSE_PROJECT_NAME_EFFECTIVE}_ollama_models}"
EXPECT_FRESH_DB_BOOTSTRAP="false"

if [[ "$PROFILE" == "dev" && "$DOWN_UP" == "true" ]]; then
  if [[ "$RESET_DB" == "true" ]]; then
    EXPECT_FRESH_DB_BOOTSTRAP="true"
  elif ! docker volume inspect "$DB_VOLUME_NAME" >/dev/null 2>&1; then
    EXPECT_FRESH_DB_BOOTSTRAP="true"
  fi
fi

COMPOSE_CMD=(docker compose)
if [[ -n "$PROFILE" ]]; then
  COMPOSE_CMD+=(--profile "$PROFILE")
fi

POST_INIT_BASE_SQL_FILES=(
  "$ROOT_DIR/db/01_indexes_views.sql"
  "$ROOT_DIR/db/02_extra_models_seed.sql"
  "$ROOT_DIR/db/03_person_extra.sql"
  "$ROOT_DIR/db/04_app_setting.sql"
  "$ROOT_DIR/db/camera_video.sql"
)

# Mismo orden del bloque DEMO en docker-compose.yml. Estos son los SQL que
# dejan personas/tags/pórticos y entradas/salidas visibles en la aplicación.
DEMO_SQL_FILES=(
  "$ROOT_DIR/db/seed_produccion_min.sql"
  "$ROOT_DIR/db/zenit_demo_1_dia_diamante.sql"
  "$ROOT_DIR/db/fix_demo_encoding.sql"
  "$ROOT_DIR/db/99_fix_fleet_activity_seed.sql"
  "$ROOT_DIR/db/99_fix_fleet_full_distribution.sql"
)

POST_INIT_SQL_FILE_90_DAYS="$ROOT_DIR/db/zenit_demo_3_meses.sql"

compose() {
  "${COMPOSE_CMD[@]}" "$@"
}

wait_for_postgres() {
  local started_at
  started_at=$(date +%s)

  echo "=== Esperando PostgreSQL (timeout ${WAIT_SECONDS}s) ==="
  until docker exec zenit-db pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
    if (( $(date +%s) - started_at >= WAIT_SECONDS )); then
      echo "[error] Timeout esperando PostgreSQL" >&2
      docker logs --tail 200 zenit-db || true
      exit 1
    fi
    sleep 2
  done
}

wait_for_initdb_completion() {
  local started_at
  started_at=$(date +%s)

  if [[ "$EXPECT_FRESH_DB_BOOTSTRAP" != "true" ]]; then
    return 0
  fi

  echo "=== Esperando fin de initdb base (/docker-entrypoint-initdb.d) ==="
  until docker logs zenit-db 2>&1 | grep -Fq "PostgreSQL init process complete"; do
    if (( $(date +%s) - started_at >= WAIT_SECONDS )); then
      echo "[error] Timeout esperando fin de initdb base" >&2
      docker logs --tail 200 zenit-db || true
      exit 1
    fi
    sleep 2
  done
}

wait_for_demo_base_seed() {
  local started_at counts
  local company_count person_count vehicle_count tag_count tag_assignment_count access_portico_count map_device_count
  started_at=$(date +%s)

  if [[ "$EXPECT_FRESH_DB_BOOTSTRAP" != "true" ]]; then
    return 0
  fi

  echo "=== Esperando seed base demo ==="
  while true; do
    counts="$(
      docker exec -i zenit-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "
        SELECT CASE
          WHEN to_regclass('public.company') IS NULL
            OR to_regclass('public.person') IS NULL
            OR to_regclass('public.vehicles') IS NULL
            OR to_regclass('public.tag') IS NULL
            OR to_regclass('public.tag_assignment') IS NULL
            OR to_regclass('public.access_portico') IS NULL
            OR to_regclass('public.map_device') IS NULL
          THEN 'not-ready'
          ELSE CONCAT_WS(',',
            (SELECT COUNT(*) FROM company),
            (SELECT COUNT(*) FROM person),
            (SELECT COUNT(*) FROM vehicles),
            (SELECT COUNT(*) FROM tag),
            (SELECT COUNT(*) FROM tag_assignment),
            (SELECT COUNT(*) FROM access_portico),
            (SELECT COUNT(*) FROM map_device)
          )
        END
      " 2>/dev/null | tr -d '[:space:]' || true
    )"

    if [[ -n "$counts" && "$counts" != "not-ready" ]]; then
      IFS=',' read -r company_count person_count vehicle_count tag_count tag_assignment_count access_portico_count map_device_count <<< "$counts"
      if (( company_count > 0 && person_count > 0 && vehicle_count > 0 && tag_count > 0 && tag_assignment_count > 0 && access_portico_count > 0 && map_device_count > 0 )); then
        echo "=== Seed base detectado: company=$company_count person=$person_count vehicles=$vehicle_count tag=$tag_count tag_assignment=$tag_assignment_count access_portico=$access_portico_count map_device=$map_device_count ==="
        return 0
      fi
    fi

    if (( $(date +%s) - started_at >= WAIT_SECONDS )); then
      echo "[error] Timeout esperando seed base demo" >&2
      docker logs --tail 200 zenit-db || true
      exit 1
    fi
    sleep 2
  done
}

wait_for_http() {
  local name="$1"
  local url="$2"
  local started_at
  started_at=$(date +%s)

  if ! command -v curl >/dev/null 2>&1; then
    echo "[warn] curl no disponible; se omite verificacion HTTP de $name"
    return 0
  fi

  echo "=== Esperando $name en $url (timeout ${WAIT_SECONDS}s) ==="
  until curl -fsS "$url" >/dev/null 2>&1; do
    if (( $(date +%s) - started_at >= WAIT_SECONDS )); then
      echo "[error] Timeout esperando $name en $url" >&2
      return 1
    fi
    sleep 2
  done
}

assert_endpoint_not_empty() {
  local name="$1"
  local url="$2"
  local body

  if ! command -v curl >/dev/null 2>&1; then
    echo "[warn] curl no disponible; se omite verificacion de datos para $name"
    return 0
  fi

  body="$(curl -fsS "$url")"
  if [[ -z "$body" || "$body" == "[]" || "$body" == "null" ]]; then
    echo "[error] $name sin datos en $url" >&2
    echo "[error] payload: ${body:-<vacio>}" >&2
    return 1
  fi
}

verify_demo_endpoints() {
  if [[ "$PROFILE" != "dev" ]]; then
    return 0
  fi

  echo "=== Verificando endpoints demo ==="
  assert_endpoint_not_empty "config companies" "http://127.0.0.1:${API_PORT}/api/config/companies"
  assert_endpoint_not_empty "config porticos" "http://127.0.0.1:${API_PORT}/api/config/porticos"
  assert_endpoint_not_empty "access porticos" "http://127.0.0.1:${API_PORT}/api/access/porticos"
}

exec_sql_file() {
  local sql_file="$1"
  local started_at ended_at elapsed

  if [[ ! -f "$sql_file" ]]; then
    echo "[error] SQL no encontrado: $sql_file" >&2
    exit 1
  fi

  started_at=$(date +%s)
  echo "--- Ejecutando $(basename "$sql_file") ---"
  docker exec -i zenit-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 < "$sql_file"
  ended_at=$(date +%s)
  elapsed=$((ended_at - started_at))
  echo "--- OK $(basename "$sql_file") (${elapsed}s) ---"
}

run_post_init_sql() {
  local sql_files=()
  local sql_file

  if [[ "$EXPECT_FRESH_DB_BOOTSTRAP" == "true" ]]; then
    echo "=== DB fresca detectada: se omiten SQL ya ejecutados por initdb ==="
    if [[ "$LOAD_DEMO_90_DAYS" == "true" ]]; then
      sql_files+=("$POST_INIT_SQL_FILE_90_DAYS")
    fi
  else
    sql_files=("${POST_INIT_BASE_SQL_FILES[@]}" "${DEMO_SQL_FILES[@]}")
    if [[ "$LOAD_DEMO_90_DAYS" == "true" ]]; then
      sql_files+=("$POST_INIT_SQL_FILE_90_DAYS")
    fi
  fi

  if (( ${#sql_files[@]} == 0 )); then
    echo "=== SQL post-init: nada pendiente ==="
    return 0
  fi

  echo "=== Aplicando SQL post-init idempotente ==="
  for sql_file in "${sql_files[@]}"; do
    exec_sql_file "$sql_file"
  done
  echo "=== SQL post-init OK ==="
}

remove_volume_if_present() {
  local volume_name="$1"
  if docker volume inspect "$volume_name" >/dev/null 2>&1; then
    echo "--- Eliminando volumen $volume_name ---"
    docker volume rm -f "$volume_name" >/dev/null
  else
    echo "--- Volumen $volume_name no existe; skip ---"
  fi
}

ensure_demo_base_data() {
  local company_count access_portico_count tag_count tag_assignment_count person_count vehicle_count map_device_count access_event_count

  company_count="$(docker exec -i zenit-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT COUNT(*) FROM company" | tr -d '[:space:]')"
  access_portico_count="$(docker exec -i zenit-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT COUNT(*) FROM access_portico" | tr -d '[:space:]')"
  tag_count="$(docker exec -i zenit-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT COUNT(*) FROM tag" | tr -d '[:space:]')"
  tag_assignment_count="$(docker exec -i zenit-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT COUNT(*) FROM tag_assignment" | tr -d '[:space:]')"
  person_count="$(docker exec -i zenit-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT COUNT(*) FROM person" | tr -d '[:space:]')"
  vehicle_count="$(docker exec -i zenit-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT COUNT(*) FROM vehicles" | tr -d '[:space:]')"
  map_device_count="$(docker exec -i zenit-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT COUNT(*) FROM map_device" | tr -d '[:space:]')"
  access_event_count="$(docker exec -i zenit-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT COUNT(*) FROM access_event" | tr -d '[:space:]')"

  echo "=== Resumen DB ==="
  echo "company=$company_count access_portico=$access_portico_count tag=$tag_count tag_assignment=$tag_assignment_count person=$person_count vehicles=$vehicle_count map_device=$map_device_count access_event=$access_event_count"

  if [[ "$company_count" == "0" || "$access_portico_count" == "0" || "$tag_count" == "0" || "$tag_assignment_count" == "0" || "$person_count" == "0" || "$vehicle_count" == "0" || "$map_device_count" == "0" || "$access_event_count" == "0" ]]; then
    echo "[error] La DB no tiene la demo completa cargada (incluyendo movimientos). Revisa los seeds o ejecuta script/cargar_demo_centos.sh." >&2
    docker logs --tail 200 zenit-db || true
    exit 1
  fi
}

echo
echo "=== Script Deploy Diario ==="
echo "=== TMOne Deploy ==="
echo "ROOT_DIR=$ROOT_DIR BRANCH=$BRANCH PROFILE=$PROFILE"
echo "GIT=$GIT PRUNE_IMAGES=$PRUNE_IMAGES DOWN_UP=$DOWN_UP BUILD=$BUILD PULL=$PULL NO_CACHE=$NO_CACHE"
echo "RESET_DB=$RESET_DB RESET_OLLAMA=$RESET_OLLAMA APPLY_POST_INIT_SQL=$APPLY_POST_INIT_SQL LOAD_DEMO_90_DAYS=$LOAD_DEMO_90_DAYS"
echo "COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME_EFFECTIVE DB_VOLUME_NAME=$DB_VOLUME_NAME OLLAMA_VOLUME_NAME=$OLLAMA_VOLUME_NAME"
echo "EXPECT_FRESH_DB_BOOTSTRAP=$EXPECT_FRESH_DB_BOOTSTRAP"
echo "DATE=$(timestamp)"
echo

# =========================
# 1) Git update (opcional)
# =========================
if [[ "$GIT" == "true" ]]; then
  echo "[1/6] Git fetch/switch/pull..."
  git fetch --all --prune
  git checkout "$BRANCH"
  git pull --ff-only
else
  echo "[1/6] Git: SKIP"
fi

# =========================
# 2) Down + cleanup (opcional)
# =========================
if [[ "$DOWN_UP" == "true" ]]; then
  echo "[2/6] docker compose down --remove-orphans..."
  compose down --remove-orphans || true

  if [[ "$PROFILE" == "dev" && "$RESET_DB" == "true" ]]; then
    remove_volume_if_present "$DB_VOLUME_NAME"
  else
    echo "--- Reset DB: SKIP ---"
  fi

  if [[ "$RESET_OLLAMA" == "true" ]]; then
    remove_volume_if_present "$OLLAMA_VOLUME_NAME"
  else
    echo "--- Reset Ollama: SKIP ---"
  fi
else
  echo "[2/6] Down/Cleanup: SKIP"
fi

# =========================
# 3) Prune imagenes (opcional)
# =========================
if [[ "$PRUNE_IMAGES" == "true" ]]; then
  echo "[3/6] docker image prune -af..."
  docker image prune -af || true
else
  echo "[3/6] Prune images: SKIP"
fi

# =========================
# 4) Build (opcional)
# =========================
if [[ "$BUILD" == "true" ]]; then
  echo "[4/6] docker compose build..."
  BUILD_ARGS=()

  if [[ "$PULL" == "true" ]]; then
    BUILD_ARGS+=("--pull")
  fi

  if [[ "$NO_CACHE" == "true" ]]; then
    BUILD_ARGS+=("--no-cache")
  fi

  DOCKER_BUILDKIT=1 compose build "${BUILD_ARGS[@]}"
else
  echo "[4/6] Build: SKIP"
fi

# =========================
# 5) Up + SQL post-init
# =========================
if [[ "$DOWN_UP" == "true" ]]; then
  if [[ "$PROFILE" == "dev" ]]; then
    echo "[5/6] Levantando DB primero..."
    compose up -d db
    wait_for_postgres
    wait_for_initdb_completion
    wait_for_demo_base_seed

    if [[ "$APPLY_POST_INIT_SQL" == "true" ]]; then
      run_post_init_sql
    else
      echo "=== SQL post-init: SKIP ==="
    fi

    ensure_demo_base_data

    echo "=== Levantando stack completo ==="
    compose up -d
  else
    echo "[5/6] Levantando stack completo..."
    compose up -d
  fi
else
  echo "[5/6] Up: SKIP"
fi

# =========================
# 6) Verificaciones finales
# =========================
echo "[6/6] Verificaciones finales..."
if [[ "$DOWN_UP" == "true" ]]; then
  compose ps || true

  wait_for_http "backend" "http://127.0.0.1:${API_PORT}/api/health"
  wait_for_http "web" "http://127.0.0.1:${WEB_PORT}/"
  wait_for_http "listener" "http://127.0.0.1:${LISTENER_PORT}/health"
  verify_demo_endpoints
fi

echo
echo "=== Deploy OK ==="
echo "DATE=$(timestamp)"
