from sqlalchemy import Column, BigInteger, String, Boolean, DateTime, func
from app.db.base import Base

class Organization(Base):
    __tablename__ = "organization"
    id = Column(BigInteger, primary_key=True)
    code = Column(String(50), unique=True, nullable=False)
    name = Column(String(150), nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
