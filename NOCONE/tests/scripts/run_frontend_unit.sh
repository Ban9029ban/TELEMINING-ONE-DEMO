#!/usr/bin/env bash
set -euo pipefail

source tests/scripts/common.sh

LOG="$LOG_DIR/frontend_unit.log"
JUNIT="$ARTIFACT_DIR/frontend_unit.junit.xml"

{
  echo "=== FRONTEND UNIT START $(timestamp_utc) ==="
  bash tests/scripts/frontend_prepare.sh
  cd web_front
  CI=true JEST_JUNIT_OUTPUT="../$JUNIT" npm test -- --watch=false --ci --reporters=default --reporters=jest-junit --runInBand
  echo "=== FRONTEND UNIT END $(timestamp_utc) ==="
} 2>&1 | tee "$LOG"

python3 - "$JUNIT" "$ARTIFACT_DIR/frontend_unit.status.json" <<'PY'
import sys, json, xml.etree.ElementTree as ET
junit = sys.argv[1]
status_file = sys.argv[2]

tree = ET.parse(junit)
root = tree.getroot()

tests = int(root.attrib.get("tests", 0))
failures = int(root.attrib.get("failures", 0))
errors = int(root.attrib.get("errors", 0))
skipped = int(root.attrib.get("skipped", 0))
failed = failures + errors
passed = max(tests - failed - skipped, 0)
status = "passed" if failed == 0 else "failed"

with open(status_file, "w", encoding="utf-8") as f:
    json.dump({
        "suite": "frontend_unit",
        "status": status,
        "total": tests,
        "passed": passed,
        "failed": failed
    }, f, indent=2)
PY
