from sqlalchemy import Column, BigInteger, String, Boolean, DateTime, ForeignKey, Text, func
from app.db.base import Base


class SiteMap(Base):
    __tablename__ = "site_map"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    site_id = Column(BigInteger, ForeignKey("site.id"), nullable=False)
    code = Column(String(80), nullable=False)
    name = Column(String(150), nullable=False)
    image_url = Column(Text)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
