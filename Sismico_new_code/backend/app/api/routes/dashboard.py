from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.db.deps import get_db
from app.models.site import Site
from app.models.screen import Screen
from app.models.alert import AlertEvent
from app.models.remote_endpoint import RemoteEndpoint

router = APIRouter()

@router.get("/summary")
def summary(db: Session = Depends(get_db)):
    return {
        "sites_activos": db.query(func.count(Site.id)).filter(Site.is_active == True).scalar() or 0,
        "pantallas_online": db.query(func.count(Screen.id)).filter(Screen.status_code == "online").scalar() or 0,
        "alertas_abiertas": db.query(func.count(AlertEvent.id)).filter(AlertEvent.status == "open").scalar() or 0,
        "endpoints_ok": db.query(func.count(RemoteEndpoint.id)).filter(RemoteEndpoint.is_enabled == True).scalar() or 0,
        "endpoints_total": db.query(func.count(RemoteEndpoint.id)).scalar() or 0
    }

@router.get("/events")
def events():
    return [
        {"id": 1, "titulo": "Portal 3", "detalle": "Semáforo vial cambiado a rojo por alerta crítica"},
        {"id": 2, "titulo": "Pantalla DET-02", "detalle": "Heartbeat recibido hace 8 segundos"},
        {"id": 3, "titulo": "Endpoint Andes Norte", "detalle": "Sincronización correcta: 12 registros procesados"},
    ]
