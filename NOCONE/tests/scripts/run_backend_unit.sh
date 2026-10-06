#!/usr/bin/env bash
set -euo pipefail
source tests/scripts/common.sh
LOG="$LOG_DIR/backend_unit.log"
JUNIT="$ARTIFACT_DIR/backend_unit.junit.xml"

{
  echo "=== BACKEND UNIT START $(timestamp_utc) ==="
  python -m compileall -q backend
  python tests/scripts/validate_backend_imports.py
  ruff check backend/app backend/tests
  pytest backend/tests/unit -q --junitxml="$JUNIT"
  echo "=== BACKEND UNIT END $(timestamp_utc) ==="
} 2>&1 | tee "$LOG"

finalize_from_junit "backend_unit" "$JUNIT"
