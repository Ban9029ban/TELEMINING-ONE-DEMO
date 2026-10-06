# ============================================================
# crear_app_final.ps1
# Genera app_final.tar con:
# - Código completo de la app
# - docker-compose.yml
# - .env
# - Dump PostgreSQL
# - Imágenes Docker
# ============================================================

$ErrorActionPreference = "Stop"

# ==========================
# CONFIGURACIÓN
# ==========================

$APP_NAME = "zenit"
$FINAL_TAR = "app_final.tar"
$STAGING_DIR = "_app_final_package"

# Contenedor y credenciales PostgreSQL según tu docker-compose.yml
$DB_CONTAINER = "zenit-db"
$DB_USER = "zenit"
$DB_NAME = "zenit"
$DB_DUMP_FILE = "zenit_db_backup.sql"

# Contenedores esperados
$CONTAINERS = @(
    "zenit-web",
    "zenit-backend",
    "zenit-listener",
    "zenit-ollama",
    "zenit-db"
)

# Imágenes fallback por si algún contenedor no está corriendo
$FALLBACK_IMAGES = @(
    "code_new-web",
    "code_new-backend",
    "code_new-listener",
    "ollama/ollama:0.23.2",
    "postgres:16"
)

# ==========================
# VALIDACIONES
# ==========================

Write-Host "==> Validando Docker..." -ForegroundColor Cyan
docker version | Out-Null

Write-Host "==> Validando docker-compose.yml..." -ForegroundColor Cyan
if (!(Test-Path ".\docker-compose.yml")) {
    throw "No existe docker-compose.yml en esta carpeta. Ejecuta el script desde la raíz del proyecto."
}

Write-Host "==> Carpeta actual:" -ForegroundColor Cyan
Get-Location

# ==========================
# LIMPIEZA PREVIA
# ==========================

Write-Host "==> Limpiando paquetes anteriores..." -ForegroundColor Cyan

if (Test-Path ".\$FINAL_TAR") {
    Remove-Item ".\$FINAL_TAR" -Force
}

if (Test-Path ".\$STAGING_DIR") {
    Remove-Item ".\$STAGING_DIR" -Recurse -Force
}

New-Item -ItemType Directory -Force ".\$STAGING_DIR" | Out-Null
New-Item -ItemType Directory -Force ".\$STAGING_DIR\app" | Out-Null

# ==========================
# DUMP POSTGRESQL
# ==========================

Write-Host "==> Generando dump de PostgreSQL desde $DB_CONTAINER..." -ForegroundColor Cyan

$DbRunning = docker ps --format "{{.Names}}" | Select-String -Pattern "^$DB_CONTAINER$"

if ($null -eq $DbRunning) {
    throw "El contenedor $DB_CONTAINER no está corriendo. Levanta la app antes de generar el dump."
}

# Genera dump dentro del contenedor para evitar problemas de encoding en PowerShell
docker exec $DB_CONTAINER sh -c "pg_dump -U $DB_USER -d $DB_NAME -f /tmp/$DB_DUMP_FILE"

# Copia dump desde el contenedor al staging
docker cp "${DB_CONTAINER}:/tmp/$DB_DUMP_FILE" ".\$STAGING_DIR\$DB_DUMP_FILE"

# Limpia dump temporal del contenedor
docker exec $DB_CONTAINER sh -c "rm -f /tmp/$DB_DUMP_FILE"

if (!(Test-Path ".\$STAGING_DIR\$DB_DUMP_FILE")) {
    throw "No se generó el dump de base de datos."
}

Write-Host "==> Dump generado: $DB_DUMP_FILE" -ForegroundColor Green

# ==========================
# DETECTAR IMÁGENES DESDE CONTENEDORES
# ==========================

Write-Host "==> Detectando imágenes Docker desde contenedores..." -ForegroundColor Cyan

$DetectedImages = @()

foreach ($ContainerName in $CONTAINERS) {
    $Exists = docker ps -a --format "{{.Names}}" | Select-String -Pattern "^$ContainerName$"
    if ($null -ne $Exists) {
        $ImageName = docker inspect $ContainerName --format "{{.Config.Image}}"
        if (![string]::IsNullOrWhiteSpace($ImageName)) {
            $DetectedImages += $ImageName
            Write-Host "    $ContainerName -> $ImageName"
        }
    } else {
        Write-Host "    Aviso: no existe contenedor $ContainerName" -ForegroundColor Yellow
    }
}

# Agregar fallback
foreach ($Img in $FALLBACK_IMAGES) {
    $ImageExists = docker image inspect $Img 2>$null
    if ($LASTEXITCODE -eq 0) {
        $DetectedImages += $Img
    }
}

$Images = $DetectedImages | Sort-Object -Unique

if ($Images.Count -eq 0) {
    throw "No se detectaron imágenes Docker para guardar."
}

Write-Host "==> Imágenes que se guardarán:" -ForegroundColor Cyan
$Images | ForEach-Object { Write-Host "    $_" }

# ==========================
# GUARDAR IMÁGENES DOCKER
# ==========================

Write-Host "==> Guardando imágenes Docker en zenit_docker_images.tar..." -ForegroundColor Cyan

docker save $Images -o ".\$STAGING_DIR\zenit_docker_images.tar"

if (!(Test-Path ".\$STAGING_DIR\zenit_docker_images.tar")) {
    throw "No se generó zenit_docker_images.tar"
}

