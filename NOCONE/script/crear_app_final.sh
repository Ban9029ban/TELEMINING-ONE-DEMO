#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# crear_app_final.sh
# Genera app_final.tar con:
# - Carpeta completa de la app
# - docker-compose.yml
# - .env
# - backend/.env si existe
# - carpeta db/
# - dump PostgreSQL
# - imágenes Docker
# - deploy_app_final.sh interno
#
# Ejecutar desde la raíz del proyecto:
#   ./crear_app_final.sh
# ============================================================

# ==========================
# CONFIGURACIÓN
# ==========================

APP_NAME="zenit"
FINAL_TAR="app_final.tar"
STAGING_DIR="_app_final_package"

DB_CONTAINER="zenit-db"
DB_USER="zenit"
DB_NAME="zenit"
DB_DUMP_FILE="zenit_db_backup.sql"

DOCKER_IMAGES_TAR="zenit_docker_images.tar"

# Imágenes principales esperadas
FALLBACK_IMAGES=(
  "code_new-web"
  "code_new-backend"
  "code_new-listener"
  "ollama/ollama:0.23.2"
  "postgres:16"
)

# Contenedores esperados
CONTAINERS=(
  "zenit-web"
  "zenit-backend"
  "zenit-listener"
  "zenit-ollama"
  "zenit-db"
)

echo "============================================================"
echo " CREAR PAQUETE FINAL ZENIT / TMONE"
echo "============================================================"

# ==========================
# VALIDACIONES
# ==========================

echo "==> Validando Docker..."

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker no está instalado o no está en PATH."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker no está corriendo o el usuario no tiene permisos."
  echo "Prueba: sudo systemctl start docker"
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: Docker Compose v2 no está disponible."
  echo "Debe funcionar: docker compose version"
  exit 1
fi

echo "==> Validando docker-compose.yml..."

if [ ! -f "docker-compose.yml" ]; then
  echo "ERROR: No existe docker-compose.yml en esta carpeta."
  echo "Ejecuta este script desde la raíz del proyecto."
  exit 1
fi

echo "==> Carpeta actual:"
pwd

# ==========================
# LIMPIEZA PREVIA
# ==========================

echo "==> Limpiando paquetes anteriores..."

rm -f "$FINAL_TAR"
rm -rf "$STAGING_DIR"

mkdir -p "$STAGING_DIR/app"

# ==========================
# GENERAR DUMP POSTGRESQL
# ==========================

echo "==> Generando dump PostgreSQL desde contenedor: $DB_CONTAINER"

if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  echo "ERROR: El contenedor $DB_CONTAINER no está corriendo."
  echo "Levanta la app antes de generar el dump:"
  echo "  docker compose --profile dev up -d"
  exit 1
fi

docker exec "$DB_CONTAINER" sh -c "pg_dump -U '$DB_USER' -d '$DB_NAME' -f '/tmp/$DB_DUMP_FILE'"

docker cp "$DB_CONTAINER:/tmp/$DB_DUMP_FILE" "$STAGING_DIR/$DB_DUMP_FILE"

docker exec "$DB_CONTAINER" sh -c "rm -f '/tmp/$DB_DUMP_FILE'"

if [ ! -f "$STAGING_DIR/$DB_DUMP_FILE" ]; then
  echo "ERROR: No se generó el dump de base de datos."
  exit 1
fi

echo "==> Dump generado correctamente: $DB_DUMP_FILE"

# ==========================
# DETECTAR IMÁGENES DESDE CONTENEDORES
# ==========================

echo "==> Detectando imágenes Docker desde contenedores..."

DETECTED_IMAGES=()

for CONTAINER_NAME in "${CONTAINERS[@]}"; do
  if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
    IMAGE_NAME="$(docker inspect "$CONTAINER_NAME" --format '{{.Config.Image}}')"
    if [ -n "$IMAGE_NAME" ]; then
      DETECTED_IMAGES+=("$IMAGE_NAME")
      echo "    $CONTAINER_NAME -> $IMAGE_NAME"
    fi
  else
    echo "    Aviso: no existe contenedor $CONTAINER_NAME"
  fi
done

# Agregar imágenes fallback si existen localmente
for IMG in "${FALLBACK_IMAGES[@]}"; do
  if docker image inspect "$IMG" >/dev/null 2>&1; then
    DETECTED_IMAGES+=("$IMG")
  fi
done

# Quitar duplicados
IMAGES=($(printf "%s\n" "${DETECTED_IMAGES[@]}" | sort -u))

if [ "${#IMAGES[@]}" -eq 0 ]; then
  echo "ERROR: No se detectaron imágenes Docker para guardar."
  exit 1
fi

echo "==> Imágenes que se guardarán:"
printf '    %s\n' "${IMAGES[@]}"

# ==========================
# GUARDAR IMÁGENES DOCKER
# ==========================

echo "==> Guardando imágenes Docker en $DOCKER_IMAGES_TAR..."

docker save "${IMAGES[@]}" -o "$STAGING_DIR/$DOCKER_IMAGES_TAR"

if [ ! -f "$STAGING_DIR/$DOCKER_IMAGES_TAR" ]; then
  echo "ERROR: No se generó $DOCKER_IMAGES_TAR"
  exit 1
fi

echo "==> Imágenes Docker guardadas correctamente."

# ==========================
# COPIAR APP COMPLETA AL STAGING
# ==========================

echo "==> Copiando carpeta completa de la app..."

