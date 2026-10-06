from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.deps import get_db
from app.schemas.sismico_contract import (
    SismicoActivePolygonsResponse,
    SismicoDiagnosticsResponse,
    SismicoHealthResponse,
    SismicoPollingRunRequest,
    SismicoPollingRunResponse,
    SismicoPollingStatusResponse,
    SismicoSiteDetail,
    SismicoSiteStateResponse,
    SismicoSitesResponse,
)
from app.services.polling_service import PollingService
from app.services.sismico_operator_service import SismicoOperatorService
from app.services.sismico_service import SismicoService

router = APIRouter()


@router.get('/active-polygons', response_model=SismicoActivePolygonsResponse)
def active_polygons(db: Session = Depends(get_db)):
    return SismicoService(db).get_active_polygons()


@router.post('/active-polygons/test-alert')
def inject_test_alert(
    site_code: str = Query(default='andesita', min_length=3),
    polygon_code: str = Query(default='andesita-norte-hw', min_length=3),
    db: Session = Depends(get_db),
):
    """Inject a non-physical alert to validate cross-plan notifications."""
    result = SismicoOperatorService(db).set_manual_object_state(
        site_code=site_code,
        object_code=polygon_code,
        state_code='alerta',
        requested_by='sismico_test_alert_api',
        action_type='state_change',
        dry_run=True,
    )
    return {
        'ok': True,
        'message': 'Alerta de prueba inyectada. Abra un plano diferente para visualizar la notificación.',
        'alert': result,
    }


@router.delete('/active-polygons/test-alert')
def clear_test_alert(
    site_code: str = Query(default='andesita', min_length=3),
    polygon_code: str = Query(default='andesita-norte-hw', min_length=3),
    db: Session = Depends(get_db),
):
    """Return the test polygon to normal and remove its notification."""
    result = SismicoOperatorService(db).set_manual_object_state(
        site_code=site_code,
        object_code=polygon_code,
        state_code='centro',
        requested_by='sismico_test_alert_api',
        action_type='state_change',
        dry_run=True,
    )
    return {
        'ok': True,
        'message': 'Alerta de prueba retirada; el polígono volvió a estado centro.',
        'alert': result,
    }


@router.get("/sites", response_model=SismicoSitesResponse)
def list_sites(db: Session = Depends(get_db)):
    return SismicoService(db).list_sites()


@router.get("/sites/{site_code}", response_model=SismicoSiteDetail)
def get_site(site_code: str, db: Session = Depends(get_db)):
    try:
        return SismicoService(db).get_site_definition(site_code)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/sites/{site_code}/state", response_model=SismicoSiteStateResponse)
def get_site_state(site_code: str, db: Session = Depends(get_db)):
    try:
        return SismicoService(db).get_site_current_state(site_code)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc




@router.get("/diagnostics/{site_code}", response_model=SismicoDiagnosticsResponse)
def get_site_diagnostics(site_code: str, force_endpoint_code: str | None = None, live_fetch: bool = True, persist: bool = False, db: Session = Depends(get_db)):
    try:
        return PollingService(db).collect_site_diagnostics(
            site_code,
            force_endpoint_code=force_endpoint_code,
            live_fetch=live_fetch,
            persist=persist,
            trigger_type="diagnostic",
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/polling/run", response_model=SismicoPollingRunResponse)
def run_polling(request: SismicoPollingRunRequest, db: Session = Depends(get_db)):
    return PollingService(db).run_site_polling(request)


@router.get("/polling/status", response_model=SismicoPollingStatusResponse)
def polling_status(site_code: str, db: Session = Depends(get_db)):
    try:
        return SismicoService(db).get_polling_status(site_code)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/health", response_model=SismicoHealthResponse)
def health(db: Session = Depends(get_db)):
    return SismicoService(db).get_health()
