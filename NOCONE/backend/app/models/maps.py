from sqlalchemy import Column, Integer, String, Float, Index, JSON
from app.models import Base

class MapPoint(Base):
    __tablename__ = "map_points"
    id = Column(Integer, primary_key=True, autoincrement=True)
    site = Column(String(80), index=True, nullable=False)   # "Diamante - NTI"
    nivel = Column(String(40), index=True, nullable=True)   # "NP","UCL","NTI"
    name = Column(String(120), nullable=True)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    tipo = Column(String(40), nullable=True)                # "marker","alerta", etc

Index("idx_map_points_site_nivel", MapPoint.site, MapPoint.nivel)

class MapPolygon(Base):
    __tablename__ = "map_polygons"
    id = Column(Integer, primary_key=True, autoincrement=True)
    site = Column(String(80), index=True, nullable=False)
    nivel = Column(String(40), index=True, nullable=True)
    name = Column(String(120), nullable=True)
    geojson = Column(JSON, nullable=False)                  # Feature o FeatureCollection

Index("idx_map_polygons_site_nivel", MapPolygon.site, MapPolygon.nivel)
