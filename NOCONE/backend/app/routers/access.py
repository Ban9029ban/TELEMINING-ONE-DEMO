# backend/app/routers/access.py
import asyncio
import logging
import os
from typing import Any, Dict, List, Optional
from datetime import date as date_type, datetime as datetime_type, timezone

from fastapi import APIRouter, Depends, Query
import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.tag_codes import normalize_tag_code
from app.db.db import async_session, get_db

router = APIRouter(prefix="/access", tags=["access"])

logger = logging.getLogger("zenit.access")

LISTENER_RFID_SUMMARY_URL = (
    os.getenv("TMONE_LISTENER_RFID_SUMMARY_URL", "http://zenit-listener:8090/rfid-summary").strip()
)

# Una lectura RFID de entrada no debe dejar una persona/vehiculo dentro para
# siempre. Si no hay ninguna lectura posterior durante dos horas, se registra
# una salida automatica y auditable en el ultimo portico observado.
PRESENCE_TIMEOUT_SECONDS = max(60, int(os.getenv("ACCESS_PRESENCE_TIMEOUT_SECONDS", "7200")))
PRESENCE_TIMEOUT_CHECK_SECONDS = max(10, int(os.getenv("ACCESS_PRESENCE_TIMEOUT_CHECK_SECONDS", "60")))
_presence_timeout_task: asyncio.Task | None = None
_presence_timeout_stop: asyncio.Event | None = None


async def close_stale_presences(db: AsyncSession) -> int:
    """Registra OUT automatico para la ultima entrada sin lecturas posteriores."""
    result = await db.execute(
        text(
            """
            WITH latest AS (
              SELECT DISTINCT ON (ae.tag_id)
                ae.tag_id,
                ae.gateway_id,
                ae.ts_edge,
                ae.ts_ingested,
                ae.signal,
                ae.rssi,
                ae.zone,
                ae.level,
                ae.kind,
                ae.extra,
                ae.direction,
                COALESCE(ae.ts_edge, ae.ts_ingested) AS last_seen
              FROM access_event ae
              JOIN tag_assignment ta
                ON ta.tag_id = ae.tag_id
               AND ta.active = TRUE
               AND ta.entity_type IN ('person', 'vehicle')
              ORDER BY ae.tag_id, COALESCE(ae.ts_edge, ae.ts_ingested) DESC, ae.id DESC
            )
            INSERT INTO access_event (
              tag_id, gateway_id, ts_edge, signal, rssi, zone, level, kind, direction, extra
            )
            SELECT
              l.tag_id,
              l.gateway_id,
              l.last_seen + (CAST(:timeout_seconds AS integer) * INTERVAL '1 second'),
              COALESCE(l.signal, 'RFID_UHF') || '_TIMEOUT',
              l.rssi,
              l.zone,
              l.level,
              COALESCE(l.kind, 'rfid'),
              'out',
              COALESCE(l.extra, '{}'::jsonb) || jsonb_build_object(
                'source', 'access_presence_timeout',
                'auto_exit', TRUE,
                'reason', 'no_readings_for_2h',
                'timeout_seconds', :timeout_seconds,
                'last_seen_at', l.last_seen
              )
            FROM latest l
            WHERE l.direction = 'in'
              AND l.last_seen <= NOW() - (CAST(:timeout_seconds AS integer) * INTERVAL '1 second')
            RETURNING id
            """
        ),
        {"timeout_seconds": PRESENCE_TIMEOUT_SECONDS},
    )
    return len(result.scalars().all())


async def _presence_timeout_loop() -> None:
    while _presence_timeout_stop is not None and not _presence_timeout_stop.is_set():
        try:
            async with async_session() as db:
                closed = await close_stale_presences(db)
                await db.commit()
                if closed:
                    logger.info("Cierre automatico de presencia aplicado a %s entidad(es)", closed)
        except Exception:
            logger.exception("Error en cierre automatico de presencias")

        try:
            await asyncio.wait_for(
                _presence_timeout_stop.wait(),
                timeout=PRESENCE_TIMEOUT_CHECK_SECONDS,
            )
        except asyncio.TimeoutError:
            pass


async def start_presence_timeout_monitor() -> None:
    global _presence_timeout_task, _presence_timeout_stop
    if _presence_timeout_task is not None and not _presence_timeout_task.done():
        return
    _presence_timeout_stop = asyncio.Event()
    _presence_timeout_task = asyncio.create_task(_presence_timeout_loop())


async def stop_presence_timeout_monitor() -> None:
    global _presence_timeout_task, _presence_timeout_stop
    if _presence_timeout_stop is not None:
        _presence_timeout_stop.set()
    task = _presence_timeout_task
    _presence_timeout_task = None
    _presence_timeout_stop = None
    if task is not None:
        await task
def _rfid_proximity_hint(rssi: Optional[int]) -> str:
    """Heurística simple: RSSI más alto (menos negativo) suele implicar mayor cercanía.

    No representa distancia exacta; depende de antena, potencia, orientación y entorno.
    """
    if rssi is None:
        return "Sin señal"
    if rssi >= -45:
        return "Muy cerca"
    if rssi >= -55:
        return "Cerca"
    if rssi >= -65:
        return "Media"
    return "Lejos"


