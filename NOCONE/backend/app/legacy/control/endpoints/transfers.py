from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.legacy.telemining.database import get_db
from app.legacy.zenit.models import Device, Permanencia,Traslados

router = APIRouter()

@router.get("/new-traslados")
async def new_traslados(db: Session = Depends(get_db)):
    location_sq = (
        db.query(Device.id.label("loc_id"),
                 Device.uuid.label("location_uuid"),
                 Device.name.label("location_name"))
        .subquery()
    )
    destiny_sq = (
        db.query(Device.id.label("des_id"),
                 Device.uuid.label("destiny_uuid"),
                 Device.name.label("destiny_name"))
        .subquery()
    )
    device_sq = (
        db.query(Device.id.label("dev_id"),
                 Device.uuid.label("device_uuid"),
                 Device.name.label("device_name"))
        .subquery()
    )
    traslados = (
        db.query(
            Traslados.id,
            Traslados.timestamp,
            Traslados.end_timestamp,
            Traslados.time,
            Traslados.location,
            location_sq.c.location_uuid,
            location_sq.c.location_name,
            Traslados.destiny,
            destiny_sq.c.destiny_uuid,
            destiny_sq.c.destiny_name,
            Traslados.device_id,
            device_sq.c.device_uuid,
            device_sq.c.device_name
        )
        .join(location_sq, Traslados.location == location_sq.c.loc_id)
        .join(destiny_sq, Traslados.destiny == destiny_sq.c.des_id)
        .join(device_sq, Traslados.device_id == device_sq.c.dev_id)
        .all()
    )
    result = []
    for row in traslados:
        result.append({
            "id": row.id,
            "timestamp": row.timestamp.isoformat() if row.timestamp else None,
            "end_timestamp": row.end_timestamp.isoformat() if row.end_timestamp else None,
            "time": round(row.time,1),
            "location": row.location,
            "location_uuid": row.location_uuid,
            "location_name": row.location_name,
            "destiny": row.destiny,
            "destiny_uuid": row.destiny_uuid,
            "destiny_name": row.destiny_name,
            "device_id": row.device_id,
            "device_uuid": row.device_uuid,
            "device_name": row.device_name
        })
    return result

@router.get("/new-permanencias")
async def new_permanencias(db: Session = Depends(get_db)):
    location_sq = (
        db.query(
            Device.id.label("loc_id"),
            Device.uuid.label("location_uuid"),
            Device.name.label("location_name"),
        ).subquery()
    )
    device_sq = (
        db.query(
            Device.id.label("dev_id"),
            Device.uuid.label("device_uuid"),
            Device.name.label("device_name"),
        ).subquery()
    )
    rows = (
        db.query(
            Permanencia.id,
            Permanencia.timestamp,
            Permanencia.time,
            Permanencia.location,
            location_sq.c.location_uuid,
            location_sq.c.location_name,
            Permanencia.device_id,
            device_sq.c.device_uuid,
            device_sq.c.device_name,
        )
        .join(location_sq, Permanencia.location == location_sq.c.loc_id)
        .join(device_sq, Permanencia.device_id == device_sq.c.dev_id)
        .order_by(Permanencia.timestamp)
        .all()
    )
    result = []
    for r in rows:
        result.append({
            "id": r.id,
            "timestamp": r.timestamp.isoformat() if r.timestamp else None,
            "time": round(float(r.time),1) if r.time is not None else None,
            "location": r.location,
            "location_uuid": r.location_uuid,
            "location_name": r.location_name,
            "device_id": r.device_id,
            "device_uuid": r.device_uuid,
            "device_name": r.device_name,
            "fecha": r.timestamp.date().isoformat() if r.timestamp else None,
        })

    return result