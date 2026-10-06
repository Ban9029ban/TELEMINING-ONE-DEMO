#!/bin/sh
set -eu

mkdir -p /workspace/logs/tests /workspace/artifacts/test-results
LOG=/workspace/logs/tests/backend_unit.log
XML=/workspace/artifacts/test-results/backend-unit-junit.xml
RUFF_LOG=/workspace/artifacts/test-results/backend-unit-ruff.txt

{
  echo '{"suite":"backend_unit","event":"start","ts":"'"$(date -Iseconds)"'"}'
  cd /workspace/backend
  export PYTHONPATH=/workspace/backend

  python -m compileall app
  pytest -q tests --junitxml="$XML"
  ruff check app tests | tee "$RUFF_LOG"

  echo '{"suite":"backend_unit","event":"finish","status":"passed","ts":"'"$(date -Iseconds)"'"}'
} 2>&1 | tee "$LOG"
