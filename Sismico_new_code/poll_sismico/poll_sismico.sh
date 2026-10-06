#!/bin/bash

API_URL="${API_URL:-http://backend:8000/api/sismico/polling/run}"
LOG_FILE="${LOG_FILE:-/logs/poll_sismico.log}"
SITES_STRING="${SITES:-diamante andesita andes_norte andes_norte_tunel_correa pilar_norte esmeralda}"

timestamp() {
  date +"%Y-%m-%d %H:%M:%S"
}

echo "==================================================" >> "$LOG_FILE"
echo "$(timestamp) [INFO] Inicio polling sismico" >> "$LOG_FILE"
echo "$(timestamp) [INFO] API_URL=$API_URL" >> "$LOG_FILE"
echo "$(timestamp) [INFO] SITES=$SITES_STRING" >> "$LOG_FILE"

EXIT_CODE=0

for SITE in $SITES_STRING
do
  echo "$(timestamp) [INFO] Polling sitio=$SITE" >> "$LOG_FILE"

  RESPONSE=$(curl -s -w " HTTP_STATUS:%{http_code}" -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -d "{\"site_code\":\"$SITE\"}")

  BODY=$(echo "$RESPONSE" | sed -e 's/ HTTP_STATUS:.*//g')
  STATUS=$(echo "$RESPONSE" | tr -d '\n' | sed -e 's/.*HTTP_STATUS://')

  if [ "$STATUS" = "200" ]; then
    PARSED=$(BODY_PAYLOAD="$BODY" python3 - <<'PY'
import json
import os

body = os.environ.get("BODY_PAYLOAD", "")
try:
    data = json.loads(body)
except Exception as exc:
    print(f"invalid|||{exc}")
else:
    ok = data.get("ok")
    source_status = data.get("source_status") or data.get("status") or ""
    processed = data.get("processed_objects")
    error_message = data.get("error_message") or data.get("message") or ""
    print(f"{str(ok).lower()}|{source_status}|{processed}|{error_message}")
PY
)
    RESULT_OK=$(echo "$PARSED" | cut -d'|' -f1)
    RESULT_SOURCE=$(echo "$PARSED" | cut -d'|' -f2)
    RESULT_PROCESSED=$(echo "$PARSED" | cut -d'|' -f3)
    RESULT_ERROR=$(echo "$PARSED" | cut -d'|' -f4-)

    if [ "$RESULT_OK" = "true" ]; then
      echo "$(timestamp) [OK] sitio=$SITE status=$STATUS source_status=$RESULT_SOURCE processed=$RESULT_PROCESSED body=$BODY" >> "$LOG_FILE"
    else
      echo "$(timestamp) [ERROR] sitio=$SITE status=$STATUS source_status=$RESULT_SOURCE processed=$RESULT_PROCESSED error=$RESULT_ERROR body=$BODY" >> "$LOG_FILE"
      EXIT_CODE=1
    fi
  else
    echo "$(timestamp) [ERROR] sitio=$SITE status=$STATUS body=$BODY" >> "$LOG_FILE"
    EXIT_CODE=1
  fi
done

echo "$(timestamp) [INFO] Fin polling sismico" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

exit "$EXIT_CODE"
