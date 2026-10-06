from typing import List, Optional
from sqlalchemy import select, text, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.maps import MapPoint, MapPolygon
from app.schemas.maps import (
    MapPointOut, MapPointCreate, MapPointUpdate,
    MapPolygonOut, MapPolygonCreate, MapPolygonUpdate
)

# ------------------------
# Sugerencias / Catálogos
# ------------------------
async def get_sites_suggestions(db: AsyncSession, query: Optional[str], limit: int = 10) -> List[str]:
    if query:
        sql = text("""
            SELECT DISTINCT site FROM map_points WHERE site ILIKE :q
            UNION
            SELECT DISTINCT site FROM map_polygons WHERE site ILIKE :q
            ORDER BY 1 ASC LIMIT :limit
        """)
        rows = (await db.execute(sql, {"q": f"%{query}%", "limit": limit})).all()
    else:
        sql = text("""
            SELECT DISTINCT site FROM (
              SELECT site FROM map_points
              UNION
              SELECT site FROM map_polygons
            ) s ORDER BY site ASC LIMIT :limit
        """)
        rows = (await db.execute(sql, {"limit": limit})).all()
    return [r[0] for r in rows]

async def get_all_sites(db: AsyncSession) -> List[str]:
    sql = text("""
        SELECT DISTINCT site FROM (
          SELECT site FROM map_points
          UNION
          SELECT site FROM map_polygons
        ) s ORDER BY site ASC
    """)
    rows = (await db.execute(sql)).all()
    return [r[0] for r in rows]

async def get_all_levels(db: AsyncSession, site: Optional[str] = None) -> List[str]:
    if site:
        sql = text("""
            SELECT DISTINCT nivel FROM (
              SELECT nivel FROM map_points WHERE site = :site
              UNION
              SELECT nivel FROM map_polygons WHERE site = :site
            ) t WHERE nivel IS NOT NULL ORDER BY nivel ASC
        """)
        rows = (await db.execute(sql, {"site": site})).all()
    else:
        sql = text("""
            SELECT DISTINCT nivel FROM (
              SELECT nivel FROM map_points
              UNION
              SELECT nivel FROM map_polygons
            ) t WHERE nivel IS NOT NULL ORDER BY nivel ASC
        """)
        rows = (await db.execute(sql)).all()
    return [r[0] for r in rows]

# ------------------------
# Puntos
# ------------------------
async def get_points(db: AsyncSession, site: str, nivel: Optional[str]) -> List[MapPointOut]:
    stmt = select(MapPoint).where(MapPoint.site == site)
    if nivel:
        stmt = stmt.where(MapPoint.nivel == nivel)
    rows = (await db.execute(stmt.order_by(MapPoint.id.asc()))).scalars().all()
    return [MapPointOut(
        id=r.id, site=r.site, nivel=r.nivel, name=r.name,
        lat=float(r.lat), lng=float(r.lng), tipo=r.tipo
    ) for r in rows]

async def create_point(db: AsyncSession, dto: MapPointCreate) -> int:
    sql = text("""
        INSERT INTO map_points (site, nivel, name, lat, lng, tipo)
        VALUES (:site, :nivel, :name, :lat, :lng, :tipo)
        RETURNING id
    """)
    row = (await db.execute(sql, dto.model_dump())).first()
    await db.commit()
    return int(row[0])

async def update_point(db: AsyncSession, pid: int, dto: MapPointUpdate) -> bool:
    data = {k: v for k, v in dto.model_dump().items() if v is not None}
    if not data:
        return False
    stmt = update(MapPoint).where(MapPoint.id == pid).values(**data)
    res = await db.execute(stmt)
    await db.commit()
    return res.rowcount > 0

async def delete_point(db: AsyncSession, pid: int) -> bool:
    res = await db.execute(delete(MapPoint).where(MapPoint.id == pid))
    await db.commit()
    return res.rowcount > 0

# ------------------------
# Polígonos (GeoJSON)
# ------------------------
async def get_polygons(db: AsyncSession, site: str, nivel: Optional[str]) -> List[MapPolygonOut]:
    stmt = select(MapPolygon).where(MapPolygon.site == site)
    if nivel:
        stmt = stmt.where(MapPolygon.nivel == nivel)
    rows = (await db.execute(stmt.order_by(MapPolygon.id.asc()))).scalars().all()
    return [MapPolygonOut(
        id=r.id, site=r.site, nivel=r.nivel, name=r.name, geojson=r.geojson
    ) for r in rows]

async def create_polygon(db: AsyncSession, dto: MapPolygonCreate) -> int:
    sql = text("""
        INSERT INTO map_polygons (site, nivel, name, geojson)
        VALUES (:site, :nivel, :name, :geojson)
        RETURNING id
    """)
    row = (await db.execute(sql, dto.model_dump())).first()
    await db.commit()
    return int(row[0])

async def update_polygon(db: AsyncSession, pid: int, dto: MapPolygonUpdate) -> bool:
    data = {k: v for k, v in dto.model_dump().items() if v is not None}
    if not data:
        return False
    res = await db.execute(update(MapPolygon).where(MapPolygon.id == pid).values(**data))
    await db.commit()
    return res.rowcount > 0

async def delete_polygon(db: AsyncSession, pid: int) -> bool:
    res = await db.execute(delete(MapPolygon).where(MapPolygon.id == pid))
    await db.commit()
    return res.rowcount > 0
