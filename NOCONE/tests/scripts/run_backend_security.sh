#!/usr/bin/env bash
set -euo pipefail
source tests/scripts/common.sh
LOG="$LOG_DIR/backend_security.log"

{
  echo "=== BACKEND SECURITY START $(timestamp_utc) ==="
  set +e
  bandit -r backend/app -f json -o "$ARTIFACT_DIR/backend_bandit.json"
  BANDIT_RC=$?
  pip-audit -r backend/requirements.txt --format=json > "$ARTIFACT_DIR/backend_pip_audit.json"
  PIP_AUDIT_RC=$?
  python tests/scripts/basic_secrets_scan.py backend "$ARTIFACT_DIR/backend_secrets_scan.json"
  SECRET_RC=$?
  set -e
  echo "BANDIT_RC=$BANDIT_RC"
  echo "PIP_AUDIT_RC=$PIP_AUDIT_RC"
  echo "SECRET_RC=$SECRET_RC"
  if [ "$BANDIT_RC" -ne 0 ] || [ "$PIP_AUDIT_RC" -ne 0 ] || [ "$SECRET_RC" -ne 0 ]; then
    write_status_json "backend_security" "failed" 3 0 3
    exit 1
  fi
  write_status_json "backend_security" "passed" 3 3 0
  echo "=== BACKEND SECURITY END $(timestamp_utc) ==="
} 2>&1 | tee "$LOG"
