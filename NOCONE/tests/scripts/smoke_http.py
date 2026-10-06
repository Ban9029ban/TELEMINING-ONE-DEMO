import json
import os
import sys
import urllib.request

targets = {
    "backend_health": os.getenv("BACKEND_HEALTH_URL", "http://test_backend_app:8000/api/health"),
    "listener_health": os.getenv("LISTENER_HEALTH_URL", "http://test_listener_app:8080/health"),
    "frontend_root": os.getenv("FRONTEND_ROOT_URL", "http://test_frontend_app:3000"),
}
results = []
failed = False
for name, url in targets.items():
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            body = resp.read(512).decode("utf-8", errors="ignore")
            ok = 200 <= resp.status < 400
            results.append({"name": name, "url": url, "status_code": resp.status, "ok": ok, "body_preview": body[:120]})
            if not ok:
                failed = True
    except Exception as exc:
        results.append({"name": name, "url": url, "ok": False, "error": str(exc)})
        failed = True

out = os.getenv("SMOKE_JSON_OUT", "artifacts/test-results/smoke_http.json")
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w", encoding="utf-8") as fh:
    json.dump({"results": results, "failed": failed}, fh, indent=2)
print(json.dumps(results, indent=2))
if failed:
    raise SystemExit(1)
