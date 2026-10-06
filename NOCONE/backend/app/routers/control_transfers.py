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
    q = await db.execute(
        text(
            """
            SELECT to_char(date_trunc('hour', ts_ingested),
                           'YYYY-MM-DD"T"HH24:MI:SSZ') AS bucket,
                   count(*)::int
            FROM access_event
            GROUP BY 1
            ORDER BY 1;
            """
        )
    )
    rows = q.fetchall()
    return {"labels": [r[0] for r in rows], "data": [r[1] for r in rows]}


# ============================================================
#  ✅ CORRECTO: URStayChart.jsx espera ARRAY (no {labels,data})
#     /control/transfers/new-permanencias
# ============================================================
@router.get("/new-permanencias")
async def new_permanencias(
    start_date: date | None = Query(default=None),      # "YYYY-MM-DD"
    end_date: date | None = Query(default=None),        # "YYYY-MM-DD"
    nivel: str | None = Query(default=None),           # ej: "NP"
    portico_id: int | None = Query(default=None),      # ej: 3
    entity_type: str | None = Query(default=None),     # "person" | "vehicle" | "equipment" (opcional)
    entity_id: int | None = Query(default=None),       # filtro por entidad (opcional)
    db: AsyncSession = Depends(get_db),
):
    """
    Permanencias (dwell time) por sesiones para URStayChart.jsx

    Regla:
    - Sesión continua si el mismo TAG tiene lecturas con gap <= 20 min
    - gap > 20 min => nueva sesión
    - Duración mínima: 3 minutos (aunque haya 1 sola lectura)

    Nota técnica:
    - asyncpg falla con "AmbiguousParameterError" si haces ":param IS NULL"
      sin tipar. Por eso aquí usamos CAST(:param AS tipo) IS NULL.
    """

    sql = text(
        """
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
          WHERE
            (
              CAST(:start_date AS date) IS NULL
              OR COALESCE(ae.ts_edge, ae.ts_ingested) >= (CAST(:start_date AS date))::timestamp
            )
            AND (
              CAST(:end_date AS date) IS NULL
              OR COALESCE(ae.ts_edge, ae.ts_ingested) < ((CAST(:end_date AS date) + INTERVAL '1 day'))::timestamp
            )
            AND (
              CAST(:nivel AS text) IS NULL
              OR ap.nivel = CAST(:nivel AS text)
            )
            AND (
              CAST(:portico_id AS integer) IS NULL
              OR ap.id = CAST(:portico_id AS integer)
            )
            AND (
              CAST(:entity_type AS text) IS NULL
              OR ta.entity_type = CAST(:entity_type AS text)
            )
            AND (
              CAST(:entity_id AS bigint) IS NULL
              OR ta.entity_id = CAST(:entity_id AS bigint)
            )
            AND ta.entity_id IS NOT NULL
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
            (sa.entity_type || ':' || sa.entity_id::text)
          ) AS entity_name,
          sa.entity_type,
          sa.entity_id::text AS entity_id
        FROM sess_agg sa
        LEFT JOIN LATERAL (
          SELECT a.display_name
          FROM tag_assignment a
          WHERE a.active = TRUE
            AND a.entity_type = sa.entity_type
            AND a.entity_id = sa.entity_id
            AND a.display_name IS NOT NULL
          ORDER BY a.updated_at DESC NULLS LAST, a.created_at DESC
          LIMIT 1
        ) ta_disp ON TRUE
        LEFT JOIN person p
          ON p.id = sa.entity_id AND sa.entity_type = 'person'
        LEFT JOIN vehicles v
          ON v.id = sa.entity_id AND sa.entity_type = 'vehicle'
        ORDER BY sa.inicio_ts DESC
        LIMIT 1000;
        """
    )

    res = await db.execute(
        sql,
        {
            "start_date": start_date,
            "end_date": end_date,
            "nivel": nivel,
            "portico_id": portico_id,
            "entity_type": entity_type,
            "entity_id": entity_id,
        },
    )

    # ✅ ARRAY directo (esto es lo que URStayChart.jsx consume)
    return [dict(r) for r in res.mappings().all()]
