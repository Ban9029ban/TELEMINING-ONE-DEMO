#!/usr/bin/env bash
set -euo pipefail

LOG_DIR="logs/tests"
ARTIFACT_DIR="artifacts/test-results"

mkdir -p "$LOG_DIR" "$ARTIFACT_DIR"

timestamp_utc() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

write_status_json() {
  local suite="$1"
  local status="$2"
  local total="${3:-0}"
  local passed="${4:-0}"
  local failed="${5:-0}"

  mkdir -p "$ARTIFACT_DIR"

  cat > "${ARTIFACT_DIR}/${suite}.status.json" <<EOF
{
  "suite": "${suite}",
  "status": "${status}",
  "total": ${total},
  "passed": ${passed},
  "failed": ${failed},
  "timestamp": "$(timestamp_utc)"
}
EOF
}
