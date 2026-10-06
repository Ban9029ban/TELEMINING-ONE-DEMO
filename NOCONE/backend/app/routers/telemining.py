# app/routers/telemining.py
from fastapi import APIRouter, Depends
from app.core.config import settings
from app.core.security import get_current_user

router = APIRouter(prefix=f"{settings.api_prefix}/control", tags=["telemining"])

# Endpoints mock para que el frontend deje de romper con 404.
@router.get("/visual/actualiza-urs")
def visual_actualiza_urs(user = Depends(get_current_user)):
    return {"ok": True, "items": []}

@router.get("/transfers/new-tr")
def transfers_new_tr(user = Depends(get_current_user)):
    return {"ok": True, "transfers": []}

@router.get("/graphics/vehicle-")
def graphics_vehicle(user = Depends(get_current_user)):
    return {"ok": True, "series": []}

@router.get("/maps/get-puntos/{zone}")
def maps_get_puntos(zone: str, user = Depends(get_current_user)):
    return {"zone": zone, "points": []}
