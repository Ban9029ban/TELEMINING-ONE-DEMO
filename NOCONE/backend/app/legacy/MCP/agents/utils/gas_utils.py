from datetime import datetime
from typing import List, Dict
from app.legacy.MCP.config.param_loader import PARAMS
from app.legacy.MCP.agents.utils.sensors_register import filter_isolated_spikes
from app.legacy.zenit.models import DataLog

def obtener_registros_filtrados(db, gas: str, start_date: datetime, end_date: datetime, zone: str = None) -> List[DataLog]:
    """
    Obtiene los registros de un gas específico en un rango de fechas, 
    aplicando filtro de picos aislados.
    """
    threshold = PARAMS["gases"].get(gas, 50)
    delta = PARAMS.get("delta", {}).get(gas, 1)

    query = db.query(DataLog).filter(DataLog.sensor_device.has(name=gas.lower()))
    query = query.filter(DataLog.timestamp.between(start_date, end_date))

    if zone:
        query = query.filter(DataLog.ur_device.has(name=zone))

    registros_raw = query.order_by(DataLog.timestamp.asc()).all()
    return filter_isolated_spikes(registros_raw, delta=delta), threshold

def calcular_tiempos_disipacion(registros: List[DataLog], threshold: float) -> List[Dict]:
    """
    Calcula los periodos de disipación del gas a partir de los registros.
    Ignora lecturas críticas aisladas que se normalizan en el siguiente ping.
    """
    eventos = []
    en_zona_critica = False
    inicio = None

    for i, log in enumerate(registros):
        if log.value > threshold:
            if not en_zona_critica:
                en_zona_critica = True
                inicio = log.timestamp
        elif en_zona_critica:
            # Verificar si es un error de lectura (solo un ping crítico)
            if i > 0 and registros[i - 1].value > threshold and i + 1 < len(registros) and registros[i + 1].value > threshold:
                continue
            en_zona_critica = False
            fin = log.timestamp
            duracion = round((fin - inicio).total_seconds() / 60, 2)
            eventos.append({"inicio": inicio, "fin": fin, "duracion_minutos": duracion})

    return eventos
