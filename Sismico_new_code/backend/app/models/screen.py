from sqlalchemy import Column, BigInteger, String, Boolean, DateTime, ForeignKey, Text, Integer, func
from app.db.base import Base


class Screen(Base):
    __tablename__ = "screen"

    id = Column(BigInteger, primary_key=True)
    site_id = Column(BigInteger, ForeignKey("site.id"), nullable=False)
    site_map_id = Column(BigInteger, ForeignKey("site_map.id"), nullable=True)
    code = Column(String(80), nullable=False)
    name = Column(String(150), nullable=False)
    device_label = Column(String(150))
    device_name = Column(String(150))
    device_fingerprint = Column(Text)
    user_agent = Column(Text)
    status_code = Column(String(30), nullable=False, default="offline")
    expected_url = Column(Text)
    client_ip = Column(String(80))
    mac_address = Column(String(80))
    authorized_mac = Column(String(80))
    enforce_mac_lock = Column(Boolean, nullable=False, default=False)
    license_plan = Column(String(30), nullable=False, default='unlimited')
    license_status = Column(String(30), nullable=False, default='licensed')
    license_expires_at = Column(DateTime(timezone=True))
    license_days = Column(Integer)
    role_code = Column(String(30), nullable=False, default="wall")
    notes = Column(Text)
    last_heartbeat_at = Column(DateTime(timezone=True))
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
