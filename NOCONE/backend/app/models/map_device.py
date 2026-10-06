# app/models/map_device.py
from sqlalchemy import Column, Integer, String, Float
from app.models import Base


class MapDevice(Base):
    __tablename__ = "map_device"

    id = Column(Integer, primary_key=True, index=True)
    map_code = Column(String, index=True)   # ej: 'NP_dia'
    kind = Column(String)                   # 'portico', 'portico_clima', 'camera', etc.
    ref_id = Column(Integer, index=True)    # ID del pórtico / cámara
    label = Column(String)                  # texto visible
    x_pct = Column(Float)                   # 0.0 .. 1.0
    y_pct = Column(Float)                   # 0.0 .. 1.0
