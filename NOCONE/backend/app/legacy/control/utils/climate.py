from datetime import datetime
from typing import Optional, List
from collections import defaultdict
from sqlalchemy.orm import Session
from app.legacy.zenit.models import DataLog

def get_sensor_limits(sensor_type: str, sup: Optional[float], inf: Optional[float]) -> tuple[float, float]:
    sensor_type = sensor_type.lower()
    if sensor_type == "temperatura":
        return sup if sup is not None else 26.0, inf if inf is not None else 18.0
    elif sensor_type == "co2":
        return sup if sup is not None else 1000.0, inf if inf is not None else 400.0
    raise ValueError("Tipo de sensor no soportado.")

def obtener_logs_sensor(db: Session, sensor_id: int, ur_id: int, fecha_inicio: datetime, fecha_termino: datetime) -> List[DataLog]:
    return db.query(DataLog).filter(
        DataLog.sensor_device_id == sensor_id,
        DataLog.ur_device_id == ur_id,
        DataLog.timestamp >= fecha_inicio,
        DataLog.timestamp <= fecha_termino
    ).order_by(DataLog.timestamp.asc()).all()

def analizar_logs_sensor(ur_name: str, logs: List[DataLog], limite_inf: float, limite_sup: float) -> dict:
    normales = []
    anomalias = []

    for log in logs:
        registro = {
            "timestamp": log.timestamp.isoformat(),
            "valor": log.value
        }
        if log.value < limite_inf or log.value > limite_sup:
            anomalias.append(registro)
        else:
            normales.append(registro)
    datos_por_dia = defaultdict(list)
    for registro in normales + anomalias:
        fecha = registro["timestamp"][:10]
        datos_por_dia[fecha].append(registro)
    bloques = []
    bloque_actual = []

    for registro in anomalias:
        tiempo = datetime.fromisoformat(registro["timestamp"])
        if not bloque_actual:
            bloque_actual.append((tiempo, registro["valor"]))
            continue

        anterior = bloque_actual[-1][0]
        if (tiempo - anterior).total_seconds() <= 600:
            bloque_actual.append((tiempo, registro["valor"]))
        else:
            if len(bloque_actual) >= 2:
                bloques.append(bloque_actual)
            bloque_actual = [(tiempo, registro["valor"])]

    if len(bloque_actual) >= 2:
        bloques.append(bloque_actual)

    eventos = [
        {
            "inicio": bloque[0][0].isoformat(),
            "fin": bloque[-1][0].isoformat(),
            "duracion_minutos": round((bloque[-1][0] - bloque[0][0]).total_seconds() / 60.0, 1)
        }
        for bloque in bloques
    ]

    return {
        "ur": ur_name,
        "valores": normales + anomalias,
        "fuera_de_rango": anomalias,
        "eventos": eventos
    }
