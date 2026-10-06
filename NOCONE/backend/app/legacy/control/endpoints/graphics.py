from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from typing import Dict
from app.legacy.telemining.database import get_db
from app.legacy.control.charge_tables import *
from app.legacy.control.utils.vehicles import get_vehicle_status, get_vehicles_per_ur, get_vehicle_data
from app.legacy.control.utils.people import get_people_per_ur, get_person_data
from app.legacy.control.utils.zenit import get_zenit_status
from app.legacy.control.utils.sensors import get_sensor_data

router = APIRouter()

@router.get("/graficbase")
async def graficbase_view():
    return JSONResponse(content={"message": "Flag page placeholder"})

@router.get("/people-per-level")
def grafico_people_per_level(db: Session = Depends(get_db)) -> Dict:
    return get_people_per_ur(db)["id_level_data"]

@router.get("/vehicles-per-level")
def grafico_vehicles_per_level(db: Session = Depends(get_db)) -> Dict:
    data = get_vehicles_per_ur(db)
    return {
        "vehicles_per_level_stacked": data["conteo_vehiculos_por_nivel"],
        "vehicle_types": data["vehicle_types"],
    }

@router.get("/vehicle-status")
def grafico_vehicle_status(db: Session = Depends(get_db)) -> Dict:
    return get_vehicle_status(db)

@router.get("/zenit-status")
def grafico_zenit_status(db: Session = Depends(get_db)) -> Dict:
    return get_zenit_status(db)

@router.get("/sensor-data")
def grafico_sensor_data(db: Session = Depends(get_db)) -> Dict:
    return get_sensor_data(db)

@router.get("/person-data")
def grafico_person_data(db: Session = Depends(get_db)) -> Dict:
    return get_person_data(db)

@router.get("/vehicle-data")
def grafico_vehicle_data(db: Session = Depends(get_db)) -> Dict:
    return get_vehicle_data(db)