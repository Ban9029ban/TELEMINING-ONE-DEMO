from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.deps import get_db
from app.services.external_capture_service import ExternalCaptureService

router = APIRouter()


@router.get('/endpoints')
def list_external_capture_endpoints(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    return ExternalCaptureService(db).list_endpoints()


@router.post('/store')
def store_external_capture(payload: dict[str, Any], db: Session = Depends(get_db)) -> dict[str, Any]:
    return ExternalCaptureService(db).store_capture(payload)


@router.get('/captures')
def list_external_captures(
    site_code: str | None = None,
    endpoint_code: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    return {'items': ExternalCaptureService(db).list_captures(site_code=site_code, endpoint_code=endpoint_code, limit=limit)}


@router.get('/emulator/{endpoint_code}')
def get_emulated_capture(endpoint_code: str, capture_id: int | None = None, source_origin: str | None = None, db: Session = Depends(get_db)):
    return ExternalCaptureService(db).get_capture_raw(endpoint_code=endpoint_code, capture_id=capture_id, source_origin=source_origin)
