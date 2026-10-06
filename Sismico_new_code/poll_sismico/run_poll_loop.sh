#!/bin/bash
set -u

INTERVAL="${INTERVAL:-120}"
LOG_FILE="${LOG_FILE:-/logs/poll_sismico.log}"
STARTUP_DELAY="${POLL_STARTUP_DELAY_SECONDS:-10}"
BACKEND_READY_URL="${BACKEND_READY_URL:-${BACKEND_BASE_URL:-http://backend:8000}/health}"
READY_TIMEOUT_SECONDS="${BACKEND_READY_TIMEOUT_SECONDS:-180}"

timestamp() {
  date +"%Y-%m-%d %H:%M:%S"
}

mkdir -p "$(dirname "$LOG_FILE")"

echo "$(timestamp) [BOOT] Esperando ${STARTUP_DELAY}s antes de iniciar polling" >> "$LOG_FILE"
sleep "$STARTUP_DELAY"

READY_STARTED_AT="$(date +%s)"
until curl -fsS "$BACKEND_READY_URL" >/dev/null 2>&1; do
  NOW="$(date +%s)"
  ELAPSED=$((NOW - READY_STARTED_AT))
  if [ "$ELAPSED" -ge "$READY_TIMEOUT_SECONDS" ]; then
    echo "$(timestamp) [BOOT][ERROR] Backend no disponible en $BACKEND_READY_URL tras ${READY_TIMEOUT_SECONDS}s" >> "$LOG_FILE"
    exit 1
  fi
  echo "$(timestamp) [BOOT] Esperando backend en $BACKEND_READY_URL (${ELAPSED}s)" >> "$LOG_FILE"
  sleep 5
done

echo "$(timestamp) [BOOT] Backend disponible en $BACKEND_READY_URL" >> "$LOG_FILE"

if [[ "${ENABLE_LEGACY_CAPTURE:-false}" =~ ^(1|true|TRUE|yes|YES|on|ON|si|SI)$ ]]; then
  /bin/bash /app/run_capture_loop.sh &
fi

echo "$(timestamp) [BOOT] Iniciando loop de polling. Intervalo=${INTERVAL}s" >> "$LOG_FILE"

while true; do
  /bin/bash /app/poll_sismico.sh || echo "$(timestamp) [ERROR] poll_sismico.sh devolvió código $?" >> "$LOG_FILE"
  sleep "$INTERVAL"
done
