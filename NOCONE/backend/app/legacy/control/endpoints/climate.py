from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime, time
from typing import Optional
from app.legacy.telemining.database import get_db
from app.legacy.zenit.models import Sensor, Device
from ..utils.climate import get_sensor_limits, obtener_logs_sensor, analizar_logs_sensor
router = APIRouter()

@router.get("/anomalias-climaticas")
def detectar_anomalias_climaticas(
    tipo_sensor: str = Query("temperatura"),
    ur: Optional[str] = Query(None),
    fecha_inicio: datetime = Query(..., description="Fecha de inicio (YYYY-MM-DD)"),
    fecha_termino: datetime = Query(..., description="Fecha de término (YYYY-MM-DD)"),
    limite_sup: Optional[float] = Query(None),
    limite_inf: Optional[float] = Query(None),
    db: Session = Depends(get_db)
):
    tipo_sensor = tipo_sensor.lower()

    # Ajustar fecha completa
    fecha_inicio = datetime.combine(fecha_inicio.date(), time.min)
    fecha_termino = datetime.combine(fecha_termino.date(), time.max)

    try:
        limite_sup, limite_inf = get_sensor_limits(tipo_sensor, limite_sup, limite_inf)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    sensor = db.query(Sensor).filter(Sensor.name.ilike(tipo_sensor)).first()
    if not sensor:
        raise HTTPException(status_code=404, detail=f"Sensor '{tipo_sensor}' no encontrado.")

    urs_qs = db.query(Device).filter(Device.device_type == "zenit-ur", Device.sensores == True)
    if ur:
        urs_qs = urs_qs.filter(Device.name == ur)

    urs_list = urs_qs.all()
    if not urs_list:
        raise HTTPException(status_code=404, detail="No se encontraron URs sensoradas.")

    resultados = []
    for ur_dispositivo in urs_list:
        logs = obtener_logs_sensor(db, sensor.id, ur_dispositivo.id, fecha_inicio, fecha_termino)
        if logs:
            resultado_ur = analizar_logs_sensor(ur_dispositivo.name, logs, limite_inf, limite_sup)
            resultados.append(resultado_ur)

    return {"anomalias": resultados}
