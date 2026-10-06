from sqlalchemy import Column, BigInteger, String, Boolean, DateTime, Text, ForeignKey, func
from app.db.base import Base

class RemoteSource(Base):
    __tablename__ = "remote_source"
    id = Column(BigInteger, primary_key=True)
    site_id = Column(BigInteger, ForeignKey("site.id"), nullable=True)
    code = Column(String(80), unique=True, nullable=False)
    name = Column(String(150), nullable=False)
    source_type = Column(String(50), nullable=False, default="api_rest")
    base_url = Column(Text)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
