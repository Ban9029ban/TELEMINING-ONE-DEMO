from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.deps import get_db
from app.services.semaforo_service import SemaforoService

router = APIRouter()


class ExecuteSemaforoRequest(BaseModel):
    site_code: str | None = None
    action: str = Field(default='rojo')
    requested_by: str = Field(default='api')
    dry_run: bool = Field(default=False)
    reason: str | None = None
    device_code: str | None = None


class ExecuteAllSemaforoRequest(BaseModel):
    site_codes: list[str] | None = None
    action: str = Field(default='rojo')
    requested_by: str = Field(default='api')
    dry_run: bool = Field(default=False)
    reason: str | None = None


@router.get('/devices')
def devices(site_code: str | None = None, db: Session = Depends(get_db)):
    return SemaforoService(db).list_devices(site_code=site_code)


@router.get('/config')
def config(db: Session = Depends(get_db)):
    return SemaforoService(db).get_config()


@router.post('/execute')
def execute(payload: ExecuteSemaforoRequest, db: Session = Depends(get_db)):
    return SemaforoService(db).execute(
        site_code=payload.site_code,
        action=payload.action,
        requested_by=payload.requested_by,
        dry_run=payload.dry_run,
        reason=payload.reason,
        device_code=payload.device_code,
    )


@router.post('/execute-all')
def execute_all(payload: ExecuteAllSemaforoRequest, db: Session = Depends(get_db)):
    svc = SemaforoService(db)
    return svc.execute_all_sites(
        site_codes=payload.site_codes,
        action=payload.action,
        requested_by=payload.requested_by,
        dry_run=payload.dry_run,
        reason=payload.reason,
    )


@router.post('/estado/{estado}')
def legacy_estado(estado: str, db: Session = Depends(get_db)):
    action = estado.strip().lower()
    if action in {'emergencia', 'alerta', 'rojo'}:
        action = 'rojo'
    elif action in {'normal', 'verde'}:
        action = 'verde'
    elif action in {'amarillo', 'yellow'}:
        action = 'amarillo'
    return SemaforoService(db).execute_all_sites(action=action, requested_by='legacy_estado', dry_run=False, reason='legacy_estado')


@router.get('/estado')
def estado_actual(db: Session = Depends(get_db)):
    return {'devices': SemaforoService(db).list_devices()}
