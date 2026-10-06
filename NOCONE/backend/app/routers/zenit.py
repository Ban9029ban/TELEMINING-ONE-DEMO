from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.db import get_db

router = APIRouter(prefix="/zenit", tags=["zenit"])


@router.get("/urs-con-sensores")
async def urs_con_sensores(db: AsyncSession = Depends(get_db)):
    """
    Devuelve solo los porticos que tienen sensores de clima configurados
    (TEMP / CO2). Se usa en el select del grafico de anomalias de clima.
    """
    sql = text(
        """
        SELECT DISTINCT
            ap.id::text AS uuid,
            ap.name     AS name
        FROM access_portico ap
        JOIN access_portico_climate_cfg cfg
              ON cfg.portico_id = ap.id
             AND cfg.active = TRUE
        JOIN access_climate_var cv
              ON cv.id = cfg.climate_var_id
             AND cv.code IN ('TEMP', 'CO2')
        WHERE ap.active = TRUE
          AND ap.name ILIKE '%clima%'
        ORDER BY ap.name;
        """
    )

    result = await db.execute(sql)
    return list(result.mappings().all())


@router.get("/urs-con-btcs")
async def urs_con_btcs(db: AsyncSession = Depends(get_db)):
    q = await db.execute(
        text(
            """
            SELECT ur_id, nombre, btcs_operativas, btcs_total
            FROM view_ur_btcs;
            """
        )
    )

    rows = q.fetchall()
    return [
        {
            "ur_id": r[0],
            "nombre": r[1],
            "operativas": r[2],
            "total": r[3],
        }
        for r in rows
    ]


@router.get("/selector-cargos")
async def selector_cargos(db: AsyncSession = Depends(get_db)):
    """
    Devuelve lista real de cargos disponibles en la base para el Agente IA.
    """
    q = await db.execute(
        text(
            """
            SELECT DISTINCT TRIM(position) AS nombre
            FROM person
            WHERE active = TRUE
              AND NULLIF(TRIM(position), '') IS NOT NULL
            ORDER BY nombre;
            """
        )
    )
    cargos = [{"id": r["nombre"], "nombre": r["nombre"]} for r in q.mappings().all()]
    return {"items": cargos}


@router.get("/selector-zonas")
async def selector_zonas(db: AsyncSession = Depends(get_db)):
    """
    Devuelve lista real de zonas / URs visibles para el Agente IA.
    """
    q = await db.execute(
        text(
            """
            SELECT DISTINCT
                COALESCE(NULLIF(TRIM(zone), ''), 'SIN_ZONA') AS id,
                COALESCE(NULLIF(TRIM(zone), ''), 'Sin zona informada') AS nombre
            FROM access_portico
            WHERE active = TRUE
            ORDER BY nombre;
            """
        )
    )
    return {"items": [dict(r) for r in q.mappings().all()]}


@router.get("/selector-sitios")
async def selector_sitios(db: AsyncSession = Depends(get_db)):
    """
    Devuelve los sitios/faenas disponibles para filtrar vistas del Agente IA.
    """
    q = await db.execute(
        text(
            """
            SELECT DISTINCT
                TRIM(site) AS id,
                TRIM(site) AS nombre
            FROM access_portico
            WHERE active = TRUE
              AND NULLIF(TRIM(site), '') IS NOT NULL
            ORDER BY nombre;
            """
        )
    )
    return {"items": [dict(r) for r in q.mappings().all()]}
