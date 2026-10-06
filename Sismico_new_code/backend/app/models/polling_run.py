from sqlalchemy import Column, BigInteger, String, DateTime, Integer, Text, ForeignKey, func
from app.db.base import Base

class PollingRun(Base):
    __tablename__ = "polling_run"
    id = Column(BigInteger, primary_key=True)
    remote_endpoint_id = Column(BigInteger, ForeignKey("remote_endpoint.id"), nullable=False)
    status = Column(String(20), nullable=False, default="success")
    trigger_type = Column(String(20), nullable=False, default="manual")
    records_found = Column(Integer, nullable=True)
    records_mapped = Column(Integer, nullable=True)
    error_message = Column(Text)
    started_at = Column(DateTime(timezone=True), server_default=func.now())
