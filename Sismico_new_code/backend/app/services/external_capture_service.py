from __future__ import annotations

import base64
import hashlib
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, Response
from sqlalchemy.orm import Session

from app.models.external_source_capture import ExternalSourceCapture
from app.models.remote_endpoint import RemoteEndpoint
from app.models.remote_source import RemoteSource
from app.models.site import Site
from app.services.sismico_service import SismicoService


class ExternalCaptureService:
    def __init__(self, db: Session):
        self.db = db

    def list_endpoints(self) -> list[dict[str, Any]]:
        SismicoService(self.db).ensure_seeded_sites()
        rows = (
            self.db.query(RemoteEndpoint, RemoteSource, Site)
            .outerjoin(RemoteSource, RemoteSource.id == RemoteEndpoint.remote_source_id)
            .outerjoin(Site, Site.id == RemoteEndpoint.site_id)
            .filter(RemoteEndpoint.is_enabled.is_(True))
            .order_by(Site.code.asc().nullsfirst(), RemoteEndpoint.code.asc())
            .all()
        )
        items: list[dict[str, Any]] = []
        for endpoint, source, site in rows:
            items.append({
                'site_id': getattr(site, 'id', None),
                'site_code': getattr(site, 'code', None),
                'site_name': getattr(site, 'name', None),
                'remote_source_id': getattr(source, 'id', None),
                'source_code': getattr(source, 'code', None),
                'source_name': getattr(source, 'name', None),
                'endpoint_id': endpoint.id,
                'endpoint_code': endpoint.code,
                'endpoint_name': endpoint.name,
                'endpoint_url': endpoint.endpoint_url,
                'endpoint_kind': endpoint.endpoint_kind,
                'parser_type': endpoint.parser_type,
                'polling_seconds': endpoint.polling_seconds,
                'is_enabled': endpoint.is_enabled,
            })
        return items

    def store_capture(self, payload: dict[str, Any]) -> dict[str, Any]:
        body_text = payload.get('body_text')
        body_base64 = payload.get('body_base64')
        content_type = (payload.get('content_type') or '').lower()
        is_binary = bool(payload.get('is_binary'))
        if not is_binary and body_text is None and body_base64:
            try:
                body_text = base64.b64decode(body_base64).decode('utf-8', errors='replace')
            except Exception:
                body_text = None
        raw_bytes: bytes
        if body_base64:
            try:
                raw_bytes = base64.b64decode(body_base64)
            except Exception:
                raw_bytes = (body_text or '').encode('utf-8', errors='replace')
        else:
            raw_bytes = (body_text or '').encode('utf-8', errors='replace')
            if is_binary:
                body_base64 = base64.b64encode(raw_bytes).decode('ascii')

        sha256 = hashlib.sha256(raw_bytes).hexdigest() if raw_bytes is not None else None
        body_size = len(raw_bytes or b'')
        observed_at = payload.get('observed_at')
        if isinstance(observed_at, str):
            try:
                observed_at = datetime.fromisoformat(observed_at.replace('Z', '+00:00'))
            except Exception:
                observed_at = datetime.now(timezone.utc)
        elif observed_at is None:
            observed_at = datetime.now(timezone.utc)

        capture = ExternalSourceCapture(
            batch_id=payload.get('batch_id') or 'manual',
            site_id=payload.get('site_id'),
            remote_source_id=payload.get('remote_source_id'),
            remote_endpoint_id=payload.get('remote_endpoint_id'),
            site_code=payload.get('site_code'),
            source_code=payload.get('source_code'),
            endpoint_code=payload.get('endpoint_code'),
            endpoint_name=payload.get('endpoint_name'),
            endpoint_url=payload.get('endpoint_url') or '',
            parser_type=payload.get('parser_type'),
            endpoint_kind=payload.get('endpoint_kind'),
            content_type=payload.get('content_type'),
            http_status=payload.get('http_status'),
            ok=bool(payload.get('ok')),
            is_binary=is_binary,
            body_text=body_text if not is_binary or 'json' in content_type or 'html' in content_type or 'text' in content_type else None,
            body_base64=body_base64 if is_binary else None,
            body_sha256=sha256,
            body_size=body_size,
            request_duration_ms=payload.get('request_duration_ms'),
            source_origin=payload.get('source_origin') or 'external',
            derived_from_url=payload.get('derived_from_url'),
            extra_json=payload.get('extra_json') or {},
            observed_at=observed_at,
        )
        self.db.add(capture)
        self.db.commit()
        self.db.refresh(capture)
        return {'ok': True, 'capture_id': capture.id, 'body_sha256': capture.body_sha256, 'body_size': capture.body_size}

    def list_captures(self, site_code: str | None = None, endpoint_code: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        query = self.db.query(ExternalSourceCapture)
        if site_code:
            query = query.filter(ExternalSourceCapture.site_code == site_code)
        if endpoint_code:
            query = query.filter(ExternalSourceCapture.endpoint_code == endpoint_code)
        rows = query.order_by(ExternalSourceCapture.observed_at.desc(), ExternalSourceCapture.id.desc()).limit(max(1, min(limit, 500))).all()
        return [
            {
                'id': row.id,
                'batch_id': row.batch_id,
                'site_code': row.site_code,
                'source_code': row.source_code,
                'endpoint_code': row.endpoint_code,
                'endpoint_name': row.endpoint_name,
                'endpoint_url': row.endpoint_url,
                'content_type': row.content_type,
                'http_status': row.http_status,
                'ok': row.ok,
                'is_binary': row.is_binary,
                'body_sha256': row.body_sha256,
                'body_size': row.body_size,
                'request_duration_ms': row.request_duration_ms,
                'source_origin': row.source_origin,
                'derived_from_url': row.derived_from_url,
                'observed_at': row.observed_at,
                'created_at': row.created_at,
            }
            for row in rows
        ]

    def get_capture_raw(self, endpoint_code: str, capture_id: int | None = None, source_origin: str | None = None) -> Response:
        query = self.db.query(ExternalSourceCapture).filter(ExternalSourceCapture.endpoint_code == endpoint_code)
        if source_origin:
            query = query.filter(ExternalSourceCapture.source_origin == source_origin)
        if capture_id is not None:
            row = query.filter(ExternalSourceCapture.id == capture_id).first()
        else:
            row = query.order_by(ExternalSourceCapture.observed_at.desc(), ExternalSourceCapture.id.desc()).first()
        if not row:
            raise HTTPException(status_code=404, detail=f'No hay captura para endpoint {endpoint_code}')

        content_type = row.content_type or 'text/plain; charset=utf-8'
        headers = {
            'X-Capture-Id': str(row.id),
            'X-Capture-Batch': row.batch_id or '',
            'X-Endpoint-Code': row.endpoint_code or '',
            'X-Observed-At': row.observed_at.isoformat() if row.observed_at else '',
            'X-Source-Origin': row.source_origin or '',
        }
        if row.is_binary and row.body_base64:
            body = base64.b64decode(row.body_base64)
            return Response(content=body, media_type=content_type, headers=headers)
        return Response(content=row.body_text or '', media_type=content_type, headers=headers)
