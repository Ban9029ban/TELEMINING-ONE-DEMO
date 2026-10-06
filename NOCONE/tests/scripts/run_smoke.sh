#!/usr/bin/env bash
set -euo pipefail
source tests/scripts/common.sh
LOG="$LOG_DIR/smoke.log"

{
  echo "=== SMOKE START $(timestamp_utc) ==="
  python tests/scripts/smoke_http.py
  write_status_json "smoke" "passed" 3 3 0
  echo "=== SMOKE END $(timestamp_utc) ==="
} 2>&1 | tee "$LOG"