def _normalize_tag_code(raw: Optional[str]) -> str:
    return normalize_tag_code(raw)


def _coerce_int(value: Any) -> Optional[int]:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except Exception:
        return None


def _coerce_float(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except Exception:
        return None


def _parse_iso_datetime(value: Any) -> Optional[datetime_type]:
    if not value:
        return None
    try:
        parsed = datetime_type.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


async def _lookup_tag_context(db: AsyncSession, raw_code: Optional[str]) -> Dict[str, Any]:
    normalized_code = _normalize_tag_code(raw_code)
    fallback_tag_id = f"listener-{normalized_code or 'unknown'}"
    fallback = {
        "registered": False,
        "tag_id": fallback_tag_id,
        "tag_code": raw_code or normalized_code or "-",
        "assigned_to": None,
        "entity_type": None,
        "entity_id": None,
    }
    if not normalized_code:
        return fallback

    result = await db.execute(
        text(
            """
            SELECT
              t.id::text AS tag_id,
              t.code AS tag_code,
              ta.entity_type,
              ta.entity_id,
              ta.assigned_to
            FROM tag t
            LEFT JOIN LATERAL (
              SELECT
                ta.entity_type,
                ta.entity_id,
                COALESCE(
                  CASE WHEN ta.entity_type = 'person' THEN p.full_name END,
                  CASE WHEN ta.entity_type = 'vehicle' THEN v.patente END,
                  CASE WHEN ta.entity_type = 'equipment' THEN e.name END,
                  ta.display_name
                ) AS assigned_to
              FROM tag_assignment ta
              LEFT JOIN person p
                ON ta.entity_type = 'person' AND p.id = ta.entity_id
              LEFT JOIN vehicles v
                ON ta.entity_type = 'vehicle' AND v.id = ta.entity_id
              LEFT JOIN equipment e
                ON ta.entity_type = 'equipment' AND e.id = ta.entity_id
              WHERE ta.tag_id = t.id
                AND ta.active = TRUE
              ORDER BY ta.updated_at DESC NULLS LAST, ta.id DESC
              LIMIT 1
            ) ta ON TRUE
            WHERE t.code = :code
            ORDER BY t.id
            LIMIT 1
            """
        ),
        {"code": normalized_code},
    )
    row = result.mappings().first()
    if not row:
        return fallback

    return {
        "registered": True,
        "tag_id": row["tag_id"] or fallback_tag_id,
        "tag_code": raw_code or row["tag_code"] or normalized_code,
        "assigned_to": row["assigned_to"],
        "entity_type": row["entity_type"],
        "entity_id": row["entity_id"],
    }


async def _fetch_listener_rfid_fallback(
    db: AsyncSession,
    *,
    limit: int,
) -> List[Dict[str, Any]]:
    if not LISTENER_RFID_SUMMARY_URL:
        return []

    try:
        async with httpx.AsyncClient(timeout=2.5) as client:
            response = await client.get(
                LISTENER_RFID_SUMMARY_URL,
                params={"limit": max(1, min(int(limit), 100))},
            )
        response.raise_for_status()
        payload = response.json()
    except Exception:
        return []

    raw_items = payload.get("items") if isinstance(payload, dict) else None
    if not isinstance(raw_items, list):
        return []

    items: List[Dict[str, Any]] = []
    now_utc = datetime_type.now(timezone.utc)
    for raw_item in raw_items[:limit]:
        if not isinstance(raw_item, dict):
            continue

        epc = str(raw_item.get("epc") or "").strip()
        if not epc:
            continue

        tag_context = await _lookup_tag_context(db, epc)
        if not tag_context["registered"]:
            continue
        last_seen_at = _parse_iso_datetime(raw_item.get("last_seen_at"))
        strongest_rssi = _coerce_int(raw_item.get("strongest_rssi"))
        latest_rssi = _coerce_int(raw_item.get("latest_rssi"))
        avg_rssi = _coerce_float(raw_item.get("avg_rssi"))
        seconds_since_last_seen = (
            max(0, int((now_utc - last_seen_at).total_seconds())) if last_seen_at else 0
        )

        items.append(
            {
                "tag_id": tag_context["tag_id"],
                "tag_code": tag_context["tag_code"],
                "reader_code": raw_item.get("reader_code") or raw_item.get("reader_host"),
                "assigned_to": tag_context["assigned_to"],
                "entity_type": tag_context["entity_type"],
                "entity_id": tag_context["entity_id"],
                "portico_id": None,
                "portico_name": None,
                "antenna_port": _coerce_int(raw_item.get("antenna_port")),
                "antenna_name": raw_item.get("antenna_name"),
                "last_seen_at": last_seen_at.isoformat() if last_seen_at else None,
                "seconds_since_last_seen": seconds_since_last_seen,
                "latest_rssi": latest_rssi,
                "strongest_rssi": strongest_rssi,
                "avg_rssi": avg_rssi,
                "sample_count": _coerce_int(raw_item.get("read_count")) or 0,
                "proximity_hint": raw_item.get("proximity_hint")
                or _rfid_proximity_hint(strongest_rssi if strongest_rssi is not None else latest_rssi),
            }
        )

    return items


async def _resolve_access_day(
    db: AsyncSession,
    requested_day: Optional[date_type] = None,
    portico_id: Optional[int] = None,
) -> date_type:
    requested_day = requested_day or date_type.today()
    params = {"day": requested_day, "portico_id": portico_id}
    portico_filter = """
      AND (
        CAST(:portico_id AS bigint) IS NULL
        OR COALESCE(
          CASE
            WHEN ae.extra ? 'portico' AND (ae.extra->>'portico') ~ '^[0-9]+$'
            THEN (ae.extra->>'portico')::bigint
            ELSE NULL
          END,
          ap_by_gw.id
        ) = CAST(:portico_id AS bigint)
      )
    """

    day_count = await db.execute(
        text(
            f"""
            SELECT COUNT(*)
            FROM access_event ae
            LEFT JOIN LATERAL (
              SELECT ap.id
              FROM access_portico ap
              WHERE ap.gateway_id = ae.gateway_id
                AND ap.active = TRUE
              ORDER BY ap.id
              LIMIT 1
            ) ap_by_gw ON TRUE
            WHERE DATE(COALESCE(ae.ts_edge, ae.ts_ingested)) = :day
            {portico_filter}
            """
        ),
        params,
    )
    if int(day_count.scalar() or 0) > 0:
        return requested_day

    latest_day = await db.execute(
        text(
            f"""
            SELECT MAX(DATE(COALESCE(ae.ts_edge, ae.ts_ingested)))
            FROM access_event ae
            LEFT JOIN LATERAL (
              SELECT ap.id
              FROM access_portico ap
              WHERE ap.gateway_id = ae.gateway_id
                AND ap.active = TRUE
              ORDER BY ap.id
              LIMIT 1
            ) ap_by_gw ON TRUE
            WHERE 1 = 1
            {portico_filter}
            """
        ),
        params,
    )
    return latest_day.scalar() or requested_day


async def _fetch_current_interior(
    db: AsyncSession,
    portico_id: Optional[int] = None,
    q: Optional[str] = None,
    as_of: Optional[datetime_type] = None,
):
    as_of = as_of or datetime_type.now(timezone.utc)
    params = {}
    filters = ["ele.entity_rn = 1", "ele.entity_type IN ('person', 'vehicle')"]

    if portico_id is not None:
        filters.append("ele.portico_id = :pid")
        params["pid"] = int(portico_id)

    if q and q.strip():
        params["q"] = f"%{q.strip()}%"
        filters.append(
            """
            (
                COALESCE(p.rut, '') ILIKE :q
                OR COALESCE(p.full_name, ele.display_name, '') ILIKE :q
                OR COALESCE(p.position, '') ILIKE :q
                OR COALESCE(pc.name, '') ILIKE :q
                OR COALESCE(v.patente, '') ILIKE :q
                OR COALESCE(v.status, '') ILIKE :q
                OR COALESCE(vc.name, '') ILIKE :q
                OR COALESCE(ap.name, '') ILIKE :q
                OR COALESCE(ele.zone, '') ILIKE :q
            )
            """
        )

    params["as_of"] = as_of
    where_clause = " AND ".join(filters)
    result = await db.execute(
        text(
            f"""
            WITH last_event AS (
                SELECT
                    ae.tag_id,
                    ae.gateway_id,
                    ae.zone,
                    ae.direction,
                    GREATEST(ae.ts_edge, ae.ts_ingested) AS last_seen,
                    CASE
                        WHEN ae.extra ? 'portico' AND (ae.extra->>'portico') ~ '^[0-9]+$'
                        THEN (ae.extra->>'portico')::bigint
                        ELSE NULL
                    END AS portico_from_extra,
                    ROW_NUMBER() OVER (
                        PARTITION BY ae.tag_id
                        ORDER BY GREATEST(ae.ts_edge, ae.ts_ingested) DESC, ae.id DESC
                    ) AS rn
                FROM access_event ae
                WHERE GREATEST(ae.ts_edge, ae.ts_ingested) <= :as_of
            ),
            entity_last_event AS (
                SELECT
                    ta.tag_id,
                    ta.entity_type,
                    ta.entity_id,
                    ta.display_name,
                    le.gateway_id,
                    le.zone,
                    le.last_seen,
                    COALESCE(le.portico_from_extra, ap_by_gw.id) AS portico_id,
                    ROW_NUMBER() OVER (
                        PARTITION BY ta.entity_type, ta.entity_id
                        ORDER BY le.last_seen DESC, ta.id DESC
                    ) AS entity_rn
                FROM tag_assignment ta
                JOIN last_event le
                    ON le.tag_id = ta.tag_id
                   AND le.rn = 1
                   AND le.direction = 'in'
                LEFT JOIN LATERAL (
                    SELECT ap.id
                    FROM access_portico ap
                    WHERE ap.gateway_id = le.gateway_id
                      AND ap.active = TRUE
                    ORDER BY ap.id
                    LIMIT 1
                ) ap_by_gw ON TRUE
                WHERE ta.active = TRUE
            )
            SELECT
                ele.portico_id,
                ap.name AS portico_name,
                ele.tag_id,
                ele.entity_type,
                ele.entity_id,
                ele.display_name,
                ele.last_seen AS ts_last,
                ele.zone,
                p.rut AS person_rut,
                p.full_name AS person_full_name,
                p.position AS person_position,
                pc.name AS person_company_name,
                v.patente AS vehicle_patente,
                v.status AS vehicle_status,
                vc.name AS vehicle_company_name
            FROM entity_last_event ele
            LEFT JOIN access_portico ap
                ON ap.id = ele.portico_id
            LEFT JOIN person p
                ON p.id = ele.entity_id AND ele.entity_type = 'person'
            LEFT JOIN company pc
                ON pc.id = p.company_id
            LEFT JOIN vehicles v
                ON v.id = ele.entity_id AND ele.entity_type = 'vehicle'
            LEFT JOIN vehicle_company vc_rel
                ON vc_rel.vehicle_id = v.id AND vc_rel.active = TRUE
            LEFT JOIN company vc
                ON vc.id = vc_rel.company_id
            WHERE {where_clause}
            ORDER BY ele.last_seen DESC, ele.entity_type, ele.display_name;
            """
        ),
        params,
    )
    rows = result.mappings().all()

    personas = []
    vehiculos = []

    for r in rows:
        if r["entity_type"] == "person":
            personas.append(
                {
                    "id": r["entity_id"],
                    "rut": r["person_rut"],
                    "full_name": r["person_full_name"] or r["display_name"],
                    "position": r["person_position"],
                    "company_name": r["person_company_name"],
                    "portico_id": r["portico_id"],
                    "portico_name": r["portico_name"],
                    "last_seen_at": r["ts_last"].isoformat() if r["ts_last"] else None,
                    "zone": r["zone"],
                }
            )
        elif r["entity_type"] == "vehicle":
            vehiculos.append(
                {
                    "id": r["entity_id"],
                    "patente": r["vehicle_patente"],
                    "type": r["vehicle_status"],
                    "company_name": r["vehicle_company_name"],
                    "portico_id": r["portico_id"],
                    "portico_name": r["portico_name"],
                    "last_seen_at": r["ts_last"].isoformat() if r["ts_last"] else None,
                    "zone": r["zone"],
                }
            )

    return personas, vehiculos


# ------------------------------------------------------------
# 1) Selector de pórticos para el combo del front
#    GET /api/access/porticos
# ------------------------------------------------------------
@router.get("/porticos")
async def list_porticos(db: AsyncSession = Depends(get_db)):
    """Devuelve todos los pórticos activos para el selector del front."""
    result = await db.execute(
        text(
            """
            SELECT
                ap.id,
                ap.name,
                ap.site,
                ap.nivel,
                ap.zone
            FROM access_portico ap
            WHERE ap.active = TRUE
            ORDER BY ap.name;
            """
        )
    )
    return result.mappings().all()


# ------------------------------------------------------------
# 2) Resumen de lecturas por pórtico (IN / OUT / total)
#    GET /api/access/portico-summary?portico_id=XX (opcional)
#    Usa la vista vw_access_portico_counters
# ------------------------------------------------------------
# ------------------------------------------------------------------------------
# MÉTODO ANTIGUO (basado en conteo de eventos por direction)
# PROBLEMA:
# - BLE no genera direction = 'out'
# - total_out siempre es 0
# - No representa estado real de presencia
# ------------------------------------------------------------------------------

# @router.get("/portico-summary")
# async def portico_summary(
#     day: Optional[date_type] = Query(default=None),
#     portico_id: Optional[int] = Query(default=None),
#     db: AsyncSession = Depends(get_db),
# ):
#     day = day or date_type.today()
#
#     result = await db.execute(
#         text(
#             """
#             WITH ev_raw AS (
#               SELECT
#                 ap.id AS portico_id,
#                 ae.direction AS direction,
#                 ta.entity_type AS entity_type,
#                 ta.entity_id AS entity_id,
#                 COALESCE(ae.ts_edge, ae.ts_ingested) AS ts
#               FROM access_event ae
#               JOIN access_portico ap
#                 ON ap.gateway_id = ae.gateway_id AND ap.active = TRUE
#               LEFT JOIN tag_assignment ta
#                 ON ta.tag_id = ae.tag_id AND ta.active = TRUE
#               WHERE DATE(COALESCE(ae.ts_edge, ae.ts_ingested)) = :day
#             ),
#             agg AS (
#               SELECT
#                 portico_id,
#                 COUNT(*) AS total_events,
#                 SUM(CASE WHEN direction = 'in'  THEN 1 ELSE 0 END) AS total_in,
#                 SUM(CASE WHEN direction = 'out' THEN 1 ELSE 0 END) AS total_out,
#                 MAX(ts) AS last_event_at,
#                 COUNT(DISTINCT CASE WHEN entity_type = 'person'  THEN entity_id END) AS unique_people,
#                 COUNT(DISTINCT CASE WHEN entity_type = 'vehicle' THEN entity_id END) AS unique_vehicles
#               FROM ev_raw
#               GROUP BY portico_id
#             )
#             SELECT
#               ap.id,
#               ap.name,
#               ap.site,
#               ap.nivel,
#               ap.zone,
#               COALESCE(agg.total_events, 0) AS total_events,
#               COALESCE(agg.total_in, 0)     AS total_in,
#               COALESCE(agg.total_out, 0)    AS total_out,
#               agg.last_event_at             AS last_event_at,
#               COALESCE(agg.unique_people, 0)   AS unique_people,
#               COALESCE(agg.unique_vehicles, 0) AS unique_vehicles
#             FROM access_portico ap
#             LEFT JOIN agg
#               ON agg.portico_id = ap.id
#             WHERE ap.active = TRUE
#             ORDER BY ap.id;
#             """
#         ),
#         {"day": day},
#     )
#
#     rows = result.mappings().all()
#     out = []
#     for r in rows:
#         if portico_id is not None and r["id"] != portico_id:
#             continue
#         out.append(
#             {
#                 "id": r["id"],
#                 "name": r["name"],
#                 "site": r["site"],
#                 "nivel": r["nivel"],
#                 "zone": r["zone"],
#                 "total_events": int(r["total_events"] or 0),
#                 "total_in": int(r["total_in"] or 0),
#                 "total_out": int(r["total_out"] or 0),
#                 "unique_people": int(r["unique_people"] or 0),
#                 "unique_vehicles": int(r["unique_vehicles"] or 0),
#                 "last_event_at": r["last_event_at"].isoformat() if r["last_event_at"] else None,
#             }
#         )
#     return out


@router.get("/portico-summary")
async def portico_summary(
    day: Optional[date_type] = Query(default=None, description="Fecha YYYY-MM-DD (por defecto hoy)"),
    portico_id: Optional[int] = Query(default=None, description="Filtra un pórtico específico (opcional)"),
    db: AsyncSession = Depends(get_db),
):
    """
    Resumen por pórtico (Acceso).

    Lógica de presencia (producción):
    - IN  : último evento del TAG <= 20 minutos
    - OUT : último evento del TAG  > 20 minutos

    NOTA:
    - No se generan eventos OUT físicos
    - El estado OUT se infiere por ausencia prolongada
    """

    effective_day = await _resolve_access_day(db, day, portico_id)

    result = await db.execute(
        text(
            """
            WITH event_base AS (
              SELECT
                ae.id AS event_id,
                ae.direction,
                COALESCE(ae.ts_edge, ae.ts_ingested) AS ts,
                COALESCE(
                  CASE
                    WHEN ae.extra ? 'portico' AND (ae.extra->>'portico') ~ '^[0-9]+$'
                    THEN (ae.extra->>'portico')::bigint
                    ELSE NULL
                  END,
                  ap_by_gw.id
                ) AS portico_id
              FROM access_event ae
              LEFT JOIN LATERAL (
                SELECT ap.id
                FROM access_portico ap
                WHERE ap.gateway_id = ae.gateway_id
                  AND ap.active = TRUE
                ORDER BY ap.id
                LIMIT 1
              ) ap_by_gw ON TRUE
              WHERE DATE(COALESCE(ae.ts_edge, ae.ts_ingested)) = :day
            ),
            event_counts AS (
              SELECT
                eb.portico_id,
                COUNT(eb.event_id) AS total_events,
                COUNT(*) FILTER (WHERE eb.direction = 'in') AS total_in,
                COUNT(*) FILTER (WHERE eb.direction = 'out') AS total_out,
                MAX(eb.ts) AS last_event_at
              FROM event_base eb
              WHERE eb.portico_id IS NOT NULL
              GROUP BY eb.portico_id
            ),
            current_presence AS (
              SELECT
                i.portico_id,
                COUNT(*) FILTER (WHERE i.entity_type = 'person') AS unique_people,
                COUNT(*) FILTER (WHERE i.entity_type = 'vehicle') AS unique_vehicles
              FROM vw_access_interior i
              GROUP BY i.portico_id
            )
            SELECT
              ap.id,
              ap.name,
              ap.site,
              ap.nivel,
              ap.zone,
              COALESCE(ec.total_events, 0) AS total_events,
              COALESCE(ec.total_in, 0)     AS total_in,
              COALESCE(ec.total_out, 0)    AS total_out,
              ec.last_event_at,
              COALESCE(cp.unique_people, 0)   AS unique_people,
              COALESCE(cp.unique_vehicles, 0) AS unique_vehicles
            FROM access_portico ap
            LEFT JOIN event_counts ec
              ON ec.portico_id = ap.id
            LEFT JOIN current_presence cp
              ON cp.portico_id = ap.id
            WHERE ap.active = TRUE
            ORDER BY ap.id;
            """
        ),
        {"day": effective_day},
    )

    rows = result.mappings().all()
    out = []
    for r in rows:
        if portico_id is not None and r["id"] != portico_id:
            continue
        out.append(
            {
                "id": r["id"],
                "name": r["name"],
                "site": r["site"],
                "nivel": r["nivel"],
                "zone": r["zone"],
                "total_events": int(r["total_events"] or 0),
                "total_in": int(r["total_in"] or 0),
                "total_out": int(r["total_out"] or 0),
                "unique_people": int(r["unique_people"] or 0),
                "unique_vehicles": int(r["unique_vehicles"] or 0),
                "last_event_at": r["last_event_at"].isoformat() if r["last_event_at"] else None,
                "event_day": effective_day.isoformat(),
            }
        )

    return out


@router.get("/current-summary")
async def current_summary(
    portico_id: Optional[int] = Query(default=None),
    q: Optional[str] = Query(default=None),
    as_of: Optional[datetime_type] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    personas, vehiculos = await _fetch_current_interior(
        db=db,
        portico_id=portico_id,
        q=q,
        as_of=as_of,
    )
    return {"personas": personas, "vehiculos": vehiculos}


@router.get("/rfid-proximity")
async def rfid_proximity(
    reader_code: Optional[str] = Query(default=None, description="Hostname/IP del reader RFID"),
    window_seconds: int = Query(default=60, ge=5, le=600, description="Ventana de tiempo reciente"),
    limit: int = Query(default=20, ge=1, le=100, description="Cantidad máxima de tags"),
    db: AsyncSession = Depends(get_db),
):
    """Ranking operativo de tags RFID recientes por intensidad de señal.

    Se usa para estimar qué EPCs están más cerca de la antena/lector en este
    momento. RSSI más alto (menos negativo) implica cercanía más probable.
    """
    params = {
        "reader_code": (reader_code or "").strip() or None,
        "window_seconds": int(window_seconds),
        "limit": int(limit),
    }

    result = await db.execute(
        text(
            """
            WITH recent AS (
              SELECT
                ae.id,
                ae.tag_id,
                ae.gateway_id,
                t.code AS tag_code,
                g.name AS reader_code,
                COALESCE(ae.ts_edge, ae.ts_ingested) AS seen_at,
                ae.rssi,
                CASE
                  WHEN ae.extra ? 'portico' AND (ae.extra->>'portico') ~ '^[0-9]+$'
                  THEN (ae.extra->>'portico')::bigint
                  ELSE NULL
                END AS portico_from_extra,
                CASE
                  WHEN (ae.extra->>'antenna_port') ~ '^[0-9]+$'
                  THEN (ae.extra->>'antenna_port')::int
                  ELSE NULL
                END AS antenna_port,
                ae.extra->>'antenna_name' AS antenna_name,
                ROW_NUMBER() OVER (
                  PARTITION BY ae.tag_id
                  ORDER BY COALESCE(ae.ts_edge, ae.ts_ingested) DESC, ae.id DESC
                ) AS rn_latest
              FROM access_event ae
              JOIN tag t
                ON t.id = ae.tag_id
              JOIN gateway g
                ON g.id = ae.gateway_id
              WHERE ae.kind = 'rfid'
                AND COALESCE(ae.ts_edge, ae.ts_ingested) >= NOW() - (CAST(:window_seconds AS integer) * INTERVAL '1 second')
                AND (CAST(:reader_code AS text) IS NULL OR g.name = CAST(:reader_code AS text))
            ),
            latest AS (
              SELECT
                r.tag_id,
                r.tag_code,
                r.reader_code,
                r.seen_at AS last_seen_at,
                r.rssi AS latest_rssi,
                r.antenna_port,
                r.antenna_name,
                COALESCE(r.portico_from_extra, ap_by_gw.id) AS portico_id
              FROM recent r
              LEFT JOIN LATERAL (
                SELECT ap.id
                FROM access_portico ap
                WHERE ap.gateway_id = r.gateway_id
                  AND ap.active = TRUE
                ORDER BY ap.id
                LIMIT 1
              ) ap_by_gw ON TRUE
              WHERE r.rn_latest = 1
            ),
            stats AS (
              SELECT
                r.tag_id,
                COUNT(*) AS sample_count,
                MAX(r.rssi) AS strongest_rssi,
                ROUND(AVG(r.rssi)::numeric, 1) AS avg_rssi
              FROM recent r
              GROUP BY r.tag_id
            ),
            assignment AS (
              SELECT DISTINCT ON (ta.tag_id)
                ta.tag_id,
                ta.entity_type,
                ta.entity_id,
                COALESCE(
                  CASE WHEN ta.entity_type = 'person' THEN p.full_name END,
                  CASE WHEN ta.entity_type = 'vehicle' THEN v.patente END,
                  CASE WHEN ta.entity_type = 'equipment' THEN e.name END,
                  ta.display_name
                ) AS assigned_to
              FROM tag_assignment ta
              LEFT JOIN person p
                ON ta.entity_type = 'person' AND p.id = ta.entity_id
              LEFT JOIN vehicles v
                ON ta.entity_type = 'vehicle' AND v.id = ta.entity_id
              LEFT JOIN equipment e
                ON ta.entity_type = 'equipment' AND e.id = ta.entity_id
              WHERE ta.active = TRUE
              ORDER BY ta.tag_id, ta.updated_at DESC NULLS LAST, ta.id DESC
            )
            SELECT
              l.tag_id,
              l.tag_code,
              l.reader_code,
              l.last_seen_at,
              l.latest_rssi,
              s.strongest_rssi,
              s.avg_rssi,
              s.sample_count,
              l.antenna_port,
              l.antenna_name,
              l.portico_id,
              ap.name AS portico_name,
              a.entity_type,
              a.entity_id,
              a.assigned_to,
              EXTRACT(EPOCH FROM (NOW() - l.last_seen_at))::int AS seconds_since_last_seen
            FROM latest l
            JOIN stats s
              ON s.tag_id = l.tag_id
            LEFT JOIN assignment a
              ON a.tag_id = l.tag_id
            LEFT JOIN access_portico ap
              ON ap.id = l.portico_id
            ORDER BY s.strongest_rssi DESC NULLS LAST, l.last_seen_at DESC
            LIMIT :limit
            """
        ),
        params,
    )

    rows = result.mappings().all()
    items = []
    for row in rows:
        strongest_rssi = int(row["strongest_rssi"]) if row["strongest_rssi"] is not None else None
        latest_rssi = int(row["latest_rssi"]) if row["latest_rssi"] is not None else None
        items.append(
            {
                "tag_id": str(row["tag_id"]),
                "tag_code": row["tag_code"],
                "reader_code": row["reader_code"],
                "assigned_to": row["assigned_to"],
                "entity_type": row["entity_type"],
                "entity_id": row["entity_id"],
                "portico_id": row["portico_id"],
                "portico_name": row["portico_name"],
                "antenna_port": row["antenna_port"],
                "antenna_name": row["antenna_name"],
                "last_seen_at": row["last_seen_at"].isoformat() if row["last_seen_at"] else None,
                "seconds_since_last_seen": int(row["seconds_since_last_seen"] or 0),
                "latest_rssi": latest_rssi,
                "strongest_rssi": strongest_rssi,
                "avg_rssi": float(row["avg_rssi"]) if row["avg_rssi"] is not None else None,
                "sample_count": int(row["sample_count"] or 0),
                "proximity_hint": _rfid_proximity_hint(strongest_rssi if strongest_rssi is not None else latest_rssi),
            }
        )

    fallback_used = False
    if not items:
        items = await _fetch_listener_rfid_fallback(db, limit=params["limit"])
        fallback_used = bool(items)

    return {
        "reader_code": params["reader_code"],
        "window_seconds": params["window_seconds"],
        "limit": params["limit"],
        "source": "listener_fallback" if fallback_used else "db",
        "items": items,
    }



@router.get("/portico-config/{portico_id}")
async def portico_config(portico_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        text(
            """
            SELECT
                ap.id                  AS id,
                ap.name                AS name,
                ap.specific_name       AS specific_name,
                g.name                 AS gateway_name,
                ap.site                AS site,
                ap.nivel               AS nivel,
                ap.site_code           AS site_code,
                ap.zone                AS zone,
                apt.code               AS portico_type_code,
                apt.name               AS portico_type_name,
                ap.operating_mode      AS operating_mode,
                ap.antenna_in_port     AS antenna_in_port,
                ap.antenna_out_port    AS antenna_out_port,
                ap.sequence_window_seconds AS sequence_window_seconds,
                ap.display_shape       AS display_shape,
                ap.has_climate         AS has_climate
            FROM access_portico ap
            JOIN gateway g
              ON g.id = ap.gateway_id
            JOIN access_portico_type apt
              ON apt.id = ap.portico_type_id
            WHERE ap.id = :pid;
            """
        ),
        {"pid": portico_id},
    )
    return result.mappings().all()


# ------------------------------------------------------------
# 4) Interior actual (personas / vehículos) por pórtico
#    GET /api/access/summary/{portico_id}
#    (igual al tuyo)
# ------------------------------------------------------------
@router.get("/summary/{portico_id}")
async def interior_summary(portico_id: int, db: AsyncSession = Depends(get_db)):
    personas, vehiculos = await _fetch_current_interior(db=db, portico_id=portico_id)

    clima_result = await db.execute(
        text(
            """
            SELECT
                MAX(CASE WHEN cv.code = 'TEMP' THEN acr.level END) AS temp_level,
                MAX(CASE WHEN cv.code = 'HUM'  THEN acr.level END) AS hum_level,
                MAX(CASE WHEN cv.code = 'WIND' THEN acr.level END) AS wind_level
            FROM access_portico_climate_reading acr
            JOIN access_climate_var cv
              ON cv.id = acr.climate_var_id
            WHERE acr.portico_id = :pid
            GROUP BY acr.portico_id;
            """
        ),
        {"pid": portico_id},
    )
    clima_row = clima_result.mappings().first()

    clima = None
    if clima_row:
        clima = {
            "temp_level": clima_row["temp_level"],
            "hum_level": clima_row["hum_level"],
            "wind_level": clima_row["wind_level"],
        }

    return {"personas": personas, "vehiculos": vehiculos, "clima": clima}


# ------------------------------------------------------------
# 5) NUEVO: Totalizador del día (todos o filtrado por pórtico)
#    GET /api/access/day-summary?day=YYYY-MM-DD&portico_id=XX&q=texto
#
# IMPORTANTE: tu access_event NO tiene portico_id.
# - portico_id viene en access_event.extra->>'portico' (según zenit_demo_1_dia.sql)
# - o se puede mapear por gateway_id contra access_portico.gateway_id
# ------------------------------------------------------------
@router.get("/day-summary")
async def day_summary(
    day: date_type = Query(default_factory=date_type.today),
    portico_id: Optional[int] = Query(default=None),
    q: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    effective_day = await _resolve_access_day(db, day, portico_id)
    # filtros
    params = {"day": effective_day}
    portico_filter = ""
    if portico_id is not None:
        # ✅ FIX: el alias correcto en este nivel es a.last_portico_id
        portico_filter = "AND a.last_portico_id = :pid"
        params["pid"] = int(portico_id)

    search_filter = ""
    if q and q.strip():
        params["q"] = f"%{q.strip()}%"
        search_filter = """
        AND (
          (a.entity_type = 'person' AND (
            p.full_name ILIKE :q OR p.rut ILIKE :q OR pc.name ILIKE :q
          ))
          OR
          (a.entity_type = 'vehicle' AND (
            v.patente ILIKE :q OR vc.name ILIKE :q
          ))
        )
        """

    sql = text(
        f"""
        WITH ev_raw AS (
          SELECT
            ta.entity_type,
            ta.entity_id,
            COALESCE(ae.ts_edge, ae.ts_ingested) AS ts,
            ae.direction,

            -- 1) preferir extra.portico
                CASE
                WHEN ae.extra ? 'portico' AND (ae.extra->>'portico') ~ '^[0-9]+$'
                THEN (ae.extra->>'portico')::bigint
                ELSE NULL
                END AS portico_from_extra,

            -- 2) fallback por gateway_id
            ap.id AS portico_from_gateway

          FROM access_event ae
          JOIN tag_assignment ta
            ON ta.tag_id = ae.tag_id
           AND ta.active = TRUE

          LEFT JOIN access_portico ap
            ON ap.gateway_id = ae.gateway_id
           AND ap.active = TRUE

          WHERE COALESCE(ae.ts_edge, ae.ts_ingested)::date = :day
        ),

        ev AS (
          SELECT
            entity_type,
            entity_id,
            ts,
            direction,
            COALESCE(portico_from_extra, portico_from_gateway) AS portico_id
          FROM ev_raw
          WHERE COALESCE(portico_from_extra, portico_from_gateway) IS NOT NULL
        ),

        agg AS (
          SELECT
            entity_type,
            entity_id,
            MAX(ts) FILTER (WHERE direction = 'in')  AS in_at,
            MAX(ts) FILTER (WHERE direction = 'out') AS out_at,
            MAX(ts) AS last_seen_at,
            (ARRAY_AGG(portico_id ORDER BY ts DESC))[1] AS last_portico_id
          FROM ev
          GROUP BY entity_type, entity_id
        )

        SELECT
          a.entity_type,
          a.entity_id,
          a.in_at,
          a.out_at,
          a.last_seen_at,
          a.last_portico_id,
          ap.name AS portico_name,
          ap.zone AS zone,

          p.rut       AS person_rut,
          p.full_name AS person_full_name,
          p.position  AS person_position,
          pc.name     AS person_company_name,

          v.patente   AS vehicle_patente,
          v.status    AS vehicle_status,
          vc.name     AS vehicle_company_name

        FROM agg a
        LEFT JOIN access_portico ap
          ON ap.id = a.last_portico_id

        LEFT JOIN person p
          ON p.id = a.entity_id AND a.entity_type = 'person'
        LEFT JOIN company pc
          ON pc.id = p.company_id

        LEFT JOIN vehicles v
          ON v.id = a.entity_id AND a.entity_type = 'vehicle'

        -- empresa de vehículo: vehicle_company (activa)
        LEFT JOIN vehicle_company vcc
          ON vcc.vehicle_id = v.id AND vcc.active = TRUE
        LEFT JOIN company vc
          ON vc.id = vcc.company_id

        WHERE 1=1
          {search_filter}
          {portico_filter}
        ORDER BY a.last_seen_at DESC;
        """
    )

    result = await db.execute(sql, params)
    rows = result.mappings().all()

    personas = []
    vehiculos = []

    for r in rows:
        if r["entity_type"] == "person":
            personas.append(
                {
                    "id": r["entity_id"],
                    "rut": r["person_rut"],
                    "full_name": r["person_full_name"],
                    "position": r["person_position"],
                    "company_name": r["person_company_name"],
                    "portico_id": r["last_portico_id"],
                    "portico_name": r["portico_name"],
                    "zone": r["zone"],
                    "in_at": r["in_at"].isoformat() if r["in_at"] else None,
                    "out_at": r["out_at"].isoformat() if r["out_at"] else None,
                    "last_seen_at": r["last_seen_at"].isoformat() if r["last_seen_at"] else None,
                }
            )
        elif r["entity_type"] == "vehicle":
            vehiculos.append(
                {
                    "id": r["entity_id"],
                    "patente": r["vehicle_patente"],
                    "type": r["vehicle_status"],
                    "company_name": r["vehicle_company_name"],
                    "portico_id": r["last_portico_id"],
                    "portico_name": r["portico_name"],
                    "zone": r["zone"],
                    "in_at": r["in_at"].isoformat() if r["in_at"] else None,
                    "out_at": r["out_at"].isoformat() if r["out_at"] else None,
                    "last_seen_at": r["last_seen_at"].isoformat() if r["last_seen_at"] else None,
                }
            )

    return {"day": effective_day.isoformat(), "personas": personas, "vehiculos": vehiculos}
