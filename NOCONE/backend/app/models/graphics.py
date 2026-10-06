# app/models/graphics.py

from datetime import datetime, date
from typing import List, Optional

from pydantic import BaseModel


# ============
#  GRÁFICOS
# ============

class TimeBucketCount(BaseModel):
    """
    Punto genérico de una serie de tiempo:
    - bucket: normalmente una hora o un día (formato string)
    - count: cantidad de eventos en ese intervalo
    """
    bucket: str
    count: int


class VehicleGraphic(TimeBucketCount):
    """Dato de la serie de vehículos por intervalo."""
    pass


class PeopleGraphic(TimeBucketCount):
    """Dato de la serie de personas por intervalo."""
    pass


class ClimateAnomaly(BaseModel):
    """
    Ejemplo de estructura para anomalías de clima.
    Si más adelante necesitas otros campos, se pueden agregar.
    """
    timestamp: datetime
    sensor_name: str
    metric: str          # p.ej. "temp", "humedad", "co2"
    value: float
    unit: str            # p.ej. "°C", "rH", "ppm"
    level: str           # p.ej. "Normal", "Alerta", "Crítico"


# =========================
#  TRANSFERS / PERMANENCIA
# =========================

class UrtTransferBase(BaseModel):
    """
    Estructura base para traslados/permanencias de URs,
    compatible con lo que arma el endpoint original de Django
    (id, timestamp, tiempo, ubicación, etc.).
    """
    id: Optional[int] = None

    timestamp: Optional[datetime] = None   # instante del evento
    time: Optional[float] = None           # tiempo (minutos, horas, etc. según cálculo)

    # Información de ubicación
    location: Optional[str] = None
    location_uuid: Optional[str] = None
    location_name: Optional[str] = None

    # Información del dispositivo / UR
    device_id: Optional[int] = None
    device_uuid: Optional[str] = None
    device_name: Optional[str] = None

    # Fecha "plana" para agrupar en tablas
    fecha: Optional[date] = None


class UrtTransferNew(UrtTransferBase):
    """
    Registro de un nuevo traslado (entrada/salida de una zona, etc.).
    """
    pass


class UrtTransferStay(UrtTransferBase):
    """
    Registro de permanencia (UR Stay). 
    De momento reutiliza los mismos campos, pero si luego necesitas
    otros (p.ej. tiempo_total_estadia) se agregan aquí.
    """
    pass
