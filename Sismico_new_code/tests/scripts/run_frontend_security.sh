#!/bin/sh
set -eu

mkdir -p /workspace/logs/tests /workspace/artifacts/test-results
LOG=/workspace/logs/tests/frontend_security.log
NPM_AUDIT_JSON=/workspace/artifacts/test-results/frontend-npm-audit.json

{
  echo '{"suite":"frontend_security","event":"start","ts":"'"$(date -Iseconds)"'"}'
  cd /workspace/frontend
  npm audit --json > "$NPM_AUDIT_JSON" || true
  echo '{"suite":"frontend_security","event":"finish","status":"completed","ts":"'"$(date -Iseconds)"'"}'
} 2>&1 | tee "$LOG"
