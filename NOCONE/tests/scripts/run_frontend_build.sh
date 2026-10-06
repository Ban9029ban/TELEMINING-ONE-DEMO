#!/usr/bin/env bash
set -euo pipefail

source tests/scripts/common.sh

LOG="$LOG_DIR/frontend_build.log"

{
  echo "=== FRONTEND BUILD START $(timestamp_utc) ==="
  bash tests/scripts/frontend_prepare.sh
  cd web_front
  rm -rf build
  npm run build
  test -f build/index.html
  write_status_json "frontend_build" "passed" 2 2 0
  echo "=== FRONTEND BUILD END $(timestamp_utc) ==="
} 2>&1 | tee "$LOG"
