from sqlalchemy import Column, String, Text, DateTime, func
from app.db.base import Base


class VisualSession(Base):
    __tablename__ = "sismico_visual_session"
    token_hash = Column(String(64), primary_key=True)
    username = Column(String(80), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)


class VisualLayout(Base):
    __tablename__ = "sismico_visual_layout"
    username = Column(String(80), primary_key=True)
    map_code = Column(String(80), primary_key=True)
    value = Column(Text, nullable=False)
    updated_by = Column(String(80), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
