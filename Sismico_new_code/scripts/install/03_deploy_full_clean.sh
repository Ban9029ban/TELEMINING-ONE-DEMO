#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Limpieza total Docker + sincronizacion Git + build sin cache + deploy.
#
# Uso:
#   PROJECT_DIR=/home/soporte/Sismico_new_code FINAL_BRANCH=master ./03_deploy_full_clean.sh
# ==============================================================================

PROJECT_DIR="${PROJECT_DIR:-$HOME/Sismico_new_code}"
FINAL_BRANCH="${FINAL_BRANCH:-master}"
LOG_FILE="${LOG_FILE:-$PROJECT_DIR/deploy_full_clean.log}"

mkdir -p "$(dirname "${LOG_FILE}")"
exec > >(tee -a "${LOG_FILE}") 2>&1

# Detectar comando de docker-compose: preferir `docker compose` si está disponible
if docker --help 2>&1 | grep -q 'compose'; then
  DOCKER_COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE_CMD="docker-compose"
else
  DOCKER_COMPOSE_CMD="docker compose"
fi

# Verificar que docker está instalado y el daemon responde
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: 'docker' no encontrado. Instale Docker antes de ejecutar este script."
  exit 1
fi
if ! docker version >/dev/null 2>&1; then
  echo "ERROR: el daemon de Docker no responde. Asegure que Docker esté corriendo (systemctl start docker) y que tenga permisos." 
  exit 1
fi

echo "======================================================"
echo " Deploy full clean"
echo " Proyecto: ${PROJECT_DIR}"
echo " Rama final: ${FINAL_BRANCH}"
echo "======================================================"

if [[ ! -d "${PROJECT_DIR}" ]]; then
  echo "ERROR: no existe PROJECT_DIR=${PROJECT_DIR}"
  exit 1
fi

cd "${PROJECT_DIR}"

if [[ ! -d ".git" ]]; then
  echo "ERROR: ${PROJECT_DIR} no es un repositorio Git."
  exit 1
fi

echo "[1/10] Estado inicial Git"
git status || true

echo "[2/10] Docker compose down con limpieza de compose"
${DOCKER_COMPOSE_CMD} down --rmi all --remove-orphans -v || true

echo "[3/10] Docker prune completo"
docker builder prune -af || true
docker image prune -af || true
docker container prune -f || true
docker volume prune -f || true
docker network prune -f || true

echo "[4/10] Git fetch"
git fetch origin --prune

echo "[5/10] Sincronizando master"
if git ls-remote --exit-code --heads origin master >/dev/null 2>&1; then
  git checkout -B master origin/master
  git reset --hard origin/master
  git clean -fd
else
  echo "ADVERTENCIA: origin/master no existe."
fi

echo "[6/10] Sincronizando develop"
if git ls-remote --exit-code --heads origin develop >/dev/null 2>&1; then
  git checkout -B develop origin/develop
  git reset --hard origin/develop
  git clean -fd
else
  echo "ADVERTENCIA: origin/develop no existe."
fi

echo "[7/10] Sincronizando staging"
if git ls-remote --exit-code --heads origin staging >/dev/null 2>&1; then
  git checkout -B staging origin/staging
  git reset --hard origin/staging
  git clean -fd
else
  echo "ADVERTENCIA: origin/staging no existe."
fi

echo "[8/10] Rama final"
git checkout "${FINAL_BRANCH}"
git status

echo "[9/10] Build no cache"
${DOCKER_COMPOSE_CMD} build --no-cache || true

echo "[10/10] Up"
${DOCKER_COMPOSE_CMD} up -d || true

echo "Estado final:"
${DOCKER_COMPOSE_CMD} ps || true

echo "Logs en vivo. Cortar con CTRL+C."
${DOCKER_COMPOSE_CMD} logs -f
