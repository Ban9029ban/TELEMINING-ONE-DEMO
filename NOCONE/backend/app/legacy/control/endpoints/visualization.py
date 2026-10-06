from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from typing import Dict
from app.legacy.telemining.database import get_db
from app.legacy.zenit.models import Device, Visualization, ProximityLog
from ..utils.ur_status import get_ur_status_data
import traceback
from sqlalchemy import func

router = APIRouter()

@router.get("/buscar-nodo")
async def buscar_nodo(term: str = Query(...), db: Session = Depends(get_db)):
    nodos = db.query(Device).filter(func.lower(Device.name).contains(term.lower())).all()
    nombres = [nodo.name for nodo in nodos]
    return nombres

@router.get("/detalles-nodo")
async def detalles_nodo(device_name: str, db: Session = Depends(get_db)):
    device = db.query(Device).filter(Device.name == device_name).first()
    if not device:
        return {"error": "Dispositivo no encontrado"}
    last_visualization = (
        db.query(Visualization)
        .filter(Visualization.device_id == device.id)
        .order_by(Visualization.last_updated.desc())
        .first()
    )
    proximity_logs = (
        db.query(ProximityLog)
        .filter(ProximityLog.detected_device_id == device.id)
        .order_by(ProximityLog.timestamp.desc())
        .limit(10)
        .all()
    )
    return {
        "device": {
            "name": device.name,
            "client": device.client,
        },
        "last_visualization": {
            "ur_name": last_visualization.last_ur.name if last_visualization else None,
            "last_updated": last_visualization.last_updated.isoformat() if last_visualization else None,
        },
        "proximity_logs": [
            {
                "ur_name": log.ur_device.name if log.ur_device else "N/A",
                "timestamp": log.timestamp.isoformat() if log.timestamp else "N/A",
                "distance": log.distance if log.distance is not None else "N/A",
                "status": log.status if log.status is not None else "N/A",
            }
            for log in proximity_logs
        ],
    }

@router.get("/point-data-vehicle")
async def point_data_vehicle(device: int = Query(...), db: Session = Depends(get_db)):
    visualizaciones = (
        db.query(Visualization)
        .filter(
            Visualization.last_ur_id == device,
            Visualization.device.has(device_type="zenit-mobile"),
        )
        .all()
    )
    result = [
        f"{v.last_updated.strftime('%d-%m-%Y : %I:%M %p')} {v.device.name}"
        for v in visualizaciones
    ]
    return result

@router.get("/point-data-person")
async def point_data_person(device: int = Query(...), db: Session = Depends(get_db)):
    visualizaciones = (
        db.query(Visualization)
        .filter(
            Visualization.last_ur_id == device,
            Visualization.device.has(device_type="zenit-id"),
        )
        .all()
    )
    result = [
        f"{v.last_updated.strftime('%d-%m-%Y : %I:%M %p')} {v.device.name}"
        for v in visualizaciones
    ]
    return result

@router.get("/actualizar-variables-ur")
async def actualizar_variables_ur(db: Session = Depends(get_db)):
    info_ur = {}
    return JSONResponse(content={"info_UR": info_ur})

@router.get("/actualizar_variables_ur_view", response_model=Dict)
async def actualizar_variables_ur_view(db: Session = Depends(get_db)):
    try:
        contador_x_UR = get_ur_status_data(db)
        return {"info_UR": contador_x_UR}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error al procesar los datos: {str(e)}")

@router.get("/detalles-nodo-vehicles")
async def detalles_nodo_vehicles(device_name: str, db: Session = Depends(get_db)):
    ur_device = db.query(Device).filter(Device.name == device_name).first()
    if not ur_device:
        raise HTTPException(status_code=404, detail="UR no encontrada")
    vehicle_visualizations = (
        db.query(Visualization)
        .join(Device, Visualization.device_id == Device.id)
        .filter(
            Visualization.last_ur_id == ur_device.id,
            Device.device_type == "zenit-mobile"
        )
        .all()
    )
    vehicle_data = []
    for visualization in vehicle_visualizations:
        vehicle_data.append({
            "name": visualization.device.name or "Vehículo",
            "client": visualization.device.client or "N/A",
            "ur_name": ur_device.name,
            "last_updated": visualization.last_updated.isoformat() if visualization.last_updated else None,
        })
    return {
        "ur_name": ur_device.name,
        "vehicles": vehicle_data
    }

@router.get("/detalles-nodo-people")
async def detalles_nodo_people(device_name: str, db: Session = Depends(get_db)):
    ur_device = db.query(Device).filter(Device.name == device_name).first()
    if not ur_device:
        raise HTTPException(status_code=404, detail="UR no encontrada")
    person_visualizations = (
        db.query(Visualization)
        .join(Device, Visualization.device_id == Device.id)
        .filter(
            Visualization.last_ur_id == ur_device.id,
            Device.device_type == "zenit-id"
        )
        .all()
    )
    person_data = []
    for visualization in person_visualizations:
        full_name = visualization.device.name or "Persona"
        name_parts = full_name.split(" ", 1)
        nombres = name_parts[0] if len(name_parts) > 0 else full_name
        apellidos = name_parts[1] if len(name_parts) > 1 else ""
        person_data.append({
            "name": f"{nombres} {apellidos}".strip(),
            "client": visualization.device.client or "N/A",
            "ur_name": ur_device.name,
            "last_updated": visualization.last_updated.isoformat() if visualization.last_updated else None,
        })
    return {
        "ur_name": ur_device.name,
        "people": person_data
    }