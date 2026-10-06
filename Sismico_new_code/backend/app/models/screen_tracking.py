from sqlalchemy import Column, BigInteger, String, DateTime, func, Integer
from app.db.base import Base


class ScreenTracking(Base):
    __tablename__ = "screen_tracking"

    id = Column(BigInteger, primary_key=True, index=True)
    pantalla = Column(Integer)
    ip = Column(String(64))
    mac = Column(String(64))
    plano = Column(String(120))
    hostname = Column(String(160))
    device_name = Column(String(160))
    fingerprint = Column(String(255))
    screen_code = Column(String(120))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
