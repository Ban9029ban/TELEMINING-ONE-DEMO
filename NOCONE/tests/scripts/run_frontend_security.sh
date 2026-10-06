#!/usr/bin/env bash
set -euo pipefail

source tests/scripts/common.sh

LOG="$LOG_DIR/frontend_security.log"

{
  echo "=== FRONTEND SECURITY START $(timestamp_utc) ==="
  bash tests/scripts/frontend_prepare.sh
  cd web_front

  set +e
  npm audit --json > "../$ARTIFACT_DIR/frontend_npm_audit.json"
  AUDIT_RC=$?
  set -e

  echo "AUDIT_RC=$AUDIT_RC"

  if [ "$AUDIT_RC" -ne 0 ]; then
    write_status_json "frontend_security" "failed" 1 0 1
    exit 1
  fi

  write_status_json "frontend_security" "passed" 1 1 0
  echo "=== FRONTEND SECURITY END $(timestamp_utc) ==="
} 2>&1 | tee "$LOG"
