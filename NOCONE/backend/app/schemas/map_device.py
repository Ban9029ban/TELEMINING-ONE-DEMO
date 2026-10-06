# app/schemas/map_device.py
from pydantic import BaseModel


class MapDeviceBase(BaseModel):
    map_code: str
    kind: str
    ref_id: int
    label: str
    x_pct: float
    y_pct: float


class MapDeviceCreate(MapDeviceBase):
    pass


class MapDeviceUpdate(BaseModel):
    x_pct: float
    y_pct: float


class MapDeviceOut(MapDeviceBase):
    id: int

    class Config:
        orm_mode = True