# Excluimos basura pesada/no necesaria y el propio paquete.
rsync -a \
  --exclude "$STAGING_DIR" \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude "__pycache__" \
  --exclude ".pytest_cache" \
  --exclude ".mypy_cache" \
  --exclude ".venv" \
  --exclude "venv" \
  --exclude "env" \
  --exclude "$FINAL_TAR" \
  --exclude "$DOCKER_IMAGES_TAR" \
  --exclude "$DB_DUMP_FILE" \
  ./ "$STAGING_DIR/app/"

# Copiar dump e imágenes dentro de app
cp "$STAGING_DIR/$DB_DUMP_FILE" "$STAGING_DIR/app/$DB_DUMP_FILE"
cp "$STAGING_DIR/$DOCKER_IMAGES_TAR" "$STAGING_DIR/app/$DOCKER_IMAGES_TAR"

# ==========================
# CREAR SCRIPT DE DESPLIEGUE DENTRO DEL PAQUETE
# ==========================

echo "==> Creando deploy_app_final.sh interno..."

cat > "$STAGING_DIR/deploy_app_final.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# deploy_app_final.sh
# Despliegue completo desde app_final.tar ya descomprimido
# ============================================================

UNPACK_BASE="$(pwd)"
APP_SOURCE_DIR="$UNPACK_BASE/app"
APP_DIR="$HOME/zenit_app"

DB_SERVICE="db"
DB_CONTAINER="zenit-db"
DB_USER="${POSTGRES_USER:-zenit}"
DB_NAME="${POSTGRES_DB:-zenit}"
DB_DUMP_FILE="zenit_db_backup.sql"
DOCKER_IMAGES_TAR="zenit_docker_images.tar"

echo "============================================================"
echo " DESPLIEGUE COMPLETO ZENIT / TMONE"
echo "============================================================"

if [ ! -d "$APP_SOURCE_DIR" ]; then
  echo "ERROR: No existe carpeta app dentro del paquete."
  exit 1
fi

if [ ! -f "$APP_SOURCE_DIR/docker-compose.yml" ]; then
  echo "ERROR: No existe app/docker-compose.yml"
  exit 1
fi

if [ ! -f "$APP_SOURCE_DIR/$DOCKER_IMAGES_TAR" ]; then
  echo "ERROR: No existe app/$DOCKER_IMAGES_TAR"
  exit 1
fi

if [ ! -f "$APP_SOURCE_DIR/$DB_DUMP_FILE" ]; then
  echo "ERROR: No existe app/$DB_DUMP_FILE"
  exit 1
fi

echo "==> Validando Docker..."

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker no está instalado."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker no está corriendo o no tienes permisos."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: Docker Compose v2 no está instalado."
  exit 1
fi

echo "==> Preparando carpeta final: $APP_DIR"
mkdir -p "$APP_DIR"

echo "==> Copiando app completa..."
cp -a "$APP_SOURCE_DIR/." "$APP_DIR/"

cd "$APP_DIR"

echo "==> Cargando imágenes Docker..."
docker load -i "$DOCKER_IMAGES_TAR"

echo "==> Bajando stack anterior si existe..."
docker compose --profile dev down || true

echo "==> Levantando PostgreSQL..."
docker compose --profile dev up -d "$DB_SERVICE"

echo "==> Esperando PostgreSQL..."

for i in $(seq 1 90); do
  if docker exec "$DB_CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
    echo "PostgreSQL listo."
    break
  fi

  if [ "$i" -eq 90 ]; then
    echo "ERROR: PostgreSQL no respondió a tiempo."
    docker logs "$DB_CONTAINER" || true
    exit 1
  fi

  sleep 2
done

echo "==> Restaurando base de datos $DB_NAME..."

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

docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$DB_DUMP_FILE"

echo "==> Base restaurada correctamente."

echo "==> Construyendo servicios sin caché..."
docker compose build --no-cache

echo "==> Levantando app completa con profile dev..."
docker compose --profile dev up -d

echo "==> Esperando healthchecks..."
sleep 15

echo "==> Estado final:"
docker ps

echo "==> Probando API health:"
curl -fsS "http://localhost:8000/api/health" || true
echo ""

echo "============================================================"
echo " DESPLIEGUE COMPLETADO"
echo "============================================================"
echo " Web:       http://IP_SERVIDOR:8081"
echo " API:       http://IP_SERVIDOR:8000/api/health"
echo " Listener:  http://IP_SERVIDOR:8090"
echo " TCP:       IP_SERVIDOR:7070"
echo " PostgreSQL:"
echo "   Puerto host: 10500"
echo "   DB:          $DB_NAME"
echo "   User:        $DB_USER"
echo "============================================================"
EOF

chmod +x "$STAGING_DIR/deploy_app_final.sh"

# ==========================
# CREAR TAR FINAL
# ==========================

echo "==> Creando paquete final: $FINAL_TAR"

tar -cvf "$FINAL_TAR" -C "$STAGING_DIR" .

if [ ! -f "$FINAL_TAR" ]; then
  echo "ERROR: No se generó $FINAL_TAR"
  exit 1
fi

echo "============================================================"
echo " PAQUETE FINAL GENERADO CORRECTAMENTE"
echo "============================================================"
ls -lh "$FINAL_TAR"
echo ""
echo "Archivo generado:"
echo "  $FINAL_TAR"
echo ""
echo "Para desplegar en otro CentOS:"
echo "  scp $FINAL_TAR usuario@IP_SERVIDOR:/home/usuario/"
echo "  ssh usuario@IP_SERVIDOR"
echo "  rm -rf ~/app_final_unpack && mkdir -p ~/app_final_unpack"
echo "  tar -xvf ~/app_final.tar -C ~/app_final_unpack"
echo "  cd ~/app_final_unpack"
echo "  chmod +x deploy_app_final.sh"
echo "  ./deploy_app_final.sh"
echo "============================================================"