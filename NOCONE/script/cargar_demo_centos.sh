#!/usr/bin/env bash
set -euo pipefail

# Carga/reemplaza el perfil DEMO sobre una BD Zenit ya creada en CentOS.
# A diferencia de docker-entrypoint-initdb.d, esto se puede ejecutar cuantas
# veces sea necesario sobre el volumen existente.

ROOT_DIR="${ROOT_DIR:-/home/tmone/TmOne}"
DB_CONTAINER="${DB_CONTAINER:-zenit-db}"
POSTGRES_DB="${POSTGRES_DB:-zenit}"
POSTGRES_USER="${POSTGRES_USER:-zenit}"
WAIT_SECONDS="${WAIT_SECONDS:-600}"
cd /home/tmone/TmOne || {
    echo "ERROR: no existe /home/tmone/TmOne"
    exit 1
}

wait_for_postgres_initdb() {
    local started_at logs
    started_at=$(date +%s)

    echo "Esperando que PostgreSQL termine su inicializacion (maximo ${WAIT_SECONDS}s)..."
    while true; do
        logs="$(docker logs zenit-db 2>&1 || true)"

        # Un volumen ya inicializado no ejecuta initdb; puede continuar de inmediato.
        if grep -Fq "PostgreSQL Database directory appears to contain a database; Skipping initialization" <<< "$logs"; then
            echo "PostgreSQL usa una base existente; initdb no aplica."
            return 0
        fi

        # En una base nueva, esta linea se emite solo tras ejecutar todo initdb.
        if grep -Fq "PostgreSQL init process complete" <<< "$logs"; then
            echo "Inicializacion de PostgreSQL finalizada."
            return 0
        fi

        if (( $(date +%s) - started_at >= WAIT_SECONDS )); then
            echo "ERROR: timeout esperando la inicializacion de PostgreSQL." >&2
            docker logs --tail 200 zenit-db >&2 || true
            exit 1
        fi
        sleep 2
    done
}

# ============================================================
# CARGA FORZADA DE LOS SQL DEMO EN POSTGRESQL
# Base: zenit
# Usuario: zenit
# Contenedor: zenit-db
# ============================================================

SQL_FILES=(
    "./db/seed_produccion_min.sql"
    "./db/zenit_demo_1_dia_diamante.sql"
    "./db/zenit_demo_1_dia_andes.sql"
    "./db/zenit_demo_3_meses.sql"
    "./db/zenit_demo_1_dia_todos.sql"
    "./db/fix_demo_encoding.sql"
    "./db/99_fix_fleet_activity_seed.sql"
    "./db/99_fix_fleet_full_distribution.sql"
)

echo
echo "============================================================"
echo "1. VERIFICANDO ARCHIVOS SQL"
echo "============================================================"

FALTANTES=0

for SQL_FILE in "${SQL_FILES[@]}"; do
    if [ -f "$SQL_FILE" ]; then
        echo "OK: $SQL_FILE"
    else
        echo "FALTA: $SQL_FILE"
        FALTANTES=1
    fi
done

if [ "$FALTANTES" -ne 0 ]; then
    echo
    echo "ERROR: faltan uno o más archivos SQL."
    exit 1
fi

echo
echo "============================================================"
echo "2. VERIFICANDO POSTGRESQL"
echo "============================================================"

docker exec zenit-db \
    pg_isready \
    -U zenit \
    -d zenit

if [ "$?" -ne 0 ]; then
    echo "ERROR: PostgreSQL no está disponible."
    exit 1
fi

wait_for_postgres_initdb

echo
echo "============================================================"
echo "3. DETENIENDO SERVICIOS QUE USAN LA BASE"
echo "============================================================"

docker stop \
    zenit-web \
    zenit-backend \
    zenit-listener \
    2>/dev/null || true

echo
echo "============================================================"
echo "4. GENERANDO IMPORTACIÓN FORZADA"
echo "============================================================"

# No usar nombres fijos en /tmp: una ejecucion anterior con sudo puede dejar
# archivos de root que el usuario actual no puede eliminar (por el sticky bit).
# mktemp crea un directorio privado y propiedad del usuario que ejecuta el script.
IMPORT_DIR=$(mktemp -d "${TMPDIR:-/tmp}/zenit-importacion-forzada.XXXXXX") || {
    echo "ERROR: no se pudo crear el directorio temporal para la importacion." >&2
    exit 1
}
IMPORT_SQL="$IMPORT_DIR/importacion.sql"
IMPORT_LOG="$IMPORT_DIR/importacion.log"

echo "Archivos temporales: $IMPORT_DIR"

cat > "$IMPORT_SQL" <<'SQL_INICIO'
\set ON_ERROR_STOP off
\set ON_ERROR_ROLLBACK on

\echo
\echo ============================================================
\echo DESACTIVANDO TRIGGERS Y RESTRICCIONES REFERENCIALES
\echo ============================================================

SET client_min_messages = warning;
SET session_replication_role = replica;
SQL_INICIO

for SQL_FILE in "${SQL_FILES[@]}"; do
    {
        echo
        echo "\\echo"
        echo "\\echo ============================================================"
        echo "\\echo EJECUTANDO: $SQL_FILE"
        echo "\\echo ============================================================"
        echo
        cat "$SQL_FILE"
        echo
        echo "\\echo FINALIZADO: $SQL_FILE"
        echo
    } >> "$IMPORT_SQL"
done

cat >> "$IMPORT_SQL" <<'SQL_FINAL'

