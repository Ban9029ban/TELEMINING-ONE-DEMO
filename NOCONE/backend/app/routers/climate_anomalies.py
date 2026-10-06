# app/routers/climate_anomalies.py
from datetime import date
from typing import Optional, List

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.db.db import get_db

router = APIRouter(
    prefix="/observability/climate",
    tags=["Climate"],
)

# -----------------------------------------------------------
# 1) Pórticos disponibles (sólo los que tengan sensores clima)
#    Ej: "Pórtico 2", "Pórtico 3", "PÓRTICO INGRESO"
# -----------------------------------------------------------
@router.get("/ports", response_model=List[str])
async def get_climate_ports(db: AsyncSession = Depends(get_db)):
    """
    Devuelve la lista de pórticos que tienen clima configurado.
    Basado en access_portico_climate_cfg.
    """
    sql = text(
        """
        SELECT DISTINCT ap.name
        FROM access_portico ap
        JOIN access_portico_climate_cfg cfg
          ON cfg.portico_id = ap.id
        WHERE cfg.active = TRUE
        ORDER BY ap.name;
        """
    )

    result = await db.execute(sql)
    ports = [row[0] for row in result.fetchall()]
    return ports


# -----------------------------------------------------------
# 2) Anomalías de clima (temperatura / CO2)
#    /api/observability/climate/anomalies?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
#       &tipo=temperatura|co2[&portico=P%C3%B3rtico%202]
# -----------------------------------------------------------
@router.get("/anomalies")
async def get_climate_anomalies(
    desde: date = Query(...),
    hasta: date = Query(...),
    tipo: str = Query("temperatura"),
    portico: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Devuelve lecturas de clima (TEMP / CO2) marcando las anomalías (level='red').
    """

    # Mapear tipo → código de variable de clima
    tipo = tipo.lower()
    climate_code = "TEMP" if tipo == "temperatura" else "CO2"

    sql = """
        SELECT
            ap.name           AS zone_name,
            r.value           AS value,
            r.ts              AS timestamp,
            (r.level = 'red') AS is_anomaly
        FROM access_portico_climate_reading r
        JOIN access_portico ap
          ON ap.id = r.portico_id
        JOIN access_climate_var cv
          ON cv.id = r.climate_var_id
        WHERE cv.code = :climate_code
          AND r.ts::date BETWEEN :desde AND :hasta
    """

    params = {
        "climate_code": climate_code,
        "desde": desde,
        "hasta": hasta,
    }

    # Si viene un nombre de pórtico, agregamos filtro
    if portico is not None and portico != "":
        sql += " AND ap.name = :portico_name"
        params["portico_name"] = portico

    sql += " ORDER BY r.ts"

    result = await db.execute(text(sql), params)
    rows = result.mappings().all()

    # rows ya viene como [{zone_name, value, timestamp, is_anomaly}, ...]
    return list(rows)
