from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from datetime import date

from app.db.db import get_db  # conexión async

router = APIRouter(prefix="/control/transfers", tags=["transfers"])


@router.get("/new-transfers")
async def new_transfers(db: AsyncSession = Depends(get_db)):
    """
    (Este endpoint lo dejo tal como venía; si no lo usas, puedes ignorarlo)
    Cuenta de eventos por hora, formato {labels, data}.
    """
    q = await db.execute(text("""
        SELECT to_char(date_trunc('hour', ts_ingested),
                       'YYYY-MM-DD"T"HH24:MI:SSZ') AS bucket,
               count(*)::int
        FROM access_event
        GROUP BY 1
        ORDER BY 1;
    """))
    rows = q.fetchall()
    return {"labels": [r[0] for r in rows], "data": [r[1] for r in rows]}


# ============================================================
#  ✅ URStayChart.jsx espera ARRAY
#     /control/transfers/new-permanencias
# ============================================================
@router.get("/new-permanencias")
async def new_permanencias(
    start_date: date | None = Query(default=None),      # "YYYY-MM-DD"
    end_date: date | None = Query(default=None),        # "YYYY-MM-DD"
    nivel: str | None = Query(default=None),           # ej: "NP"
    portico_id: int | None = Query(default=None),      # ej: 3
    entity_type: str | None = Query(default=None),     # "person" | "vehicle" | "equipment" (opcional)
    entity_id: int | None = Query(default=None),        # filtro por entidad (opcional)
    db: AsyncSession = Depends(get_db),
):
    """
    Permanencias (dwell time) por sesiones para URStayChart.jsx

    Regla:
    - Sesión continua si el mismo TAG tiene lecturas con gap <= 20 min
    - gap > 20 min => nueva sesión
    - Duración mínima: 3 minutos (aunque haya 1 sola lectura)
    """

    # -------- WHERE dinámico (evita AmbiguousParameterError cuando params vienen None) -----
    where = []
    params: dict = {}

    if start_date:
        where.append("COALESCE(ae.ts_edge, ae.ts_ingested) >= (CAST(:start_date AS date))::timestamp")
        params["start_date"] = start_date

    if end_date:
        where.append("COALESCE(ae.ts_edge, ae.ts_ingested) < ((CAST(:end_date AS date) + INTERVAL '1 day'))::timestamp")
        params["end_date"] = end_date

    if nivel:
        where.append("ap.nivel = :nivel")
        params["nivel"] = nivel

    if portico_id is not None:
        where.append("ap.id = :portico_id")
        params["portico_id"] = portico_id

    if entity_type:
        where.append("ta.entity_type = :entity_type")
        params["entity_type"] = entity_type

    if entity_id is not None:
        where.append("ta.entity_id = :entity_id")
        params["entity_id"] = entity_id

    # solo entidades asignadas
    where.append("ta.entity_id IS NOT NULL")

    where_sql = "WHERE " + " AND ".join(where) if where else ""

    sql = text(f"""
    WITH ev AS (
      SELECT
        ap.id AS portico_id,
        ap.zone AS ur,
        ap.nivel AS nivel,
        ae.tag_id,
        ta.entity_type,
        ta.entity_id,
        COALESCE(ae.ts_edge, ae.ts_ingested) AS ts
      FROM access_event ae
      JOIN access_portico ap
        ON ap.gateway_id = ae.gateway_id
       AND ap.active = TRUE
      LEFT JOIN tag_assignment ta
        ON ta.tag_id = ae.tag_id
       AND ta.active = TRUE
      {where_sql}
    ),
    w AS (
      SELECT
        *,
        LAG(ts) OVER (PARTITION BY portico_id, tag_id ORDER BY ts) AS prev_ts
      FROM ev
    ),
    marks AS (
      SELECT
        *,
        CASE
          WHEN prev_ts IS NULL THEN 1
          WHEN ts - prev_ts > interval '20 minutes' THEN 1
          ELSE 0
        END AS is_new_session
      FROM w
    ),
    sessions AS (
      SELECT
        *,
        SUM(is_new_session) OVER (
          PARTITION BY portico_id, tag_id
          ORDER BY ts
          ROWS UNBOUNDED PRECEDING
        ) AS session_id
      FROM marks
    ),
    sess_agg AS (
      SELECT
        portico_id,
        ur,
        nivel,
        entity_type,
        entity_id,
        MIN(ts) AS inicio_ts,
        MAX(ts) AS fin_ts,
        GREATEST(
          3,
          CEIL(EXTRACT(EPOCH FROM (MAX(ts) - MIN(ts))) / 60.0)
        )::int AS duracion_minutos
      FROM sessions
      GROUP BY portico_id, ur, nivel, entity_type, entity_id, tag_id, session_id
    )
    SELECT
      sa.portico_id,
      sa.ur,
      sa.nivel,
      to_char(sa.inicio_ts, 'YYYY-MM-DD"T"HH24:MI:SS') AS inicio,
      sa.duracion_minutos,
      COALESCE(p.full_name, v.patente, (sa.entity_type || ':' || sa.entity_id::text)) AS entity_name,
      sa.entity_type,
      sa.entity_id::text AS entity_id
    FROM sess_agg sa
    LEFT JOIN person p
      ON p.id = sa.entity_id AND sa.entity_type = 'person'
    LEFT JOIN vehicles v
      ON v.id = sa.entity_id AND sa.entity_type = 'vehicle'
    ORDER BY sa.inicio_ts DESC
    LIMIT 1000;
    """)

    res = await db.execute(sql, params)
    return [dict(r) for r in res.mappings().all()]


