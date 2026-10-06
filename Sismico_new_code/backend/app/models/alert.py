from sqlalchemy import Column, BigInteger, String, DateTime, ForeignKey, Text, JSON, func
from app.db.base import Base

class AlertEvent(Base):
    __tablename__ = "alert_event"
    id = Column(BigInteger, primary_key=True)
    site_id = Column(BigInteger, ForeignKey("site.id"), nullable=False)
    source_object_id = Column(BigInteger, ForeignKey("map_object.id"), nullable=True)
    title = Column(String(200), nullable=False)
    message = Column(Text)
    severity = Column(String(20), nullable=False, default="medium")
    status = Column(String(20), nullable=False, default="open")
    metadata_json = Column("metadata", JSON, nullable=False, default={})
    opened_at = Column(DateTime(timezone=True), server_default=func.now())
