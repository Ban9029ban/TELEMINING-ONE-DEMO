#!/usr/bin/env bash
set -euo pipefail
source tests/scripts/common.sh
LOG="$LOG_DIR/test_summary.log"

{
  echo "=== SUMMARY START $(timestamp_utc) ==="
  python tests/scripts/generate_summary.py
  echo "=== SUMMARY END $(timestamp_utc) ==="
} 2>&1 | tee "$LOG"
