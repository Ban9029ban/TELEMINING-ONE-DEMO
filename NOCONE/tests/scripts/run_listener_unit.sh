#!/usr/bin/env bash
set -euo pipefail
source tests/scripts/common.sh
LOG="$LOG_DIR/listener_unit.log"
JUNIT="$ARTIFACT_DIR/listener_unit.junit.xml"

{
  echo "=== LISTENER UNIT START $(timestamp_utc) ==="
  python -m compileall -q listener
  python tests/scripts/validate_listener_imports.py
  ruff check listener/app listener/tests
  pytest listener/tests -q --junitxml="$JUNIT"
  echo "=== LISTENER UNIT END $(timestamp_utc) ==="
} 2>&1 | tee "$LOG"

finalize_from_junit "listener_unit" "$JUNIT"
