# backend/app/models.py
from __future__ import annotations
import uuid
from typing import Optional
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import Boolean, Column, Float, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy import String

class Base(DeclarativeBase): pass

class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String)  # bcrypt ($2a/$2b/$2y)
    role: Mapped[Optional[str]] = mapped_column(String, nullable=True)

# -------------------------------------------------------------------
# NUEVOS MODELOS PARA CÁMARAS / VIDEOS Y MODELOS IA
# -------------------------------------------------------------------

class CameraVideo(Base):
    __tablename__ = "camera_video"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    source = Column(String, nullable=False, default="")
    source_type = Column(String, nullable=False, default="video_file")
    camera_ip = Column(String, nullable=True)
    camera_port = Column(Integer, nullable=True)
    camera_path = Column(String, nullable=True)
    camera_user = Column(String, nullable=True)
    camera_password = Column(String, nullable=True)
    site = Column(String, nullable=True)
    nivel = Column(String, nullable=True)
    map_code = Column(String, nullable=True)
    x_pct = Column(Float, nullable=True)
    y_pct = Column(Float, nullable=True)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)


class AiModel(Base):
    __tablename__ = "ai_model"

    id = Column(Integer, primary_key=True, index=True)
    # código que usará el front: "person_detection", "person_count", etc.
    code = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
