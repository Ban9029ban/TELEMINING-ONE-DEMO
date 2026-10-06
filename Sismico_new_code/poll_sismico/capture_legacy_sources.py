#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

import requests

API_BASE = os.getenv('BACKEND_BASE_URL', 'http://backend:8000')
ENDPOINTS_URL = os.getenv('CAPTURE_ENDPOINTS_URL', f"{API_BASE}/api/sismico/capture/endpoints")
STORE_URL = os.getenv('CAPTURE_STORE_URL', f"{API_BASE}/api/sismico/capture/store")
LOG_ROOT = Path(os.getenv('CAPTURE_LOG_DIR', '/logs/legacy_capture'))
LOOP_SECONDS = int(os.getenv('LEGACY_CAPTURE_INTERVAL_SECONDS', '30'))
DURATION_MINUTES = int(os.getenv('LEGACY_CAPTURE_DURATION_MINUTES', '120'))
FETCH_LINKED_IMAGES = str(os.getenv('LEGACY_CAPTURE_FETCH_LINKED_IMAGES', 'true')).strip().lower() in {'1', 'true', 'yes', 'on', 'si'}
SUMMARY_LOG = Path(os.getenv('LEGACY_CAPTURE_SUMMARY_LOG', '/logs/legacy_capture.log'))
ONLY_SITE_CODES = {s.strip() for s in os.getenv('LEGACY_CAPTURE_SITES', '').split(',') if s.strip()}
TIMEOUT = int(os.getenv('LEGACY_CAPTURE_REQUEST_TIMEOUT', '25'))
IMG_RE = re.compile(r"<img[^>]+src=['\"]([^'\"]+)['\"]", re.I)


def ts() -> str:
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')


def slug(value: str) -> str:
    return re.sub(r'[^a-zA-Z0-9._-]+', '_', value or 'unknown').strip('_') or 'unknown'


def log(message: str) -> None:
    SUMMARY_LOG.parent.mkdir(parents=True, exist_ok=True)
    with SUMMARY_LOG.open('a', encoding='utf-8') as fh:
        fh.write(f"{ts()} {message}\n")


def write_raw(batch_id: str, endpoint_code: str, content_type: str, body: bytes) -> Path:
    folder = LOG_ROOT / batch_id
    folder.mkdir(parents=True, exist_ok=True)
    ext = '.txt'
    lower = (content_type or '').lower()
    if 'json' in lower:
        ext = '.json'
    elif 'html' in lower:
        ext = '.html'
    elif 'png' in lower:
        ext = '.png'
    elif 'jpeg' in lower or 'jpg' in lower:
        ext = '.jpg'
    name = f"{slug(endpoint_code)}{ext}"
    path = folder / name
    path.write_bytes(body)
    return path


def _store_payload(session: requests.Session, payload: dict) -> int:
    response = session.post(STORE_URL, json=payload, timeout=TIMEOUT)
    response.raise_for_status()
    return response.status_code


def _fixture_candidates(item: dict) -> list[Path]:
    root = Path(os.getenv('LEGACY_FIXTURE_DIR', '/app/fixtures/legacy'))
    site_code = slug(item.get('site_code') or '')
    endpoint_code = slug(item.get('endpoint_code') or '')
    return [
        root / site_code / f'{endpoint_code}.html',
        root / site_code / f'{endpoint_code}.json',
        root / f'{endpoint_code}.html',
        root / f'{endpoint_code}.json',
    ]


def _load_fixture_bytes(item: dict) -> tuple[bytes, str, str] | None:
    for candidate in _fixture_candidates(item):
        if candidate.exists():
            body = candidate.read_bytes()
            suffix = candidate.suffix.lower()
            content_type = 'application/json; charset=utf-8' if suffix == '.json' else 'text/html; charset=utf-8'
            return body, content_type, str(candidate)
    return None


