from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.deps import get_db
from app.schemas.sismico_contract import SismicoPollingRunRequest
from app.services.external_capture_service import ExternalCaptureService
from app.services.polling_service import PollingService
from app.services.sismico_service import SismicoService

router = APIRouter()


def _model_to_dict(value: Any) -> dict[str, Any]:
    if hasattr(value, "model_dump"):
        return value.model_dump()
    if hasattr(value, "dict"):
        return value.dict()
    return dict(value)


def _site_items(value: Any) -> list[Any]:
    items = getattr(value, "items", None)
    if items is not None and not callable(items):
        return list(items)
    data = _model_to_dict(value)
    return list(data.get("items", []))


@router.get("/sources")
def sources(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    return ExternalCaptureService(db).list_endpoints()


@router.post("/run")
def run_polling(payload: dict[str, Any] | None = None, db: Session = Depends(get_db)) -> dict[str, Any]:
    payload = payload or {}
    site_code = payload.get("site_code")
    force_endpoint_code = payload.get("force_endpoint_code")

    if site_code:
        request = SismicoPollingRunRequest(site_code=str(site_code), force_endpoint_code=force_endpoint_code)
        return _model_to_dict(PollingService(db).run_site_polling(request))

    sites = _site_items(SismicoService(db).list_sites())
    if not sites:
        raise HTTPException(status_code=404, detail="No hay sitios sísmicos disponibles para polling.")

    results = []
    overall_ok = True
    for site in sites:
        request = SismicoPollingRunRequest(site_code=site.code, force_endpoint_code=force_endpoint_code)
        result = PollingService(db).run_site_polling(request)
        payload_result = _model_to_dict(result)
        overall_ok = overall_ok and bool(payload_result.get("ok"))
        results.append(payload_result)

    return {
        "ok": overall_ok,
        "message": "Polling ejecutado",
        "results": results,
    }
