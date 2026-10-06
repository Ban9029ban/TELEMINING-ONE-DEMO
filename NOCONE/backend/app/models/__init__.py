# app/models/__init__.py

from sqlalchemy.orm import declarative_base
from sqlalchemy import Boolean, Column, Float, Integer, String, Text

Base = declarative_base()

# -------------------------------------------------------
#  MODELO CameraVideo  (videos/rutas para los paneles)
# -------------------------------------------------------
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
    is_active = Column(Boolean, default=True)


# -------------------------------------------------------
#  MODELO AiModel  (modelos de IA disponibles para el front)
# -------------------------------------------------------
class AiModel(Base):
    __tablename__ = "ai_model"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=False)
    description = Column(Text)
