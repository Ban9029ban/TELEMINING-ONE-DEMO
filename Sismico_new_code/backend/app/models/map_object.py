from sqlalchemy import Column, BigInteger, String, Boolean, DateTime, ForeignKey, JSON, func
from app.db.base import Base


class MapObject(Base):
    __tablename__ = "map_object"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    site_map_id = Column(BigInteger, ForeignKey("site_map.id"), nullable=False)
    code = Column(String(100), nullable=False)
    name = Column(String(180), nullable=False)
    object_type = Column(String(40), nullable=False, default="polygon")
    geometry_type = Column(String(20), nullable=False, default="polygon")
    geometry_json = Column(JSON, nullable=False, default={})
    state_code = Column(String(40), nullable=False, default="normal")
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
