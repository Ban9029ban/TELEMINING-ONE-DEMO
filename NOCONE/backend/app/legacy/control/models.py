from sqlalchemy import Column, Integer, String, ForeignKey, Float, JSON
from app.legacy.telemining.database import Base

class Mapa(Base):
    __tablename__ = 'control_mapa'

    id = Column(Integer, primary_key=True, index=True)
    file = Column(String(100))
    name = Column(String(100))
    proyecto = Column(String(100))

class Punto(Base):
    __tablename__ = 'control_punto'

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey('zenit_device.id'))
    mapa_id = Column(Integer, ForeignKey('control_mapa.id'))
    map_x = Column(Float)
    map_y = Column(Float)

class Controlador(Base):
    __tablename__ = 'control_controlador'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer)  # Este campo se adaptará para un sistema de usuarios propio o Auth0
    company = Column(String(100))
    role = Column(String(100))
    dashboard_settings = Column(JSON, nullable=True, default={})
