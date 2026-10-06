
from sqlalchemy import Column, Integer, String, DateTime
from datetime import datetime
from app.db.base_class import Base

class SemaforoState(Base):
    __tablename__ = "semaforo_state"

    id = Column(Integer, primary_key=True, index=True)
    estado = Column(String)  # NORMAL / ALERTA / EMERGENCIA
    created_at = Column(DateTime, default=datetime.utcnow)
