from sqlalchemy import Column, BigInteger, String, Boolean, DateTime, ForeignKey, Float, Text, func
from app.db.base import Base


class PolygonUiConfig(Base):
    __tablename__ = "polygon_ui_config"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    map_object_id = Column(BigInteger, ForeignKey("map_object.id"), nullable=False, unique=True)
    control_mode = Column(String(40), nullable=False, default="manual_when_external_off")
    manual_enabled = Column(Boolean, nullable=False, default=True)
    automatic_enabled = Column(Boolean, nullable=False, default=True)
    state_set_code = Column(String(40), nullable=False, default="custom")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class PolygonUiStateOption(Base):
    __tablename__ = "polygon_ui_state_option"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    map_object_id = Column(BigInteger, ForeignKey("map_object.id"), nullable=False)
    state_code = Column(String(40), nullable=False)
    label = Column(String(80), nullable=False)
    button_color = Column(String(40), nullable=True)
    fill_color = Column(String(40), nullable=True)
    stroke_color = Column(String(40), nullable=True)
    fill_opacity = Column(Float, nullable=False, default=0.55)
    sort_order = Column(BigInteger, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
