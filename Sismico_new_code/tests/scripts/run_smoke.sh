#!/bin/sh
set -eu

mkdir -p /workspace/logs/tests /workspace/artifacts/test-results
LOG=/workspace/logs/tests/smoke.log
REPORT=/workspace/artifacts/test-results/smoke.json

check() {
  NAME="$1"
  URL="$2"
  TMP_BODY="$(mktemp)"
  TMP_HDR="$(mktemp)"

  STATUS="$(curl -sS -o "$TMP_BODY" -D "$TMP_HDR" -w "%{http_code}" "$URL")"
  BODY_SIZE="$(wc -c < "$TMP_BODY" | tr -d ' ')"

  echo "==> $NAME"
  echo "URL: $URL"
  echo "HTTP: $STATUS"
  echo "BYTES: $BODY_SIZE"
  head -c 300 "$TMP_BODY" || true
  echo
  echo "----"

  if [ "$STATUS" -lt 200 ] || [ "$STATUS" -ge 300 ]; then
    echo "Smoke check failed for $NAME: HTTP $STATUS" >&2
    exit 1
  fi

  if [ "$BODY_SIZE" -eq 0 ]; then
    echo "Smoke check failed for $NAME: empty body" >&2
    exit 1
  fi

  rm -f "$TMP_BODY" "$TMP_HDR"
}

{
  echo '{"suite":"smoke","event":"start","ts":"'"$(date -Iseconds)'"}'

  check "health" "http://backend:8000/health"
  check "config public" "http://backend:8000/api/config/public"
  check "sismico health" "http://backend:8000/api/sismico/health"
  check "sismico sites" "http://backend:8000/api/sismico/sites"
  check "sismico state diamante" "http://backend:8000/api/sismico/sites/diamante/state"
  check "polling sources" "http://backend:8000/api/polling/sources"
  check "config users" "http://backend:8000/api/config/users"
  check "config companies" "http://backend:8000/api/config/companies"
  check "config system" "http://backend:8000/api/config/system"
  check "config screens" "http://backend:8000/api/config/screens"
  check "config polygon-sites" "http://backend:8000/api/config/polygon-sites"
  check "screens emergency" "http://backend:8000/api/screens/emergency"
  check "capture endpoints" "http://backend:8000/api/sismico/capture/endpoints"
  check "capture captures list" "http://backend:8000/api/sismico/capture/captures?limit=1"
  check "semaforo emulator" "http://semaforo_emulator_api:8000/api/emulator/semaforo/state"

  echo '{"suite":"smoke","event":"finish","status":"passed","ts":"'"$(date -Iseconds)'"}'
  printf '{"suite":"smoke","status":"passed","checks":15}\n' > "$REPORT"
} 2>&1 | tee "$LOG"
