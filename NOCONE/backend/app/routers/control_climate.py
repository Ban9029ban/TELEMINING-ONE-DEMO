from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import bindparam, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.types import Float, Integer, String

from app.db.db import get_db

router = APIRouter(prefix="/control/climate", tags=["climate"])


def _resolve_time_window(
    start_date: date | None,
    end_date: date | None,
    hours: int,
) -> tuple[datetime, datetime]:
    if start_date is not None or end_date is not None:
        if start_date is None:
            start_date = end_date
        if end_date is None:
            end_date = start_date
        if start_date > end_date:
            start_date, end_date = end_date, start_date

        start_dt = datetime.combine(start_date, datetime.min.time())
        end_dt = datetime.combine(end_date + timedelta(days=1), datetime.min.time())
        return start_dt, end_dt

    end_dt = datetime.utcnow()
    start_dt = end_dt - timedelta(hours=hours)
    return start_dt, end_dt


@router.get("/anomalias-climaticas")
async def anomalias_climaticas(
    hours: int = Query(default=24, ge=1, le=24 * 30),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    nivel: str | None = Query(default=None),
    portico_id: int | None = Query(default=None),
    var_code: str = Query(default="TEMP"),
    min_value: float | None = Query(default=18.0),
    max_value: float | None = Query(default=27.0),
    db: AsyncSession = Depends(get_db),
):
    """
    Devuelve lecturas fuera de rango para la variable consultada.
    Si viene start_date/end_date, se prioriza ese rango; si no, usa la ventana en horas.
    """

    start_dt, end_dt = _resolve_time_window(start_date, end_date, hours)

    sql = (
        text(
            """
            WITH base AS (
              SELECT
                p.id AS portico_id,
                p.name AS portico_name,
                p.zone AS ur,
                p.nivel AS nivel,
                v.code AS var_code,
                r.ts AS ts,
                r.value AS value
              FROM access_portico_climate_reading r
              JOIN access_climate_var v ON v.id = r.climate_var_id
              JOIN access_portico p ON p.id = r.portico_id
              WHERE p.has_climate = TRUE
                AND v.code = :var_code
                AND r.ts >= :start_dt
                AND r.ts < :end_dt
                AND (:nivel IS NULL OR p.nivel = :nivel)
                AND (:portico_id IS NULL OR p.id = :portico_id)
            )
            SELECT
              portico_id,
              portico_name,
              ur,
              nivel,
              nivel AS level,
              var_code,
              to_char(ts, 'YYYY-MM-DD"T"HH24:MI:SS') AS ts,
              value,
              CASE
                WHEN (:min_value IS NOT NULL AND value < :min_value) THEN :min_value
                WHEN (:max_value IS NOT NULL AND value > :max_value) THEN :max_value
                ELSE NULL
              END AS threshold,
              CASE
                WHEN (:min_value IS NOT NULL AND value < :min_value) THEN 'LOW'
                WHEN (:max_value IS NOT NULL AND value > :max_value) THEN 'HIGH'
                ELSE NULL
              END AS severity
            FROM base
            WHERE (
              (:min_value IS NOT NULL AND value < :min_value)
              OR
              (:max_value IS NOT NULL AND value > :max_value)
            )
            ORDER BY ts DESC
            LIMIT 2000;
            """
        ).bindparams(
            bindparam("start_dt"),
            bindparam("end_dt"),
            bindparam("nivel", type_=String),
            bindparam("portico_id", type_=Integer),
            bindparam("var_code", type_=String),
            bindparam("min_value", type_=Float),
            bindparam("max_value", type_=Float),
        )
    )

    res = await db.execute(
        sql,
        {
            "start_dt": start_dt,
            "end_dt": end_dt,
            "nivel": nivel,
            "portico_id": portico_id,
            "var_code": var_code,
            "min_value": min_value,
            "max_value": max_value,
        },
    )

    return {"items": [dict(r) for r in res.mappings().all()]}


