#!/usr/bin/env bash
set -euo pipefail
source tests/scripts/common.sh
LOG="$LOG_DIR/backend_integration.log"
JUNIT="$ARTIFACT_DIR/backend_integration.junit.xml"

{
  echo "=== BACKEND INTEGRATION START $(timestamp_utc) ==="
  pytest backend/tests/integration -q --junitxml="$JUNIT"
  echo "=== BACKEND INTEGRATION END $(timestamp_utc) ==="
} 2>&1 | tee "$LOG"

finalize_from_junit "backend_integration" "$JUNIT"
