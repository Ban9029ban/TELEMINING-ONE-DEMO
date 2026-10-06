from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.legacy.zenit.models import Person, Device
from app.legacy.telemining.database import get_db

router = APIRouter()

@router.get("/healthcheck")
async def zenit_healthcheck():
    return {"status": "Zenit API running"}

@router.get("/selector-cargos")
def obtener_cargos_unicos(db: Session = Depends(get_db)):
    """
    Retorna una lista de todos los cargos distintos que existen en la tabla Person, ordenados alfabéticamente.
    """
    cargos = db.query(Person.cargo).distinct().order_by(Person.cargo.asc()).all()
    return [c[0] for c in cargos if c[0]]

@router.get("/selector-zonas")
def obtener_zonas(db: Session = Depends(get_db)):
    zonas = db.query(Device).filter(Device.device_type == "zenit-ur").order_by(Device.name.asc()).all()
    return [{"name": z.name, "uuid": z.uuid} for z in zonas]

@router.get("/urs-con-sensores")
def get_urs_con_sensores(db: Session = Depends(get_db)):
    urs = db.query(Device).filter(
        Device.device_type == "zenit-ur", 
        Device.sensores == True
    ).order_by(Device.name.asc()).all()
    return [{"uuid": ur.uuid,"name": ur.name} for ur in urs]

@router.get("/selector-personas")
def obtener_nombres_personas(db: Session = Depends(get_db)):
    personas = db.query(Device).filter(Device.device_type == "zenit-id").order_by(Device.name.asc()).all()
    return [{"name": p.name, "uuid": p.uuid} for p in personas]