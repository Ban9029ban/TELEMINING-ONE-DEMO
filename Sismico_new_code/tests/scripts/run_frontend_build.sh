#!/bin/sh
set -eu

mkdir -p /workspace/logs/tests /workspace/artifacts/test-results
LOG=/workspace/logs/tests/frontend_build.log

{
  echo '{"suite":"frontend_build","event":"start","ts":"'"$(date -Iseconds)"'"}'
  cd /workspace/frontend
  npm install
  npm run build
  echo '{"suite":"frontend_build","event":"finish","status":"passed","ts":"'"$(date -Iseconds)"'"}'
} 2>&1 | tee "$LOG"
