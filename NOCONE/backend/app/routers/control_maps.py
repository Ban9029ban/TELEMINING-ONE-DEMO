from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.db import get_session

router = APIRouter(prefix="/control/maps", tags=["Maps"])

@router.get("/devices/{map_code}")
async def get_devices(map_code: str, db: AsyncSession = Depends(get_session)):
    q = text("""
        SELECT 
            id,
            kind,
            ref_id,
            x_pct,
            y_pct
        FROM map_device
        WHERE map_code = :map_code
    """)
    res = await db.execute(q, {"map_code": map_code})

    rows = res.fetchall()
    # SQLAlchemy Row -> usar _mapping para convertir a dict correctamente
    return [dict(r._mapping) for r in rows]


@router.get("/portico-popup/{portico_id}")
async def portico_popup(portico_id: int, db: AsyncSession = Depends(get_session)):
    q = text("""
        SELECT 
            p.id,
            p.name,
            p.code,
            p.zone,
            COALESCE(pc.status, 'OK') AS status
        FROM porticos p
        LEFT JOIN portico_climate pc ON pc.portico_id = p.id
        WHERE p.id = :pid
    """)
    r = await db.execute(q, {"pid": portico_id})
    row = r.first()
    return dict(row) if row else {}


@router.get("/search-node")
async def search_node(term: str, db: AsyncSession = Depends(get_session)):
    q = text("""
        SELECT id, name, code, zone
        FROM porticos
        WHERE name ILIKE :q OR code ILIKE :q OR zone ILIKE :q
        LIMIT 20
    """)
    r = await db.execute(q, {"q": f"%{term}%"})
    return [dict(x) for x in r.fetchall()]
