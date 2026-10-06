from fastapi import APIRouter, Depends, Query, HTTPException, Form, File, UploadFile, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from app.legacy.telemining.database import get_db
from app.legacy.control.models import Mapa, Punto
from app.legacy.zenit.models import Device, Visualization, ProximityLog
from app.legacy.control.dependencies import get_topbar_user_data
from app.legacy.control.schemas import MapaDelete
from app.legacy.control.charge_tables import *
from sqlalchemy import func, case

router = APIRouter()

@router.get("/")
async def zenit_maps(
    search: str = Query(None),
    db: Session = Depends(get_db),
    active_user: dict = Depends(get_topbar_user_data)
):
    searched_device = None
    searched_visualization = None
    searched_proximity = None
    if search:
        searched_device = db.query(Device).filter(Device.name.contains(search)).first()
        if searched_device:
            searched_visualization = db.query(Visualization).filter(Visualization.device_id == searched_device.id).first()
            searched_proximity = db.query(ProximityLog).filter(ProximityLog.detected_device == searched_device.id).order_by(ProximityLog.timestamp.desc()).limit(10).all()

    mapas = db.query(Mapa).all()
    response = {
        'searched_device': searched_device.name if searched_device else None,
        'searched_visualization': searched_visualization.id if searched_visualization else None,
        'searched_proximities': len(searched_proximity) if searched_proximity else 0,
        'map_count': len(mapas),
        'mapas': [{'id': m.id, 'name': m.name, 'proyecto': m.proyecto} for m in mapas],  # 👈 Agregado
        'active_user': active_user
    }
    return JSONResponse(content=response)

@router.get("/image/{project}/{map_name}")
async def obtener_imagen_mapa(
    project: str,
    map_name: str,
    db: Session = Depends(get_db)
):
    mapa = db.query(Mapa).filter(
        Mapa.proyecto == project,
        Mapa.name == map_name
    ).first()
    if not mapa or not mapa.file:
        raise HTTPException(status_code=404, detail="Mapa no encontrado o sin imagen")
    return Response(content=mapa.file, media_type=mapa.file_type)

@router.post("/", response_model=dict)
async def create_mapa(
    name: str = Form(...),
    proyecto: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    content = await file.read()
    file_type = file.content_type
    nuevo_mapa = Mapa(name=name, proyecto=proyecto, file=content, file_type=file_type)
    db.add(nuevo_mapa)
    db.commit()
    db.refresh(nuevo_mapa)
    return {"message": "Imagen guardada", "mapa_id": nuevo_mapa.id}

@router.delete("/", response_model=dict)
async def delete_mapa(mapa: MapaDelete, db: Session = Depends(get_db)):
    mapa_obj = db.query(Mapa).filter(
        Mapa.name == mapa.name,
        Mapa.proyecto == mapa.proyecto
    ).first()
    if not mapa_obj:
        raise HTTPException(status_code=404, detail="Mapa no encontrado")
    db.delete(mapa_obj)
    db.commit()
    return {"message": f"Mapa '{mapa.name}' del proyecto '{mapa.proyecto}' eliminado correctamente."}

@router.get("/get-puntos/{mapa_id}")
async def get_puntos(mapa_id: str, db: Session = Depends(get_db)):
    mapa = db.query(Mapa).filter(Mapa.name == mapa_id).first()
    if not mapa:
        raise HTTPException(status_code=404, detail="Mapa no encontrado")
    puntos = db.query(Punto).filter(Punto.mapa_id == mapa.id).all()
    device_ids = list({p.device_id for p in puntos if p.device_id is not None})
    devices = db.query(Device).filter(Device.id.in_(device_ids)).all()
    device_dict = {d.id: d for d in devices}
    vis_counts = (
        db.query(
            Visualization.last_ur_id.label("device_id"),
            func.sum(case((Device.device_type == "zenit-mobile", 1), else_=0)).label("mobile_count"),
            func.sum(case((Device.device_type == "zenit-id", 1), else_=0)).label("id_count"),
        )
        .join(Device, Visualization.device_id == Device.id)
        .filter(Visualization.last_ur_id.in_(device_ids))
        .group_by(Visualization.last_ur_id)
        .all()
    )
    vis_dict = {
        row.device_id: {"mobile": row.mobile_count, "id": row.id_count}
        for row in vis_counts
    }
    result = []
    for punto in puntos:
        device = device_dict.get(punto.device_id)
        if not device:
            continue
        vis = vis_dict.get(device.id, {"mobile": 0, "id": 0})
        result.append({
            "device": device.id,
            "name": device.name,
            "sensor": device.sensores,
            "map_x": punto.map_x,
            "map_y": punto.map_y,
            "count": [vis["mobile"], vis["id"]],
            "uuid": device.uuid,
        })
    return result