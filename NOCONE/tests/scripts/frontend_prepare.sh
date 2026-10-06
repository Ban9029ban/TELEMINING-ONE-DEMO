#!/usr/bin/env bash
set -euo pipefail

cd /workspace/web_front

echo "[frontend_prepare] Checking dependency state..."

if [ -f package-lock.json ]; then
  if npm ci --no-audit --no-fund; then
    echo "[frontend_prepare] npm ci OK"
  else
    echo "[frontend_prepare] npm ci failed due to lock/package drift. Falling back to npm install..."
    npm install --no-audit --no-fund
  fi
else
  echo "[frontend_prepare] package-lock.json not found. Running npm install..."
  npm install --no-audit --no-fund
fi

npm install --no-save --no-audit --no-fund jest-junit@16.0.0 serve@14.2.3

# El código actual importa esta dependencia, pero no está declarada en package.json.
# Se instala solo en el entorno de pruebas para no tocar archivos legacy.
if ! npm ls onnxruntime-web >/dev/null 2>&1; then
  npm install --no-save --no-audit --no-fund onnxruntime-web
fi