@router.get("/eventos-quemada")
async def eventos_quemada(
    hours: int = Query(default=24, ge=1, le=24 * 30),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    nivel: str | None = Query(default=None),
    portico_id: int | None = Query(default=None),
    var_code: str = Query(default="TEMP"),
    threshold: float = Query(default=27.0),
    min_minutes: int = Query(default=2, ge=1, le=60),
    gap_minutes: int = Query(default=5, ge=1, le=60),
    db: AsyncSession = Depends(get_db),
):
    """
    Agrupa segmentos consecutivos sobre umbral dentro del rango consultado.
    """

    start_dt, end_dt = _resolve_time_window(start_date, end_date, hours)

    sql = (
        text(
            """
            WITH base AS (
              SELECT
                p.id AS portico_id,
                p.name AS portico_name,
                p.zone AS ur,
                p.nivel AS nivel,
                v.code AS var_code,
                r.ts AS ts,
                r.value AS value
              FROM access_portico_climate_reading r
              JOIN access_climate_var v ON v.id = r.climate_var_id
              JOIN access_portico p ON p.id = r.portico_id
              WHERE p.has_climate = TRUE
                AND v.code = :var_code
                AND r.ts >= :start_dt
                AND r.ts < :end_dt
                AND (:nivel IS NULL OR p.nivel = :nivel)
                AND (:portico_id IS NULL OR p.id = :portico_id)
            ),
            hot AS (
              SELECT *
              FROM base
              WHERE value > :threshold
            ),
            ordered AS (
              SELECT
                *,
                LAG(ts) OVER (PARTITION BY portico_id ORDER BY ts) AS prev_ts
              FROM hot
            ),
            marks AS (
              SELECT
                *,
                CASE
                  WHEN prev_ts IS NULL THEN 1
                  WHEN ts - prev_ts > (CAST(:gap_minutes AS integer) * interval '1 minute') THEN 1
                  ELSE 0
                END AS is_new_segment
              FROM ordered
            ),
            segments AS (
              SELECT
                *,
                SUM(is_new_segment) OVER (
                  PARTITION BY portico_id
                  ORDER BY ts
                  ROWS UNBOUNDED PRECEDING
                ) AS segment_id
              FROM marks
            ),
            segment_agg AS (
              SELECT
                portico_id,
                portico_name,
                ur,
                nivel,
                var_code,
                segment_id,
                MIN(ts) AS start_ts,
                MAX(ts) AS end_ts,
                MAX(value) AS peak_value,
                EXTRACT(EPOCH FROM (MAX(ts) - MIN(ts))) / 60.0 AS duration_min
              FROM segments
              GROUP BY portico_id, portico_name, ur, nivel, var_code, segment_id
            ),
            valid AS (
              SELECT *
              FROM segment_agg
              WHERE duration_min >= CAST(:min_minutes AS integer)
            )
            SELECT
              portico_id,
              portico_name,
              ur,
              nivel,
              var_code,
              :threshold AS threshold,
              COUNT(*)::int AS eventos_quemada,
              ROUND(SUM(duration_min)::numeric, 2)::float AS total_minutos,
              ROUND(MAX(peak_value)::numeric, 2)::float AS peak_value,
              to_char(MAX(end_ts), 'YYYY-MM-DD"T"HH24:MI:SS') AS last_event_ts
            FROM valid
            GROUP BY portico_id, portico_name, ur, nivel, var_code
            ORDER BY eventos_quemada DESC, total_minutos DESC, ur ASC, portico_id ASC;
            """
        ).bindparams(
            bindparam("start_dt"),
            bindparam("end_dt"),
            bindparam("nivel", type_=String),
            bindparam("portico_id", type_=Integer),
            bindparam("var_code", type_=String),
            bindparam("threshold", type_=Float),
            bindparam("min_minutes", type_=Integer),
            bindparam("gap_minutes", type_=Integer),
        )
    )

    res = await db.execute(
        sql,
        {
            "start_dt": start_dt,
            "end_dt": end_dt,
            "nivel": nivel,
            "portico_id": portico_id,
            "var_code": var_code,
            "threshold": threshold,
            "min_minutes": min_minutes,
            "gap_minutes": gap_minutes,
        },
    )

    return {"items": [dict(r) for r in res.mappings().all()]}