# ============================================================
#  ✅ TransferTimesCharts.jsx espera ARRAY
#     /control/transfers/new-traslados
#     (dispersión: minutos vs secuencia)
# ============================================================
@router.get("/new-traslados")
async def new_traslados(
    start_date: date | None = Query(default=None),        # "YYYY-MM-DD"
    end_date: date | None = Query(default=None),          # "YYYY-MM-DD"
    from_portico_id: int | None = Query(default=None),   # origen (opcional)
    to_portico_id: int | None = Query(default=None),     # destino (opcional)
    entity_type: str | None = Query(default=None),       # "person" | "vehicle" | "equipment" (opcional)
    entity_id: int | None = Query(default=None),          # filtro por entidad (opcional)
    db: AsyncSession = Depends(get_db),
):
    """
    Traslados entre pórticos (URs), estimados por transiciones de sesión.

    Pipeline:
    1) Normaliza lecturas por (entidad, pórtico) -> sesiones (gap <= 20 min)
    2) Ordena sesiones por entidad y detecta cambio de pórtico -> traslado
    3) Tiempo traslado = (inicio_sesion_destino - fin_sesion_origen) en minutos

    Devuelve ARRAY (no {labels,data}) compatible con TransferTimesCharts.jsx:
    - time (minutos)
    - timestamp (inicio traslado)
    - end_timestamp (fin traslado)
    - device_name / entidad
    - location_name/location_id (origen)
    - destiny_name/destiny_id (destino)
    """

    # -------- WHERE dinámico (evita AmbiguousParameterError) -----
    where = []
    params: dict = {}

    if start_date:
        where.append("COALESCE(ae.ts_edge, ae.ts_ingested) >= (CAST(:start_date AS date))::timestamp")
        params["start_date"] = start_date

    if end_date:
        where.append("COALESCE(ae.ts_edge, ae.ts_ingested) < ((CAST(:end_date AS date) + INTERVAL '1 day'))::timestamp")
        params["end_date"] = end_date

    if entity_type:
        where.append("ta.entity_type = :entity_type")
        params["entity_type"] = entity_type

    if entity_id is not None:
        where.append("ta.entity_id = :entity_id")
        params["entity_id"] = entity_id

    # solo entidades asignadas
    where.append("ta.entity_id IS NOT NULL")

    where_sql = "WHERE " + " AND ".join(where) if where else ""

    # filtros extra a nivel de traslado (origen/destino)
    tr_where = []
    if from_portico_id is not None:
        tr_where.append("t.from_portico_id = :from_portico_id")
        params["from_portico_id"] = from_portico_id
    if to_portico_id is not None:
        tr_where.append("t.to_portico_id = :to_portico_id")
        params["to_portico_id"] = to_portico_id

    tr_where_sql = "WHERE " + " AND ".join(tr_where) if tr_where else ""

    sql = text(f"""
    WITH ev AS (
      SELECT
        ap.id   AS portico_id,
        ap.name AS portico_name,
        ap.zone AS ur,
        ae.tag_id,
        ta.entity_type,
        ta.entity_id,
        COALESCE(ae.ts_edge, ae.ts_ingested) AS ts
      FROM access_event ae
      JOIN access_portico ap
        ON ap.gateway_id = ae.gateway_id
       AND ap.active = TRUE
      LEFT JOIN tag_assignment ta
        ON ta.tag_id = ae.tag_id
       AND ta.active = TRUE
      {where_sql}
    ),
    w AS (
      SELECT
        *,
        LAG(ts) OVER (PARTITION BY tag_id, portico_id ORDER BY ts) AS prev_ts_same_portico
      FROM ev
    ),
    marks AS (
      SELECT
        *,
        CASE
          WHEN prev_ts_same_portico IS NULL THEN 1
          WHEN ts - prev_ts_same_portico > interval '20 minutes' THEN 1
          ELSE 0
        END AS is_new_session
      FROM w
    ),
    sessions AS (
      SELECT
        *,
        SUM(is_new_session) OVER (
          PARTITION BY tag_id, portico_id
          ORDER BY ts
          ROWS UNBOUNDED PRECEDING
        ) AS session_id
      FROM marks
    ),
    sess_agg AS (
      SELECT
        tag_id,
        entity_type,
        entity_id,
        portico_id,
        portico_name,
        ur,
        session_id,
        MIN(ts) AS start_ts,
        MAX(ts) AS end_ts
      FROM sessions
      GROUP BY tag_id, entity_type, entity_id, portico_id, portico_name, ur, session_id
    ),
    ordered AS (
      SELECT
        *,
        LAG(portico_id)   OVER (PARTITION BY entity_type, entity_id ORDER BY start_ts) AS prev_portico_id,
        LAG(portico_name) OVER (PARTITION BY entity_type, entity_id ORDER BY start_ts) AS prev_portico_name,
        LAG(ur)           OVER (PARTITION BY entity_type, entity_id ORDER BY start_ts) AS prev_ur,
        LAG(end_ts)       OVER (PARTITION BY entity_type, entity_id ORDER BY start_ts) AS prev_end_ts
      FROM sess_agg
    ),
    t AS (
      SELECT
        entity_type,
        entity_id AS entity_id,
        entity_id::text AS entity_id_txt,

        prev_portico_id   AS from_portico_id,
        prev_portico_name AS from_portico_name,
        prev_ur           AS from_ur,

        portico_id        AS to_portico_id,
        portico_name      AS to_portico_name,
        ur                AS to_ur,

        prev_end_ts       AS ts_start,
        start_ts          AS ts_end,

        GREATEST(
          0,
          CEIL(EXTRACT(EPOCH FROM (start_ts - prev_end_ts)) / 60.0)
        )::int AS minutes
      FROM ordered
      WHERE prev_portico_id IS NOT NULL
        AND prev_portico_id <> portico_id
        AND prev_end_ts IS NOT NULL
        AND start_ts >= prev_end_ts
    )
    SELECT
      -- compat con TransferTimesCharts.jsx
      minutes                           AS time,
      to_char(ts_start, 'YYYY-MM-DD"T"HH24:MI:SS') AS timestamp,
      to_char(ts_end,   'YYYY-MM-DD"T"HH24:MI:SS') AS end_timestamp,
      COALESCE(
        CASE WHEN ta_disp.display_name IS NOT NULL AND POSITION(' ' IN ta_disp.display_name) > 0 THEN ta_disp.display_name END,
        p.full_name,
        CASE
          WHEN v.status IS NOT NULL
           AND v.status NOT IN ('online','offline')
           AND v.patente IS NOT NULL
          THEN (v.status || ' ' || v.patente)
          ELSE v.patente
        END,
        (t.entity_type || ':' || t.entity_id_txt)
      ) AS device_name,
      from_ur                            AS location_name,
      (from_portico_name || ' (#' || from_portico_id::text || ')') AS location_id,
      to_ur                              AS destiny_name,
      (to_portico_name   || ' (#' || to_portico_id::text   || ')') AS destiny_id,
      to_char(ts_start::date, 'YYYY-MM-DD') AS fecha,
      t.entity_type,
      t.entity_id_txt AS entity_id,

      -- extra (por si después lo ocupas en tabla/export)
      from_portico_id,
      to_portico_id
    FROM t
    LEFT JOIN LATERAL (
      SELECT a.display_name
      FROM tag_assignment a
      WHERE a.active = TRUE
        AND a.entity_type = t.entity_type
        AND a.entity_id = t.entity_id
        AND a.display_name IS NOT NULL
      ORDER BY a.updated_at DESC NULLS LAST, a.created_at DESC
      LIMIT 1
    ) ta_disp ON TRUE
    LEFT JOIN person p
      ON p.id = t.entity_id AND t.entity_type = 'person'
    LEFT JOIN vehicles v
      ON v.id = t.entity_id AND t.entity_type = 'vehicle'
    {tr_where_sql}
    ORDER BY ts_start DESC
    LIMIT 2000;
    """)

    res = await db.execute(sql, params)
    return [dict(r) for r in res.mappings().all()]
