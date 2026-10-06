from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from datetime import datetime
from app.legacy.telemining.database import get_db
from app.legacy.control.utils.people import get_person_data
from app.legacy.control.utils.vehicles import get_vehicle_data
from app.legacy.control.charge_tables import *

router = APIRouter()

@router.get("/v1/vehicle-data")
async def vehicle_data_endpoint(min_date: str = "2025-01-01", max_date: str = datetime.now().strftime("%Y-%m-%d"), db: Session = Depends(get_db)):
    data = get_vehicle_data(db, min_date, max_date)
    return data

@router.get("/v1/person-data")
async def person_data_endpoint(db: Session = Depends(get_db)):
    data = get_person_data(db)
    return data
