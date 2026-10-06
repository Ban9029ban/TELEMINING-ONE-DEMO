from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.deps import get_db
from app.services.sismico_operator_service import SismicoOperatorService

router = APIRouter()


class ManualObjectStateRequest(BaseModel):
    objectCode: str = Field(..., min_length=3)
    stateCode: str | None = Field(default=None)
    targetState: str | None = Field(default=None)
    polygonCode: str | None = Field(default=None)
    mapCode: str | None = Field(default=None)
    requestedBy: str = Field(default='operador_local')
    actionType: str = Field(default='state_change')
    dryRun: bool = Field(default=False)


@router.post('/site/{site_code}/object-state')
def set_manual_object_state(site_code: str, payload: ManualObjectStateRequest, db: Session = Depends(get_db)):
    target_state = payload.targetState or payload.stateCode
    object_code = payload.polygonCode or payload.objectCode
    return SismicoOperatorService(db).set_manual_object_state(
        site_code=site_code,
        object_code=object_code,
        state_code=target_state or 'normal',
        requested_by=payload.requestedBy,
        map_code=payload.mapCode,
        action_type=payload.actionType,
        dry_run=payload.dryRun,
    )


class PolygonModeRequest(BaseModel):
    objectCode: str = Field(min_length=3)
    mode: str

@router.post('/site/{site_code}/control-mode')
def set_control_mode(site_code: str, payload: PolygonModeRequest, db: Session = Depends(get_db)):
    from app.services.polygon_control_mode import change_mode
    service = SismicoOperatorService(db)
    site = service._get_site(site_code)
    obj = service._get_map_object(site['id'], site['code'], site['name'], payload.objectCode)
    if not obj.get('id'):raise HTTPException(409,'Este polígono solo tiene control manual.')
    result = change_mode(db, obj['id'], payload.mode)
    db.commit()
    return {**result, 'object_code':obj['code']}