Write-Host "==> Imágenes Docker guardadas." -ForegroundColor Green

# ==========================
# COPIAR APP COMPLETA AL STAGING
# ==========================

Write-Host "==> Copiando carpeta completa de la app..." -ForegroundColor Cyan

# Excluye el staging y paquetes previos para evitar recursividad.
# También excluye app_final.tar si existe.
$ExcludeDirs = @(
    $STAGING_DIR,
    ".git",
    "node_modules",
    "__pycache__",
    ".venv",
    "venv",
    "env",
    ".pytest_cache",
    ".mypy_cache"
)

$ExcludeFiles = @(
    $FINAL_TAR,
    "zenit_docker_images.tar",
    $DB_DUMP_FILE
)

Get-ChildItem -Force | ForEach-Object {
    $Name = $_.Name

    if ($_.PSIsContainer) {
        if ($ExcludeDirs -contains $Name) {
            Write-Host "    Excluyendo carpeta: $Name" -ForegroundColor DarkYellow
        } else {
            Copy-Item $_.FullName ".\$STAGING_DIR\app\$Name" -Recurse -Force
        }
    } else {
        if ($ExcludeFiles -contains $Name) {
            Write-Host "    Excluyendo archivo: $Name" -ForegroundColor DarkYellow
        } else {
            Copy-Item $_.FullName ".\$STAGING_DIR\app\$Name" -Force
        }
    }
}

# Copiar dump también dentro de app para facilidad
Copy-Item ".\$STAGING_DIR\$DB_DUMP_FILE" ".\$STAGING_DIR\app\$DB_DUMP_FILE" -Force

# Copiar tar de imágenes también dentro de app
Copy-Item ".\$STAGING_DIR\zenit_docker_images.tar" ".\$STAGING_DIR\app\zenit_docker_images.tar" -Force

# ==========================
# CREAR SCRIPT DE DESPLIEGUE LINUX DENTRO DEL PAQUETE
# ==========================

Write-Host "==> Creando script deploy_centos.sh..." -ForegroundColor Cyan

$DeployScript = @'
#!/usr/bin/env bash
set -e

echo "============================================================"
echo " DESPLIEGUE ZENIT / TMONE - CENTOS"
echo "============================================================"

APP_DIR="$HOME/zenit_app"
PACKAGE_APP_DIR="app"

DB_CONTAINER="zenit-db"
DB_USER="zenit"
DB_NAME="zenit"
DB_DUMP_FILE="zenit_db_backup.sql"

echo "==> Creando carpeta destino: $APP_DIR"
mkdir -p "$APP_DIR"

echo "==> Copiando app al destino..."
cp -a "$PACKAGE_APP_DIR/." "$APP_DIR/"

cd "$APP_DIR"

echo "==> Verificando archivos principales..."
ls -lah

if [ ! -f "docker-compose.yml" ]; then
  echo "ERROR: No existe docker-compose.yml"
  exit 1
fi

if [ ! -f "zenit_docker_images.tar" ]; then
  echo "ERROR: No existe zenit_docker_images.tar"
  exit 1
fi

if [ ! -f "$DB_DUMP_FILE" ]; then
  echo "ERROR: No existe $DB_DUMP_FILE"
  exit 1
fi

echo "==> Cargando imágenes Docker..."
docker load -i zenit_docker_images.tar

echo "==> Imágenes disponibles:"
docker images

echo "==> Bajando contenedores anteriores del proyecto si existen..."
docker compose --profile dev down || true

echo "==> Levantando base de datos primero..."
docker compose --profile dev up -d db

echo "==> Esperando PostgreSQL..."
for i in $(seq 1 60); do
  if docker exec "$DB_CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
    echo "PostgreSQL listo."
    break
  fi

  if [ "$i" -eq 60 ]; then
    echo "ERROR: PostgreSQL no respondió a tiempo."
    docker logs "$DB_CONTAINER" || true
    exit 1
  fi

  sleep 2
done

echo "==> Restaurando base de datos desde $DB_DUMP_FILE..."

# Cierra conexiones activas, limpia esquema público y restaura.
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

echo "==> Estado de contenedores:"
docker ps

echo "============================================================"
echo " DESPLIEGUE COMPLETADO"
echo " Web:      http://IP_SERVIDOR:8081"
echo " API:      http://IP_SERVIDOR:8000/api/health"
echo " Listener: http://IP_SERVIDOR:8090"
echo " DB Host:  IP_SERVIDOR:10500"
echo "============================================================"
'@

Set-Content -Path ".\$STAGING_DIR\deploy_centos.sh" -Value $DeployScript -Encoding UTF8

# ==========================
# CREAR TAR FINAL
# ==========================

Write-Host "==> Creando $FINAL_TAR..." -ForegroundColor Cyan

tar -cvf ".\$FINAL_TAR" -C ".\$STAGING_DIR" .

if (!(Test-Path ".\$FINAL_TAR")) {
    throw "No se generó $FINAL_TAR"
}

Write-Host "============================================================" -ForegroundColor Green
Write-Host " PAQUETE FINAL GENERADO CORRECTAMENTE" -ForegroundColor Green
Write-Host " Archivo: $FINAL_TAR" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green

Get-Item ".\$FINAL_TAR" | Select-Object Name, Length, LastWriteTime