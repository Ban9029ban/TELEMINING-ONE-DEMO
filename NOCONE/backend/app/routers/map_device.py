# app/routes/map_device.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.db import get_session
from app.models.map_device import MapDevice
from app.schemas.map_device import (
    MapDeviceCreate,
    MapDeviceUpdate,
    MapDeviceOut,
)

router = APIRouter(
    prefix="/map_device",
    tags=["map_device"],
)


@router.get("/by_ref/{ref_id}/{map_code}", response_model=MapDeviceOut)
def get_by_ref(ref_id: int, map_code: str, db: Session = Depends(get_session)):
    """
    Devuelve el punto de mapa asociado a un pórtico (ref_id) en un mapa (map_code).
    """
    dev = (
        db.query(MapDevice)
        .filter(
            MapDevice.ref_id == ref_id,
            MapDevice.map_code == map_code,
        )
        .first()
    )
    if not dev:
        raise HTTPException(status_code=404, detail="MapDevice no encontrado")
    return dev


@router.post("", response_model=MapDeviceOut)
def create(dev_in: MapDeviceCreate, db: Session = Depends(get_session)):
    """
    Crea un nuevo map_device (cuando el pórtico aún no tiene punto en el plano).
    """
    dev = MapDevice(**dev_in.dict())
    db.add(dev)
    db.commit()
    db.refresh(dev)
    return dev


@router.patch("/{id}", response_model=MapDeviceOut)
def update(id: int, body: MapDeviceUpdate, db: Session = Depends(get_session)):
    """
    Edita x_pct / y_pct de un punto existente (drag & drop desde el frontend).
    """
    dev = db.query(MapDevice).filter(MapDevice.id == id).first()
    if not dev:
        raise HTTPException(status_code=404, detail="MapDevice no encontrado")

    dev.x_pct = body.x_pct
    dev.y_pct = body.y_pct

    db.commit()
    db.refresh(dev)
    return dev