def fetch_and_store(
    session: requests.Session,
    batch_id: str,
    item: dict,
    endpoint_url: str,
    *,
    source_origin: str = 'external',
    derived_from_url: str | None = None,
    endpoint_code_suffix: str = '',
) -> None:
    started = time.time()
    observed_at = datetime.now(timezone.utc).isoformat()
    endpoint_code = f"{item.get('endpoint_code')}{endpoint_code_suffix}"
    fixture_path = None
    effective_origin = source_origin

    try:
        response = session.get(endpoint_url, timeout=TIMEOUT, verify=False)
        ok = response.ok
        body = response.content or b''
        content_type = response.headers.get('Content-Type', 'application/octet-stream')
        status_code = response.status_code
        headers = dict(response.headers)
    except Exception as exc:
        fixture = _load_fixture_bytes(item)
        if fixture is None:
            log(f"[CAPTURE][ERROR] endpoint={endpoint_code} url={endpoint_url} error={exc}")
            payload = {
                'batch_id': batch_id,
                'site_id': item.get('site_id'),
                'remote_source_id': item.get('remote_source_id'),
                'remote_endpoint_id': item.get('endpoint_id'),
                'site_code': item.get('site_code'),
                'source_code': item.get('source_code'),
                'endpoint_code': endpoint_code,
                'endpoint_name': item.get('endpoint_name'),
                'endpoint_url': endpoint_url,
                'parser_type': item.get('parser_type'),
                'endpoint_kind': item.get('endpoint_kind'),
                'content_type': 'text/plain; charset=utf-8',
                'http_status': 0,
                'ok': False,
                'is_binary': False,
                'body_text': str(exc),
                'request_duration_ms': int((time.time() - started) * 1000),
                'source_origin': source_origin,
                'derived_from_url': derived_from_url,
                'extra_json': {'error': str(exc)},
                'observed_at': observed_at,
            }
            try:
                _store_payload(session, payload)
            except Exception:
                pass
            return

        body, content_type, fixture_path = fixture
        ok = True
        status_code = 200
        headers = {'X-Source': 'fixture'}
        effective_origin = 'fixture'

    try:
        is_binary = not any(token in content_type.lower() for token in ('json', 'html', 'text', 'xml', 'javascript'))
        raw_path = write_raw(batch_id, endpoint_code, content_type, body)
        payload = {
            'batch_id': batch_id,
            'site_id': item.get('site_id'),
            'remote_source_id': item.get('remote_source_id'),
            'remote_endpoint_id': item.get('endpoint_id'),
            'site_code': item.get('site_code'),
            'source_code': item.get('source_code'),
            'endpoint_code': endpoint_code,
            'endpoint_name': item.get('endpoint_name'),
            'endpoint_url': endpoint_url,
            'parser_type': item.get('parser_type'),
            'endpoint_kind': item.get('endpoint_kind'),
            'content_type': content_type,
            'http_status': status_code,
            'ok': ok,
            'is_binary': is_binary,
            'body_text': None if is_binary else body.decode('utf-8', errors='replace'),
            'body_base64': base64.b64encode(body).decode('ascii') if is_binary else None,
            'request_duration_ms': int((time.time() - started) * 1000),
            'source_origin': effective_origin,
            'derived_from_url': derived_from_url,
            'extra_json': {'headers': headers, 'log_file': str(raw_path), 'fixture_path': fixture_path},
            'observed_at': observed_at,
        }
        store_status = _store_payload(session, payload)
        log(
            f"[CAPTURE] ok={ok} status={status_code} endpoint={endpoint_code} "
            f"origin={effective_origin} bytes={len(body)} store_status={store_status} sha256={hashlib.sha256(body).hexdigest()}"
        )

        if FETCH_LINKED_IMAGES and 'html' in content_type.lower() and effective_origin == 'external':
            text = body.decode('utf-8', errors='replace')
            seen: set[str] = set()
            for idx, src in enumerate(IMG_RE.findall(text), start=1):
                full = urljoin(endpoint_url, src)
                if full in seen:
                    continue
                seen.add(full)
                if not any(token in full.lower() for token in ('estado', '.png', '.jpg', '.jpeg', '.gif')):
                    continue
                fetch_and_store(
                    session,
                    batch_id,
                    item,
                    full,
                    source_origin='linked_asset',
                    derived_from_url=endpoint_url,
                    endpoint_code_suffix=f'__asset_{idx}',
                )
    except Exception as exc:
        log(f"[CAPTURE][ERROR] endpoint={endpoint_code} url={endpoint_url} error={exc}")


def main() -> int:
    deadline = time.time() + (DURATION_MINUTES * 60)
    LOG_ROOT.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    log(f"[BOOT] legacy capture start duration={DURATION_MINUTES}m interval={LOOP_SECONDS}s endpoints_url={ENDPOINTS_URL}")
    while time.time() < deadline:
        batch_id = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        try:
            response = session.get(ENDPOINTS_URL, timeout=TIMEOUT)
            response.raise_for_status()
            endpoints = response.json()
        except Exception as exc:
            log(f"[ERROR] no se pudo obtener inventario de endpoints: {exc}")
            time.sleep(LOOP_SECONDS)
            continue

        filtered = [item for item in endpoints if not ONLY_SITE_CODES or item.get('site_code') in ONLY_SITE_CODES]
        log(f"[BATCH] id={batch_id} endpoints={len(filtered)}")
        if not filtered:
            log("[WARN] no hay endpoints externos habilitados publicados por backend")
            time.sleep(LOOP_SECONDS)
            continue
        for item in filtered:
            endpoint_url = item.get('endpoint_url') or ''
            if endpoint_url:
                fetch_and_store(session, batch_id, item, endpoint_url)
        time.sleep(LOOP_SECONDS)
    log('[STOP] legacy capture end')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
