#!/bin/bash
set -u
CAPTURE_ENABLED="${ENABLE_LEGACY_CAPTURE:-false}"
LOG_FILE="${LEGACY_CAPTURE_SUMMARY_LOG:-/logs/legacy_capture.log}"
STARTUP_DELAY="${LEGACY_CAPTURE_STARTUP_DELAY_SECONDS:-20}"
BACKEND_READY_URL="${BACKEND_READY_URL:-${BACKEND_BASE_URL:-http://backend:8000}/health}"
READY_TIMEOUT_SECONDS="${BACKEND_READY_TIMEOUT_SECONDS:-180}"

timestamp() { date +"%Y-%m-%d %H:%M:%S"; }
mkdir -p "$(dirname "$LOG_FILE")"

if [[ ! "$CAPTURE_ENABLED" =~ ^(1|true|TRUE|yes|YES|on|ON|si|SI)$ ]]; then
  echo "$(timestamp) [CAPTURE] disabled by ENABLE_LEGACY_CAPTURE=$CAPTURE_ENABLED" >> "$LOG_FILE"
  exit 0
fi

echo "$(timestamp) [CAPTURE] waiting ${STARTUP_DELAY}s before starting capture loop" >> "$LOG_FILE"
sleep "$STARTUP_DELAY"

READY_STARTED_AT="$(date +%s)"
until curl -fsS "$BACKEND_READY_URL" >/dev/null 2>&1; do
  NOW="$(date +%s)"
  ELAPSED=$((NOW - READY_STARTED_AT))
  if [ "$ELAPSED" -ge "$READY_TIMEOUT_SECONDS" ]; then
    echo "$(timestamp) [CAPTURE][ERROR] backend no disponible en $BACKEND_READY_URL tras ${READY_TIMEOUT_SECONDS}s" >> "$LOG_FILE"
    exit 1
  fi
  echo "$(timestamp) [CAPTURE] esperando backend en $BACKEND_READY_URL (${ELAPSED}s)" >> "$LOG_FILE"
  sleep 5
done

echo "$(timestamp) [CAPTURE] starting capture loop" >> "$LOG_FILE"
exec /bin/bash /app/capture_legacy_sources.sh
