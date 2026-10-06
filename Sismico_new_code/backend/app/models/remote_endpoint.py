from sqlalchemy import Column, BigInteger, String, Boolean, DateTime, Text, Integer, ForeignKey, func
from app.db.base import Base

class RemoteEndpoint(Base):
    __tablename__ = "remote_endpoint"
    id = Column(BigInteger, primary_key=True)
    remote_source_id = Column(BigInteger, ForeignKey("remote_source.id"), nullable=False)
    site_id = Column(BigInteger, ForeignKey("site.id"), nullable=True)
    code = Column(String(100), unique=True, nullable=False)
    name = Column(String(180), nullable=False)
    endpoint_url = Column(Text, nullable=False)
    endpoint_kind = Column(String(50), nullable=False, default="json_api")
    polling_seconds = Column(Integer, nullable=False, default=15)
    parser_type = Column(String(50), nullable=False, default="mock")
    is_enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
