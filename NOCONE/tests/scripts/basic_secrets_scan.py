import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "artifacts/test-results/basic_secrets_scan.json")
OUT.parent.mkdir(parents=True, exist_ok=True)

patterns = {
    "private_key": re.compile(r"-----BEGIN (?:RSA|EC|DSA|OPENSSH|PRIVATE) KEY-----"),
    "generic_secret": re.compile(r"(?i)(secret|token|apikey|api_key|password)\s*[:=]\s*['\"][^'\"]{8,}['\"]"),
}

ignore_parts = {
    ".git", ".venv", "node_modules", "__pycache__", "build", "dist",
    "modelos", "firmware_arduino", "ollama", "package-lock.json"
}

findings = []
for path in ROOT.rglob("*"):
    if not path.is_file():
        continue
    if any(part in ignore_parts for part in path.parts):
        continue
    try:
        content = path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        continue
    for rule_name, pattern in patterns.items():
        for match in pattern.finditer(content):
            findings.append({
                "rule": rule_name,
                "file": str(path.relative_to(ROOT)),
                "match_preview": match.group(0)[:120],
            })

OUT.write_text(json.dumps({
    "root": str(ROOT),
    "total_findings": len(findings),
    "findings": findings,
}, indent=2), encoding="utf-8")

print(json.dumps({"output": str(OUT), "total_findings": len(findings)}))
if findings:
    raise SystemExit(1)
