#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# deploy_app_final.sh
# Despliegue completo Zenit/Tmone desde app_final.tar
#
# Requiere:
#   - app_final.tar en la misma carpeta desde donde se ejecuta
#   - Docker instalado
#   - Docker Compose v2: docker compose
#
# El app_final.tar debe contener:
#   - app/docker-compose.yml
#   - app/zenit_docker_images.tar
#   - app/zenit_db_backup.sql
#   - app/.env
#   - app/backend/
#   - app/web_front/
#   - app/listener/
#   - app/db/
# ============================================================

PACKAGE="app_final.tar"
UNPACK_DIR="$HOME/app_final_unpack"
APP_DIR="$HOME/zenit_app"

DB_SERVICE="db"
DB_CONTAINER="zenit-db"
DB_USER="${POSTGRES_USER:-zenit}"
DB_NAME="${POSTGRES_DB:-zenit}"
DB_DUMP_FILE="zenit_db_backup.sql"

echo "============================================================"
echo " DESPLIEGUE COMPLETO ZENIT / TMONE"
echo "============================================================"

# ------------------------------------------------------------
# 1. Validaciones básicas
# ------------------------------------------------------------

echo "==> Validando paquete..."

if [ ! -f "$PACKAGE" ]; then
  echo "ERROR: No existe $PACKAGE en: $(pwd)"
  echo "Copia app_final.tar a esta carpeta y vuelve a ejecutar."
  exit 1
fi

echo "==> Validando Docker..."

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker no está instalado o no está en PATH."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker no está corriendo o el usuario no tiene permisos."
  echo "Prueba con: sudo systemctl start docker"
  echo "O ejecuta este script con un usuario que pertenezca al grupo docker."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: Docker Compose v2 no está disponible."
  echo "Debe funcionar el comando: docker compose version"
  exit 1
fi

# ------------------------------------------------------------
# 2. Descomprimir paquete
# ------------------------------------------------------------

echo "==> Limpiando carpeta temporal..."
rm -rf "$UNPACK_DIR"
mkdir -p "$UNPACK_DIR"

echo "==> Descomprimiendo $PACKAGE en $UNPACK_DIR..."
tar -xvf "$PACKAGE" -C "$UNPACK_DIR"

echo "==> Contenido descomprimido:"
ls -lah "$UNPACK_DIR"

# ------------------------------------------------------------
# 3. Detectar carpeta app dentro del paquete
# ------------------------------------------------------------

if [ -d "$UNPACK_DIR/app" ]; then
  PACKAGE_APP_DIR="$UNPACK_DIR/app"
else
  # Fallback: si el tar fue armado con archivos en raíz
  PACKAGE_APP_DIR="$UNPACK_DIR"
fi

if [ ! -f "$PACKAGE_APP_DIR/docker-compose.yml" ]; then
  echo "ERROR: No se encontró docker-compose.yml."
  echo "Buscado en: $PACKAGE_APP_DIR"
  find "$UNPACK_DIR" -maxdepth 3 -type f | sort
  exit 1
fi

if [ ! -f "$PACKAGE_APP_DIR/zenit_docker_images.tar" ]; then
  echo "ERROR: No se encontró zenit_docker_images.tar."
  echo "Buscado en: $PACKAGE_APP_DIR"
  find "$UNPACK_DIR" -maxdepth 3 -type f | sort
  exit 1
fi

if [ ! -f "$PACKAGE_APP_DIR/$DB_DUMP_FILE" ]; then
  echo "ERROR: No se encontró $DB_DUMP_FILE."
  echo "Buscado en: $PACKAGE_APP_DIR"
  find "$UNPACK_DIR" -maxdepth 3 -type f | sort
  exit 1
fi

# ------------------------------------------------------------
# 4. Copiar app a carpeta definitiva
# ------------------------------------------------------------

echo "==> Preparando carpeta final: $APP_DIR"

mkdir -p "$APP_DIR"

echo "==> Copiando app completa a $APP_DIR..."
cp -a "$PACKAGE_APP_DIR/." "$APP_DIR/"

cd "$APP_DIR"

echo "==> Archivos principales en $APP_DIR:"
ls -lah

# ------------------------------------------------------------
# 5. Cargar imágenes Docker
# ------------------------------------------------------------

echo "==> Cargando imágenes Docker desde zenit_docker_images.tar..."
docker load -i zenit_docker_images.tar

echo "==> Imágenes Docker disponibles:"
docker images | head -30

# ------------------------------------------------------------
# 6. Bajar stack anterior
# ------------------------------------------------------------

echo "==> Bajando contenedores anteriores del proyecto, si existen..."
docker compose --profile dev down || true

# ------------------------------------------------------------
# 7. Levantar PostgreSQL primero
# ------------------------------------------------------------

echo "==> Levantando PostgreSQL con profile dev..."
docker compose --profile dev up -d "$DB_SERVICE"

echo "==> Esperando que PostgreSQL esté listo..."

for i in $(seq 1 90); do
  if docker exec "$DB_CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
    echo "PostgreSQL listo."
    break
  fi

  if [ "$i" -eq 90 ]; then
    echo "ERROR: PostgreSQL no respondió a tiempo."
    echo "Logs de $DB_CONTAINER:"
    docker logs "$DB_CONTAINER" || true
    exit 1
  fi

  sleep 2
done

# ------------------------------------------------------------
# 8. Restaurar base de datos
# ------------------------------------------------------------

echo "==> Restaurando base de datos $DB_NAME desde $DB_DUMP_FILE..."

echo "==> Cerrando conexiones activas y limpiando esquema public..."

docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" <<SQL
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = '$DB_NAME'
  AND pid <> pg_backend_pid();

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO $DB_USER;
GRANT ALL ON SCHEMA public TO public;
SQL

echo "==> Ejecutando dump SQL..."
docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$DB_DUMP_FILE"

echo "==> Base de datos restaurada correctamente."

# ------------------------------------------------------------
# 9. Build sin caché
# ------------------------------------------------------------

echo "==> Construyendo servicios sin caché..."
docker compose build --no-cache

# ------------------------------------------------------------
# 10. Levantar stack completo
# ------------------------------------------------------------

echo "==> Levantando stack completo con profile dev..."
docker compose --profile dev up -d

# ------------------------------------------------------------
# 11. Estado final
# ------------------------------------------------------------

echo "==> Esperando unos segundos para healthchecks..."
sleep 15

echo "==> Estado final de contenedores:"
docker ps

echo "==> Health backend:"
curl -fsS "http://localhost:8000/api/health" || true
echo ""

echo "============================================================"
echo " DESPLIEGUE COMPLETADO"
echo "============================================================"
echo " Web:       http://IP_SERVIDOR:8081"
echo " API:       http://IP_SERVIDOR:8000/api/health"
echo " Listener:  http://IP_SERVIDOR:8090"
echo " TCP:       IP_SERVIDOR:7070"
echo " PostgreSQL interno Docker:"
echo "   Host:    IP_SERVIDOR"
echo "   Puerto:  10500"
echo "   DB:      $DB_NAME"
echo "   User:    $DB_USER"
echo "============================================================"