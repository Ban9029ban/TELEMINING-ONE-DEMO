#!/bin/sh
set -eu

mkdir -p /workspace/logs/tests /workspace/artifacts/test-results
LOG=/workspace/logs/tests/backend_security.log
BANDIT_JSON=/workspace/artifacts/test-results/backend-bandit.json
PIP_AUDIT_JSON=/workspace/artifacts/test-results/backend-pip-audit.json

{
  echo '{"suite":"backend_security","event":"start","ts":"'"$(date -Iseconds)"'"}'
  cd /workspace/backend
  export PYTHONPATH=/workspace/backend

  bandit -r app -f json -o "$BANDIT_JSON"
  pip-audit -r requirements.txt -f json > "$PIP_AUDIT_JSON"

  echo '{"suite":"backend_security","event":"finish","status":"passed","ts":"'"$(date -Iseconds)"'"}'
} 2>&1 | tee "$LOG"
