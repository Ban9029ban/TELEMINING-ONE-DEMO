from sqlalchemy import Column, BigInteger, String, Boolean, DateTime, ForeignKey, func
from app.db.base import Base

class Site(Base):
    __tablename__ = "site"
    id = Column(BigInteger, primary_key=True)
    organization_id = Column(BigInteger, ForeignKey("organization.id"), nullable=False)
    code = Column(String(50), nullable=False)
    name = Column(String(150), nullable=False)
    timezone = Column(String(80), default="America/Santiago")
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
