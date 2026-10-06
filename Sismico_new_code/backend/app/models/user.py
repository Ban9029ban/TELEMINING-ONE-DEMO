from sqlalchemy import Column, BigInteger, String, Boolean, DateTime, func
from app.db.base import Base

class AppUser(Base):
    __tablename__ = "app_user"
    id = Column(BigInteger, primary_key=True)
    username = Column(String(80), unique=True, nullable=False)
    full_name = Column(String(180), nullable=False)
    password_hash = Column(String(255), nullable=False)
    role_code = Column(String(40), nullable=False, default="viewer")
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
