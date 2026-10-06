#!/bin/sh
# Mantener sintaxis POSIX para que el arranque funcione incluso si la imagen no trae bash.
set -e

echo "[start] APP_ENV=${APP_ENV:-develop}"

# Si DATABASE_URL no viene seteada (recomendado), la resolvemos desde settings
if [ -z "${DATABASE_URL:-}" ]; then
  export DATABASE_URL=$(python - <<'PY'
from app.core.config import settings
print(settings.SQLALCHEMY_DATABASE_URI)
PY
  )
fi

echo "[start] esperando DB en ${DATABASE_URL}"

python - <<'PY'
import os
from urllib.parse import urlparse

env = (os.environ.get("APP_ENV") or "develop").strip().lower()
url = os.environ.get("DATABASE_URL") or ""
explicit_url = bool(url)
parsed = urlparse(url)
host = parsed.hostname or ""
port = parsed.port
is_prod = env in {"produccion", "prod", "production"}

if explicit_url:
    print("[start] DATABASE_URL explicita detectada; se omite validacion por APP_ENV.")
elif is_prod:
    expected_host = os.environ.get("PROD_DB_HOST", "host.docker.internal")
    expected_port = int(os.environ.get("PROD_DB_PORT", "5432"))
    if host != expected_host or port != expected_port:
        print(
            f"[start][warn] APP_ENV={env} pero DATABASE_URL apunta a {host}:{port}; "
            f"esperado {expected_host}:{expected_port}"
        )
else:
    expected_host = os.environ.get("POSTGRES_HOST", "zenit-db")
    expected_port = int(os.environ.get("POSTGRES_PORT", "5432"))
    host_port = os.environ.get("POSTGRES_HOST_PORT", "10500")

    if host != expected_host or port != expected_port:
        print(
            f"[start][warn] APP_ENV={env} pero DATABASE_URL apunta a {host}:{port}; "
            f"esperado {expected_host}:{expected_port}"
        )

    if host in {"localhost", "127.0.0.1"}:
        print("[start][warn] En Docker no debes usar localhost para conectar al Postgres de desarrollo.")

    if str(port) == str(host_port):
        print(
            f"[start][warn] DATABASE_URL usa el puerto host {host_port}. "
            "Dentro de Docker debe usarse POSTGRES_PORT=5432."
        )
PY

# Espera activa a que la DB acepte conexiones
python - <<'PY'
import asyncio, os, sys
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import create_async_engine

url = os.environ.get("DATABASE_URL")
if not url:
    print("DATABASE_URL no definido", file=sys.stderr)
    sys.exit(1)

async def ping():
    eng = create_async_engine(url, pool_pre_ping=True)
    for i in range(60):
        try:
            async with eng.connect() as conn:
                await conn.execute(sa.text("SELECT 1"))
            print("DB OK")
            await eng.dispose()
            return
        except Exception as e:
            print(f"DB no lista ({i+1}/60): {e}")
            await asyncio.sleep(1)
    print("Timeout esperando DB", file=sys.stderr)
    sys.exit(1)

asyncio.run(ping())
PY

if [ "${TMONE_DB_BOOTSTRAP_ENABLED:-true}" = "true" ] && [ -n "${TMONE_DB_BOOTSTRAP_PROFILE:-}" ]; then
  echo "[start] aplicando bootstrap DB profile=${TMONE_DB_BOOTSTRAP_PROFILE}"
  python /app/bootstrap_db.py
fi

echo "[start] lanzando uvicorn..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
