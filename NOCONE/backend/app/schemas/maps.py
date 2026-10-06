from typing import Optional, List, Any
from pydantic import BaseModel, Field

# --------- Puntos ---------
class MapPointBase(BaseModel):
    site: str
    nivel: Optional[str] = None
    name: Optional[str] = None
    lat: float
    lng: float
    tipo: Optional[str] = None

class MapPointCreate(MapPointBase):
    pass

class MapPointUpdate(BaseModel):
    site: Optional[str] = None
    nivel: Optional[str] = None
    name: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    tipo: Optional[str] = None

class MapPointOut(MapPointBase):
    id: int

# --------- Polígonos ---------
class MapPolygonBase(BaseModel):
    site: str
    nivel: Optional[str] = None
    name: Optional[str] = None
    geojson: Any = Field(..., description="GeoJSON Feature o FeatureCollection")

class MapPolygonCreate(MapPolygonBase):
    pass

class MapPolygonUpdate(BaseModel):
    site: Optional[str] = None
    nivel: Optional[str] = None
    name: Optional[str] = None
    geojson: Optional[Any] = None

class MapPolygonOut(MapPolygonBase):
    id: int

# --------- Respuestas varias ---------
class SuggestionOut(BaseModel):
    suggestions: List[str]

class SitesOut(BaseModel):
    sites: List[str]

class LevelsOut(BaseModel):
    levels: List[str]
