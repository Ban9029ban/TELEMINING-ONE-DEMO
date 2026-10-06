import json
from pathlib import Path
from datetime import datetime, timezone

artifact_dir = Path("artifacts/test-results")
status_files = sorted(artifact_dir.glob("*.status.json"))

summary = {
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "suite_count": 0,
    "test_count": 0,
    "passed_count": 0,
    "failed_count": 0,
    "status": "passed",
    "suites": [],
}

for path in status_files:
    payload = json.loads(path.read_text(encoding="utf-8"))
    summary["suites"].append(payload)
    summary["suite_count"] += 1
    summary["test_count"] += int(payload.get("tests", 0))
    summary["passed_count"] += int(payload.get("passed", 0))
    summary["failed_count"] += int(payload.get("failed", 0))
    if payload.get("status") != "passed":
        summary["status"] = "failed"

out = artifact_dir / "summary.json"
out.write_text(json.dumps(summary, indent=2), encoding="utf-8")
print(json.dumps(summary, indent=2))
