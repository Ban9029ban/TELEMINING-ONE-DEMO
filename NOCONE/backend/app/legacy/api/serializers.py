from pydantic import BaseModel, validator
from typing import Optional, List, Any
from datetime import datetime
from uuid import UUID

class DataLogSchema(BaseModel):
    id: Optional[int]
    sensor_device_id: int
    ur_device_id: int
    data_type: str
    value: Any
    value_type: str
    timestamp: datetime
    status: bool

    class Config:
        orm_mode = True


class ProximityLogSchema(BaseModel):
    id: Optional[int]
    ur_device_id: int
    detected_device_id: int
    timestamp: datetime
    distance: float
    status: bool

    class Config:
        orm_mode = True


class PingLogSchema(BaseModel):
    id: Optional[int]
    device_id: int
    timestamp: datetime
    status: bool

    class Config:
        orm_mode = True


class VisualizationSchema(BaseModel):
    id: Optional[int]
    device: Any
    previous_ur: Optional[Any]
    initial_ur: Optional[Any]
    initial_updated: Optional[datetime]
    last_ur: Optional[Any]
    last_updated: Optional[datetime]

    class Config:
        orm_mode = True

    @validator('device', pre=True, always=True)
    def validate_device_uniqueness(cls, v, values, **kwargs):
        # Aquí se puede colocar la lógica de validación de unicidad si se desea implementar
        return v
