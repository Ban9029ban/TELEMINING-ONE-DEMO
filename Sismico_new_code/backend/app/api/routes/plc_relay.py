from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.core.settings import settings
from app.db.db import get_db
from app.services.control_orchestrator_service import ControlOrchestratorService
from app.services.plc_relay_service import PlcRelayService

router = APIRouter()


def _authorize(token: str | None) -> None:
    if settings.PLC_RELAY_ROLE != "receiver" or not PlcRelayService.verify_token(token):
        raise HTTPException(status_code=401, detail="Relay authentication failed")


@router.post("/control-event")
def control_event(
    payload: dict[str, Any],
    x_plc_relay_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _authorize(x_plc_relay_token)
    event = payload.get("resolved") or {}
    site_code = str(payload.get("site_code") or event.get("site", {}).get("code") or "")
    polygon_code = payload.get("polygon_code") or event.get("polygon", {}).get("code")
    target_state = str(payload.get("target_state") or event.get("target_state") or "normal")
    action_type = str(payload.get("action_type") or "state_change")
    requested_by = "relay:" + str(payload.get("requested_by") or "origin")
    service = ControlOrchestratorService(db)
    if polygon_code and action_type == "reset":
        result = service.apply_reset(site_code=site_code, polygon_code=polygon_code, requested_by=requested_by)
    elif polygon_code and action_type == "emergency":
        result = service.apply_emergency(site_code=site_code, polygon_code=polygon_code, requested_by=requested_by)
    elif polygon_code:
        result = service.apply_polygon_state(site_code=site_code, polygon_code=polygon_code, target_state=target_state, requested_by=requested_by)
    elif action_type == "global_emergency":
        result = service.apply_global_emergency(requested_by=requested_by)
    elif action_type == "site_clear":
        result = service.apply_site_clear(site_code=site_code, requested_by=requested_by)
    elif action_type == "site_state":
        result = service.apply_site_state(site_code=site_code, target_state=target_state, requested_by=requested_by)
    else:
        result = service.apply_emergency(site_code=site_code, requested_by=requested_by)
    return {"ok": bool(result.get("ok")), "result": result}


@router.post("/polygon-state")
def polygon_state(
    payload: dict[str, Any],
    x_plc_relay_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    if settings.PLC_RELAY_ROLE != "origin" or not PlcRelayService.verify_token(x_plc_relay_token):
        raise HTTPException(status_code=401, detail="Relay authentication failed")
    result = PlcRelayService().apply_mirrored_state(db, payload)
    if not result.get("ok"):
        code = 404 if result.get("error") == "polygon_not_found" else 400
        raise HTTPException(status_code=code, detail=result.get("error"))
    return result
