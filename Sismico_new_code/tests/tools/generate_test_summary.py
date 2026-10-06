from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path("/workspace")
ART = ROOT / "artifacts" / "test-results"
LOGS = ROOT / "logs" / "tests"
ART.mkdir(parents=True, exist_ok=True)
LOGS.mkdir(parents=True, exist_ok=True)

def load_json(path: Path):
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None

def parse_junit(path: Path):
    if not path.exists():
        return {"tests": 0, "failures": 0, "errors": 0, "skipped": 0, "status": "missing"}
    root = ET.parse(path).getroot()
    tests = int(root.attrib.get("tests", 0))
    failures = int(root.attrib.get("failures", 0))
    errors = int(root.attrib.get("errors", 0))
    skipped = int(root.attrib.get("skipped", 0))
    status = "passed" if failures == 0 and errors == 0 else "failed"
    return {"tests": tests, "failures": failures, "errors": errors, "skipped": skipped, "status": status}

def summarize_bandit(path: Path):
    data = load_json(path)
    if not data:
        return {"status": "missing", "issues_total": 0, "high": 0, "medium": 0, "low": 0}
    results = data.get("results", [])
    high = sum(1 for r in results if str(r.get("issue_severity", "")).upper() == "HIGH")
    medium = sum(1 for r in results if str(r.get("issue_severity", "")).upper() == "MEDIUM")
    low = sum(1 for r in results if str(r.get("issue_severity", "")).upper() == "LOW")
    status = "passed" if not results else "failed"
    return {"status": status, "issues_total": len(results), "high": high, "medium": medium, "low": low}

def summarize_pip_audit(path: Path):
    data = load_json(path)
    if not data:
        return {"status": "missing", "dependency_issues": 0}
    deps = data.get("dependencies", [])
    vulns = sum(len(dep.get("vulns", [])) for dep in deps)
    status = "passed" if vulns == 0 else "failed"
    return {"status": status, "dependency_issues": vulns}

def summarize_npm_audit(path: Path):
    data = load_json(path)
    if not data:
        return {"status": "missing", "vulnerabilities_total": 0}
    meta = data.get("metadata", {}).get("vulnerabilities", {})
    total = sum(v for _, v in meta.items() if isinstance(v, int))
    status = "passed" if total == 0 else "failed"
    return {"status": status, "vulnerabilities_total": total, "by_level": meta}

def log_exists(name: str):
    return (LOGS / name).exists()

summary = {"generated_at": datetime.now(timezone.utc).isoformat(), "suites": []}

backend_unit = parse_junit(ART / "backend-unit-junit.xml")
summary["suites"].append({"name": "backend_unit", **backend_unit, "log": "logs/tests/backend_unit.log"})

bandit_summary = summarize_bandit(ART / "backend-bandit.json")
pip_summary = summarize_pip_audit(ART / "backend-pip-audit.json")
backend_security_status = "passed" if bandit_summary["status"] == "passed" and pip_summary["status"] == "passed" else ("missing" if bandit_summary["status"] == "missing" and pip_summary["status"] == "missing" else "failed")
summary["suites"].append({
    "name": "backend_security",
    "status": backend_security_status,
    "bandit": bandit_summary,
    "pip_audit": pip_summary,
    "log": "logs/tests/backend_security.log",
})

frontend_build_status = "passed" if log_exists("frontend_build.log") else "missing"
summary["suites"].append({
    "name": "frontend_build",
    "status": frontend_build_status,
    "tests": 1 if frontend_build_status == "passed" else 0,
    "log": "logs/tests/frontend_build.log",
})

frontend_security = summarize_npm_audit(ART / "frontend-npm-audit.json")
summary["suites"].append({
    "name": "frontend_security",
    **frontend_security,
    "log": "logs/tests/frontend_security.log",
})

smoke_json = load_json(ART / "smoke.json")
summary["suites"].append({
    "name": "smoke",
    "status": "passed" if smoke_json else "missing",
    "checks": smoke_json.get("checks", 0) if smoke_json else 0,
    "log": "logs/tests/smoke.log",
})

total_tests = 0
failed_or_missing_suites = 0
for suite in summary["suites"]:
    total_tests += int(suite.get("tests", 0)) + int(suite.get("checks", 0))
    if suite.get("status") in ("failed", "missing"):
        failed_or_missing_suites += 1

summary["total_suites"] = len(summary["suites"])
summary["total_tests"] = total_tests
summary["failed_or_missing_suites"] = failed_or_missing_suites
summary["passed_suites"] = summary["total_suites"] - failed_or_missing_suites
summary["status"] = "passed" if failed_or_missing_suites == 0 else "failed"

out = ART / "summary.json"
out.write_text(json.dumps(summary, indent=2), encoding="utf-8")
print(json.dumps(summary, indent=2))
