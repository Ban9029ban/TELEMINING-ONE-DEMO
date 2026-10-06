from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.db.db import get_db

router = APIRouter(prefix="/control/visual", tags=["visual"])


@router.get("/actualizar_variables_ur_view")
async def actualizar_variables_ur_view(db: AsyncSession = Depends(get_db)):
    q = await db.execute(text("""
        SELECT ur_id, nombre, estado, sensores_online, sensores_total
        FROM view_ur_estado;  -- crea esto en tu DB o ajusta la tabla real
    """))

    rows = q.fetchall()

    return {
        "items": [
            {
                "ur_id": r[0],
                "nombre": r[1],
                "estado": r[2],
                "sensores_online": r[3],
                "sensores_total": r[4]
            }
            for r in rows
        ]
    }
