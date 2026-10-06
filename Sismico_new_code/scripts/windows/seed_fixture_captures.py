#!/usr/bin/env python3
from __future__ import annotations

import base64
import json
import mimetypes
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib import request

BACKEND = os.getenv("BACKEND_BASE_URL", "http://127.0.0.1:18000")
ENDPOINTS_URL = f"{BACKEND}/api/sismico/capture/endpoints"
STORE_URL = f"{BACKEND}/api/sismico/capture/store"
FIXTURE_ROOT = Path(os.getenv("LEGACY_FIXTURE_DIR", "./fixtures/legacy"))
TIMEOUT = int(os.getenv("SEED_FIXTURE_TIMEOUT", "20"))


def read_json(url: str):
    with request.urlopen(url, timeout=TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def post_json(url: str, payload: dict):
    data = json.dumps(payload).encode("utf-8")
    req = request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    with request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def candidates(site_code: str, endpoint_code: str):
    return [
        FIXTURE_ROOT / site_code / f"{endpoint_code}.html",
        FIXTURE_ROOT / site_code / f"{endpoint_code}.json",
        FIXTURE_ROOT / f"{endpoint_code}.html",
        FIXTURE_ROOT / f"{endpoint_code}.json",
    ]


def main() -> int:
    endpoints = read_json(ENDPOINTS_URL)
    batch_id = datetime.now(timezone.utc).strftime("fixture-seed-%Y%m%dT%H%M%SZ")
    inserted = 0
    skipped = 0

    for item in endpoints:
        site_code = str(item.get("site_code") or "").strip()
        endpoint_code = str(item.get("endpoint_code") or "").strip()
        match = next((p for p in candidates(site_code, endpoint_code) if p.exists()), None)
        if match is None:
            skipped += 1
            continue
        raw = match.read_bytes()
        content_type = mimetypes.guess_type(match.name)[0] or "text/html; charset=utf-8"
        is_binary = not any(token in content_type.lower() for token in ("json", "html", "text", "xml", "javascript"))
        payload = {
            "batch_id": batch_id,
            "site_id": item.get("site_id"),
            "remote_source_id": item.get("remote_source_id"),
            "remote_endpoint_id": item.get("endpoint_id"),
            "site_code": item.get("site_code"),
            "source_code": item.get("source_code"),
            "endpoint_code": endpoint_code,
            "endpoint_name": item.get("endpoint_name"),
            "endpoint_url": item.get("endpoint_url"),
            "parser_type": item.get("parser_type"),
            "endpoint_kind": item.get("endpoint_kind"),
            "content_type": content_type,
            "http_status": 200,
            "ok": True,
            "is_binary": is_binary,
            "body_text": None if is_binary else raw.decode("utf-8", errors="replace"),
            "body_base64": base64.b64encode(raw).decode("ascii") if is_binary else None,
            "request_duration_ms": 1,
            "source_origin": "fixture",
            "extra_json": {"fixture_path": str(match)},
            "observed_at": datetime.now(timezone.utc).isoformat(),
        }
        post_json(STORE_URL, payload)
        inserted += 1
        print(f"[OK] {site_code} {endpoint_code} <= {match}")

    print(json.dumps({"batch_id": batch_id, "inserted": inserted, "skipped": skipped}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