\echo
\echo ============================================================
\echo FINALIZANDO TRANSACCIONES ABIERTAS
\echo ============================================================

COMMIT;

\echo
\echo ============================================================
\echo REACTIVANDO TRIGGERS Y RESTRICCIONES
\echo ============================================================

SET session_replication_role = origin;

\echo
\echo ============================================================
\echo IMPORTACIÓN SQL FINALIZADA
\echo ============================================================
SQL_FINAL

echo
echo "============================================================"
echo "5. EJECUTANDO TODOS LOS SQL"
echo "============================================================"

set +e

docker exec -i zenit-db \
    psql \
    -X \
    -U zenit \
    -d zenit \
    < "$IMPORT_SQL" 2>&1 |
    tee "$IMPORT_LOG"

IMPORT_STATUS=${PIPESTATUS[0]}

set -e

echo
echo "============================================================"
echo "6. ASEGURANDO QUE LAS RESTRICCIONES QUEDEN ACTIVADAS"
echo "============================================================"

docker exec zenit-db \
    psql \
    -X \
    -U zenit \
    -d zenit \
    -v ON_ERROR_STOP=1 \
    -c "SET session_replication_role = origin;"

echo
echo "============================================================"
echo "7. ACTUALIZANDO SECUENCIAS ID"
echo "============================================================"

docker exec -i zenit-db \
    psql \
    -X \
    -U zenit \
    -d zenit \
    -v ON_ERROR_STOP=1 <<'SQL_SECUENCIAS'
DO $$
DECLARE
    registro RECORD;
    maximo BIGINT;
BEGIN
    FOR registro IN
        SELECT
            tabla_ns.nspname AS esquema_tabla,
            tabla.relname AS nombre_tabla,
            columna.attname AS nombre_columna,
            secuencia_ns.nspname AS esquema_secuencia,
            secuencia.relname AS nombre_secuencia
        FROM pg_class secuencia
        JOIN pg_namespace secuencia_ns
          ON secuencia_ns.oid = secuencia.relnamespace
        JOIN pg_depend dependencia
          ON dependencia.objid = secuencia.oid
         AND dependencia.deptype IN ('a', 'i')
        JOIN pg_class tabla
          ON tabla.oid = dependencia.refobjid
        JOIN pg_namespace tabla_ns
          ON tabla_ns.oid = tabla.relnamespace
        JOIN pg_attribute columna
          ON columna.attrelid = tabla.oid
         AND columna.attnum = dependencia.refobjsubid
        WHERE secuencia.relkind = 'S'
          AND tabla.relkind IN ('r', 'p')
          AND tabla_ns.nspname = 'public'
    LOOP
        EXECUTE format(
            'SELECT COALESCE(MAX(%I), 0) FROM %I.%I',
            registro.nombre_columna,
            registro.esquema_tabla,
            registro.nombre_tabla
        )
        INTO maximo;

        IF maximo <= 0 THEN
            EXECUTE format(
                'SELECT setval(%L::regclass, 1, false)',
                format(
                    '%I.%I',
                    registro.esquema_secuencia,
                    registro.nombre_secuencia
                )
            );
        ELSE
            EXECUTE format(
                'SELECT setval(%L::regclass, %s, true)',
                format(
                    '%I.%I',
                    registro.esquema_secuencia,
                    registro.nombre_secuencia
                ),
                maximo
            );
        END IF;
    END LOOP;
END
$$;
SQL_SECUENCIAS

echo
echo "============================================================"
echo "8. ACTUALIZANDO ESTADÍSTICAS DE POSTGRESQL"
echo "============================================================"

docker exec zenit-db \
    psql \
    -X \
    -U zenit \
    -d zenit \
    -v ON_ERROR_STOP=1 \
    -c "ANALYZE;"

echo
echo "============================================================"
echo "9. REINICIANDO SERVICIOS"
echo "============================================================"

docker start \
    zenit-backend \
    zenit-listener \
    zenit-web \
    2>/dev/null || true

sleep 8

echo
echo "============================================================"
echo "10. ESTADO DE CONTENEDORES"
echo "============================================================"

docker ps \
    --filter name=zenit-db \
    --filter name=zenit-backend \
    --filter name=zenit-listener \
    --filter name=zenit-web

echo
echo "============================================================"
echo "11. CANTIDAD DE REGISTROS POR TABLA"
echo "============================================================"

docker exec zenit-db \
    psql \
    -X \
    -U zenit \
    -d zenit \
    -c "
SELECT
    schemaname AS esquema,
    relname AS tabla,
    n_live_tup AS registros_estimados
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC, relname ASC;
"

echo
echo "============================================================"
echo "12. RESULTADO DE LA IMPORTACIÓN"
echo "============================================================"

ERRORES=$(grep -c "ERROR:" "$IMPORT_LOG" 2>/dev/null || true)

echo "Estado del proceso psql: $IMPORT_STATUS"
echo "Sentencias que informaron ERROR: $ERRORES"
echo "Log: $IMPORT_LOG"

if [ "$ERRORES" -gt 0 ]; then
    echo
    echo "La carga continuó aunque hubo sentencias con error."
    echo "Errores encontrados:"
    grep -n -A 3 -B 1 "ERROR:" "$IMPORT_LOG" || true
else
    echo
    echo "TODOS LOS SQL FUERON PROCESADOS SIN ERRORES."
fi

echo
echo "============================================================"
echo "CARGA FORZADA FINALIZADA"
echo "============================================================"
