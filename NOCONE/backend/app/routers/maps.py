# backend/app/routers/maps.py
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import String, bindparam, text
from sqlalchemy.dialects.postgresql import ARRAY
from datetime import date as Date

from app.db.db import get_db

router = APIRouter(prefix="/maps", tags=["maps"])

FLEET_ACTIVITY_CTE = """
WITH latest_day AS (
    SELECT MAX(DATE(COALESCE(ae.ts_edge, ae.ts_ingested))) AS day
    FROM access_event ae
),
fleet_raw_base AS (
    SELECT
        ta.entity_type,
        ta.entity_id,
        COALESCE(ae.ts_edge, ae.ts_ingested) AS event_ts,
        CASE
            WHEN ae.extra ? 'portico' AND (ae.extra->>'portico') ~ '^[0-9]+$'
                THEN (ae.extra->>'portico')::bigint
            ELSE NULL
        END AS portico_from_extra,
        ap_by_gw.id AS portico_from_gateway,
        COALESCE(
            NULLIF(p.position, ''),
            NULLIF(p.full_name, ''),
            NULLIF(ta.display_name, ''),
            'Persona sin cargo'
        ) AS person_group,
        COALESCE(
            NULLIF(v.status, ''),
            NULLIF(v.patente, ''),
            NULLIF(ta.display_name, ''),
            'Vehiculo sin tipo'
        ) AS vehicle_group,
        COALESCE(
            NULLIF(split_part(e.name, ' ', 1), ''),
            NULLIF(et.name, ''),
            NULLIF(e.name, ''),
            NULLIF(e.code, ''),
            NULLIF(ta.display_name, ''),
            'Equipo sin tipo'
        ) AS equipment_group
    FROM access_event ae
    JOIN tag_assignment ta
      ON ta.tag_id = ae.tag_id
     AND ta.active = TRUE
    CROSS JOIN latest_day ld
    LEFT JOIN LATERAL (
        SELECT ap.id
        FROM access_portico ap
        WHERE ap.gateway_id = ae.gateway_id
          AND ap.active = TRUE
        ORDER BY ap.id
        LIMIT 1
    ) ap_by_gw ON TRUE
    LEFT JOIN person p
      ON p.id = ta.entity_id
     AND ta.entity_type = 'person'
    LEFT JOIN vehicles v
      ON v.id = ta.entity_id
     AND ta.entity_type = 'vehicle'
    LEFT JOIN equipment e
      ON e.id = ta.entity_id
     AND ta.entity_type = 'equipment'
    LEFT JOIN equipment_type et
      ON et.id = e.equipment_type_id
    WHERE DATE(COALESCE(ae.ts_edge, ae.ts_ingested)) = ld.day
),
fleet_raw AS (
    SELECT
        COALESCE(portico_from_extra, portico_from_gateway) AS portico_id,
        entity_type,
        entity_id,
        event_ts,
        person_group,
        vehicle_group,
        equipment_group
    FROM fleet_raw_base
    WHERE COALESCE(portico_from_extra, portico_from_gateway) IS NOT NULL
),
fleet_entities AS (
    SELECT
        portico_id,
        entity_type,
        entity_id,
        MAX(event_ts) AS last_seen_at,
        MAX(person_group) AS person_group,
        MAX(vehicle_group) AS vehicle_group,
        MAX(equipment_group) AS equipment_group
    FROM fleet_raw
    GROUP BY portico_id, entity_type, entity_id
)
"""

FLEET_CURRENT_CTE = """
WITH fleet_entities AS (
    SELECT
        i.portico_id,
        i.entity_type,
        i.entity_id,
        i.ts_last AS last_seen_at,
        COALESCE(
            NULLIF(i.person_position, ''),
            NULLIF(i.person_full_name, ''),
            NULLIF(i.display_name, ''),
            'Persona sin cargo'
        ) AS person_group,
        COALESCE(
            NULLIF(i.vehicle_status, ''),
            NULLIF(i.vehicle_patente, ''),
            NULLIF(i.display_name, ''),
            'Vehiculo sin tipo'
        ) AS vehicle_group,
        COALESCE(
            NULLIF(split_part(i.equipment_name, ' ', 1), ''),
            NULLIF(i.equipment_name, ''),
            NULLIF(i.equipment_code, ''),
            NULLIF(i.display_name, ''),
            'Equipo sin tipo'
        ) AS equipment_group
    FROM vw_access_interior i
)
"""


def _fleet_scope_cte(scope: str) -> str:
    return FLEET_CURRENT_CTE if scope == "current" else FLEET_ACTIVITY_CTE


async def _resolve_entity_history_day(
    db: AsyncSession,
    entity_type: str,
    entity_id: int,
) -> Date:
    result = await db.execute(
        text(
            """
            SELECT MAX(DATE(COALESCE(ae.ts_edge, ae.ts_ingested)))
            FROM access_event ae
            JOIN tag_assignment ta
              ON ta.tag_id = ae.tag_id
             AND ta.entity_type = :entity_type
             AND ta.entity_id = :entity_id
             AND ta.active = TRUE
            """
        ),
        {"entity_type": entity_type, "entity_id": entity_id},
    )
    return result.scalar() or Date.today()


@router.get("/devices/{map_code}")
async def list_map_devices(map_code: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        text(
            """
            SELECT
                md.id,
                md.map_code,
                md.kind,
                md.ref_id,
                md.label,
                md.x_pct,
                md.y_pct,
                cv.source_type AS camera_source_type,
                CASE
                    WHEN cv.source_type = 'video_file' THEN 'Video local'
                    WHEN cv.source_type = 'mp4_url' THEN 'MP4 por URL'
                    WHEN cv.source_type = 'hls' THEN 'HLS'
                    WHEN cv.source_type = 'http' THEN 'HTTP / MJPEG'
                    WHEN cv.source_type = 'rtsp' THEN 'RTSP'
                    ELSE NULL
                END AS camera_source_type_label,
                COALESCE(cv.is_active, FALSE) AS camera_is_active,
                COALESCE(pc.last_seen_at, last_comm.last_communication_at) AS raw_last_communication_at,
                CASE
                    WHEN md.kind IN ('portico', 'portico_clima')
                        THEN COALESCE(pc.last_seen_at, last_comm.last_communication_at)
                    ELSE NULL
                END AS last_communication_at,
                CASE
                    WHEN md.kind NOT IN ('portico', 'portico_clima') THEN NULL
                    WHEN COALESCE(pc.last_seen_at, last_comm.last_communication_at) >= NOW() - INTERVAL '10 minutes'
                        THEN 'online'
                    ELSE 'offline'
                END AS communication_status,

                -- ✅ Nivel agregado para pórticos clima (peor de sus sensores)
                CASE
                    WHEN md.kind <> 'portico_clima' THEN NULL
                    ELSE (
                        SELECT CASE MAX(prio)
                            WHEN 2 THEN 'red'
                            WHEN 1 THEN 'yellow'
                            WHEN 0 THEN 'green'
                            ELSE NULL
                        END
                        FROM (
                            SELECT
                                CASE cr.level
                                    WHEN 'red' THEN 2
                                    WHEN 'yellow' THEN 1
                                    WHEN 'green' THEN 0
                                    ELSE -1
                                END AS prio
                            FROM access_portico_climate_cfg cfg
                            LEFT JOIN LATERAL (
                                SELECT r.level
                                FROM access_portico_climate_reading r
                                WHERE r.portico_id = cfg.portico_id
                                  AND r.climate_var_id = cfg.climate_var_id
                                ORDER BY r.created_at DESC
                                LIMIT 1
                            ) cr ON TRUE
                            WHERE cfg.portico_id = md.ref_id
                              AND cfg.active = TRUE
                        ) z
                    )
                END AS climate_level

            FROM map_device md
            LEFT JOIN camera_video cv
              ON md.kind = 'camera'
             AND cv.id = md.ref_id
            LEFT JOIN access_portico ap
              ON md.kind IN ('portico', 'portico_clima')
             AND ap.id = md.ref_id
            LEFT JOIN portico_communication pc
              ON pc.portico_id = ap.id
            LEFT JOIN LATERAL (
                SELECT MAX(ae.ts_ingested) AS last_communication_at
                FROM access_event ae
                WHERE ap.id IS NOT NULL
                  AND (
                    ae.gateway_id = ap.gateway_id
                    OR (
                        ae.extra ? 'portico'
                        AND (ae.extra->>'portico') ~ '^[0-9]+$'
                        AND (ae.extra->>'portico')::bigint = ap.id
                    )
                  )
            ) last_comm ON TRUE
            WHERE md.map_code = :map_code
              AND (
                md.kind <> 'camera'
                OR COALESCE(cv.is_active, FALSE) = TRUE
              )
            ORDER BY md.id;
            """
        ),
        {"map_code": map_code},
    )
    rows = result.mappings().all()
    return rows


@router.get("/fleet-waypoints/{map_code}")
async def fleet_waypoints(
    map_code: str,
    scope: str = Query("day", pattern="^(current|day)$"),
    db: AsyncSession = Depends(get_db),
):
    """
    Devuelve los pórticos del mapa como waypoints acumulativos para la vista
    Flota Personas y Vehículos, con conteos actuales por tipo de entidad.
    """

    result = await db.execute(
        text(
            _fleet_scope_cte(scope)
            + """
            SELECT
                md.id                 AS device_id,
                md.map_code           AS map_code,
                md.kind               AS kind,
                md.ref_id             AS portico_id,
                md.label              AS label,
                md.x_pct              AS x_pct,
                md.y_pct              AS y_pct,
                ap.name               AS portico_name,
                ap.site               AS site,
                ap.nivel              AS nivel,
                ap.zone               AS zone,
                ap.has_climate        AS has_climate,
                COUNT(DISTINCT CASE WHEN fe.entity_type = 'person' THEN fe.entity_id END) AS people_count,
                COUNT(DISTINCT CASE WHEN fe.entity_type = 'vehicle' THEN fe.entity_id END) AS vehicle_count,
                COUNT(DISTINCT CASE WHEN fe.entity_type = 'equipment' THEN fe.entity_id END) AS equipment_count,
                MAX(fe.last_seen_at)  AS last_seen_at,
                CASE
                    WHEN md.kind <> 'portico_clima' THEN NULL
                    ELSE (
                        SELECT CASE MAX(prio)
                            WHEN 2 THEN 'red'
                            WHEN 1 THEN 'yellow'
                            WHEN 0 THEN 'green'
                            ELSE NULL
                        END
                        FROM (
                            SELECT
                                CASE cr.level
                                    WHEN 'red' THEN 2
                                    WHEN 'yellow' THEN 1
                                    WHEN 'green' THEN 0
                                    ELSE -1
                                END AS prio
                            FROM access_portico_climate_cfg cfg
                            LEFT JOIN LATERAL (
                                SELECT r.level
                                FROM access_portico_climate_reading r
                                WHERE r.portico_id = cfg.portico_id
                                  AND r.climate_var_id = cfg.climate_var_id
                                ORDER BY r.created_at DESC
                                LIMIT 1
                            ) cr ON TRUE
                            WHERE cfg.portico_id = md.ref_id
                              AND cfg.active = TRUE
                        ) z
                    )
                END AS climate_level
            FROM map_device md
            JOIN access_portico ap
              ON ap.id = md.ref_id
             AND ap.active = TRUE
            LEFT JOIN fleet_entities fe
              ON fe.portico_id = ap.id
            WHERE md.map_code = :map_code
              AND md.kind IN ('portico', 'portico_clima')
            GROUP BY
                md.id,
                md.map_code,
                md.kind,
                md.ref_id,
                md.label,
                md.x_pct,
                md.y_pct,
                ap.name,
                ap.site,
                ap.nivel,
                ap.zone,
                ap.has_climate
            ORDER BY
                (
                    COUNT(DISTINCT CASE WHEN fe.entity_type = 'person' THEN fe.entity_id END)
                    + COUNT(DISTINCT CASE WHEN fe.entity_type = 'vehicle' THEN fe.entity_id END)
                    + COUNT(DISTINCT CASE WHEN fe.entity_type = 'equipment' THEN fe.entity_id END)
                ) DESC,
                ap.name ASC;
            """
        ),
        {"map_code": map_code},
    )

    rows = result.mappings().all()
    out = []
    for row in rows:
        people_count = int(row["people_count"] or 0)
        vehicle_count = int(row["vehicle_count"] or 0)
        equipment_count = int(row["equipment_count"] or 0)
        out.append(
            {
                "device_id": row["device_id"],
                "map_code": row["map_code"],
                "kind": row["kind"],
                "portico_id": row["portico_id"],
                "label": row["label"],
                "x_pct": float(row["x_pct"]),
                "y_pct": float(row["y_pct"]),
                "portico_name": row["portico_name"],
                "site": row["site"],
                "nivel": row["nivel"],
                "zone": row["zone"],
                "has_climate": row["has_climate"],
                "climate_level": row["climate_level"],
                "people_count": people_count,
                "vehicle_count": vehicle_count,
                "equipment_count": equipment_count,
                "total_count": people_count + vehicle_count + equipment_count,
                "last_seen_at": row["last_seen_at"].isoformat() if row["last_seen_at"] else None,
            }
        )

    return out


@router.get("/fleet-waypoints-filtered/{map_code}")
async def fleet_waypoints_filtered(
    map_code: str,
    entity_type: str = Query(..., pattern="^(person|vehicle|equipment)$"),
    subtype: list[str] | None = Query(None),
    scope: str = Query("day", pattern="^(current|day)$"),
    db: AsyncSession = Depends(get_db),
):
    """
    Devuelve el conteo por pórtico para un filtro principal de Flota y un
    subfiltro opcional por tipo o nombre.
    """

    subtype_normalized = sorted(
        {
            item.strip().lower()
            for item in (subtype or [])
            if item and item.strip()
        }
    ) or None

    query = text(
        _fleet_scope_cte(scope)
        + """
            SELECT
                md.id AS device_id,
                COUNT(
                    DISTINCT CASE
                        WHEN fe.entity_type <> :entity_type THEN NULL
                        WHEN :subtypes IS NULL THEN fe.entity_id
                        WHEN :entity_type = 'person'
                             AND LOWER(COALESCE(fe.person_group, '')) = ANY(:subtypes)
                            THEN fe.entity_id
                        WHEN :entity_type = 'vehicle'
                             AND LOWER(COALESCE(fe.vehicle_group, '')) = ANY(:subtypes)
                            THEN fe.entity_id
                        WHEN :entity_type = 'equipment'
                             AND LOWER(COALESCE(fe.equipment_group, '')) = ANY(:subtypes)
                            THEN fe.entity_id
                        ELSE NULL
                    END
                ) AS filtered_count
            FROM map_device md
            JOIN access_portico ap
              ON ap.id = md.ref_id
             AND ap.active = TRUE
            LEFT JOIN fleet_entities fe
              ON fe.portico_id = ap.id
            WHERE md.map_code = :map_code
              AND md.kind IN ('portico', 'portico_clima')
            GROUP BY md.id
            ORDER BY md.id;
            """
    ).bindparams(
        bindparam("entity_type", type_=String()),
        bindparam("subtypes", type_=ARRAY(String())),
        bindparam("map_code", type_=String()),
    )

    result = await db.execute(
        query,
        {
            "map_code": map_code,
            "entity_type": entity_type,
            "subtypes": subtype_normalized,
        },
    )

    return [
        {
            "device_id": row["device_id"],
            "filtered_count": int(row["filtered_count"] or 0),
        }
        for row in result.mappings().all()
    ]


@router.get("/fleet-subfilters/{map_code}")
async def fleet_subfilters(
    map_code: str,
    entity_type: str = Query(..., pattern="^(person|vehicle|equipment)$"),
    scope: str = Query("day", pattern="^(current|day)$"),
    db: AsyncSession = Depends(get_db),
):
    """
    Devuelve opciones activas para el subfiltro de Flota según la entidad
    principal seleccionada.
    """

    result = await db.execute(
        text(
            _fleet_scope_cte(scope)
            + """
            SELECT
                value,
                COUNT(DISTINCT entity_id) AS total
            FROM (
                SELECT
                    fe.entity_id,
                    CASE
                        WHEN :entity_type = 'person'
                            THEN COALESCE(NULLIF(fe.person_group, ''), 'Persona sin cargo')
                        WHEN :entity_type = 'vehicle'
                            THEN COALESCE(NULLIF(fe.vehicle_group, ''), 'Vehiculo sin tipo')
                        WHEN :entity_type = 'equipment'
                            THEN COALESCE(NULLIF(fe.equipment_group, ''), 'Equipo sin tipo')
                        ELSE NULL
                    END AS value
                FROM map_device md
                JOIN access_portico ap
                  ON ap.id = md.ref_id
                 AND ap.active = TRUE
                LEFT JOIN fleet_entities fe
                  ON fe.portico_id = ap.id
                 AND fe.entity_type = :entity_type
                WHERE md.map_code = :map_code
                  AND md.kind IN ('portico', 'portico_clima')
            ) t
            WHERE NULLIF(TRIM(value), '') IS NOT NULL
            GROUP BY value
            ORDER BY total DESC, value ASC
            LIMIT 120;
            """
        ),
        {
            "map_code": map_code,
            "entity_type": entity_type,
        },
    )

    return {
        "items": [
            {
                "value": row["value"],
                "label": row["value"],
                "count": int(row["total"] or 0),
            }
            for row in result.mappings().all()
        ]
    }


@router.get("/portico-popup/{portico_id}")
async def portico_popup(
    portico_id: int,
    mode: str = Query("current", pattern="^(current|accumulated)$"),
    db: AsyncSession = Depends(get_db),
):
    result_portico = await db.execute(
        text(
            """
            SELECT
                ap.id                AS id,
                ap.name              AS name,
                ap.site              AS site,
                ap.nivel             AS nivel,
                ap.zone              AS zone,
                ap.has_climate       AS has_climate,
                COALESCE(vc.total_events, 0) AS total_events,
                COALESCE(vc.total_in,     0) AS total_in,
                COALESCE(vc.total_out,    0) AS total_out,
                vc.last_event_at          AS last_event_at
            FROM access_portico ap
            LEFT JOIN vw_access_portico_counters vc
              ON vc.portico_id = ap.id
            WHERE ap.id = :pid;
            """
        ),
        {"pid": portico_id},
    )
    portico_row = result_portico.mappings().first()
    if not portico_row:
        return {"detail": "Portico not found"}

    if mode == "accumulated":
        result_interior = await db.execute(
            text(
                FLEET_ACTIVITY_CTE
                + """
                SELECT
                    fe.portico_id,
                    ap.name AS portico_name,
                    NULL::uuid AS tag_id,
                    fe.entity_type,
                    fe.entity_id,
                    CASE
                        WHEN fe.entity_type = 'person'
                            THEN COALESCE(NULLIF(p.full_name, ''), fe.person_group)
                        WHEN fe.entity_type = 'vehicle'
                            THEN COALESCE(NULLIF(v.patente, ''), fe.vehicle_group)
                        ELSE COALESCE(NULLIF(e.name, ''), NULLIF(e.code, ''), fe.equipment_group)
                    END AS display_name,
                    fe.last_seen_at AS ts_last,
                    ap.zone AS zone,
                    p.rut AS person_rut,
                    p.full_name AS person_full_name,
                    p.position AS person_position,
                    pc.name AS person_company_name,
                    v.patente AS vehicle_patente,
                    v.status AS vehicle_status,
                    vc.name AS vehicle_company_name,
                    e.code AS equipment_code,
                    e.name AS equipment_name,
                    ec.name AS equipment_company_name
                FROM fleet_entities fe
                JOIN access_portico ap
                  ON ap.id = fe.portico_id
                LEFT JOIN person p
                  ON p.id = fe.entity_id
                 AND fe.entity_type = 'person'
                LEFT JOIN company pc
                  ON pc.id = p.company_id
                LEFT JOIN vehicles v
                  ON v.id = fe.entity_id
                 AND fe.entity_type = 'vehicle'
                LEFT JOIN vehicle_company vc_rel
                  ON vc_rel.vehicle_id = v.id
                 AND vc_rel.active = TRUE
                LEFT JOIN company vc
                  ON vc.id = vc_rel.company_id
                LEFT JOIN equipment e
                  ON e.id = fe.entity_id
                 AND fe.entity_type = 'equipment'
                LEFT JOIN company ec
                  ON ec.id = e.company_id
                WHERE fe.portico_id = :pid
                ORDER BY fe.entity_type, fe.last_seen_at DESC, display_name ASC;
                """
            ),
            {"pid": portico_id},
        )
    else:
        result_interior = await db.execute(
            text(
                """
                SELECT
                    portico_id,
                    portico_name,
                    tag_id,
                    entity_type,
                    entity_id,
                    display_name,
                    ts_last,
                    zone,
                    person_rut,
                    person_full_name,
                    person_position,
                    person_company_name,
                    vehicle_patente,
                    vehicle_status,
                    vehicle_company_name,
                    equipment_code,
                    equipment_name,
                    equipment_company_name
                FROM vw_access_interior
                WHERE portico_id = :pid;
                """
            ),
            {"pid": portico_id},
        )
    interior_rows = result_interior.mappings().all()

    personas = []
    vehiculos = []
    equipos = []

    for r in interior_rows:
        etype = r["entity_type"]
        if etype == "person":
            personas.append(
                {
                    "id": r["entity_id"],
                    "rut": r["person_rut"],
                    "full_name": r["person_full_name"] or r["display_name"],
                    "position": r["person_position"],
                    "company_name": r["person_company_name"],
                    "last_seen_at": r["ts_last"].isoformat() if r["ts_last"] else None,
                    "zone": r["zone"],
                }
            )
        elif etype == "vehicle":
            vehiculos.append(
                {
                    "id": r["entity_id"],
                    "patente": r["vehicle_patente"],
                    "type": r["vehicle_status"],
                    "company_name": r["vehicle_company_name"],
                    "last_seen_at": r["ts_last"].isoformat() if r["ts_last"] else None,
                    "zone": r["zone"],
                }
            )
        elif etype in ("equipment", "equipo"):
            equipos.append(
                {
                    "id": r["entity_id"],
                    "code": r.get("equipment_code"),
                    "name": r.get("equipment_name") or r["display_name"],
                    "company_name": r.get("equipment_company_name"),
                    "last_seen_at": r["ts_last"].isoformat() if r["ts_last"] else None,
                    "zone": r["zone"],
                    "tag_id": r["tag_id"],
                }
            )

    climate_data = []
    climate_level = None
    if portico_row["has_climate"]:
        result_climate = await db.execute(
            text(
                """
                SELECT
                    cv.code           AS code,
                    cv.name           AS name,
                    cfg.green_max     AS green_max,
                    cfg.yellow_max    AS yellow_max,
                    cr.value          AS last_value,
                    cr.level          AS last_level,
                    cr.created_at     AS last_ts
                FROM access_portico_climate_cfg cfg
                JOIN access_climate_var cv
                  ON cv.id = cfg.climate_var_id
                LEFT JOIN LATERAL (
                    SELECT *
                    FROM access_portico_climate_reading r
                    WHERE r.portico_id = cfg.portico_id
                      AND r.climate_var_id = cfg.climate_var_id
                    ORDER BY r.created_at DESC
                    LIMIT 1
                ) cr ON TRUE
                WHERE cfg.portico_id = :pid
                ORDER BY cv.code;
                """
            ),
            {"pid": portico_id},
        )
        climate_rows = result_climate.mappings().all()
        climate_data = climate_rows

        level_priority = {"green": 0, "yellow": 1, "red": 2}
        max_level_value = -1
        max_level_name = None
        for c in climate_rows:
            lvl = c.get("last_level")
            if not lvl:
                continue
            prio = level_priority.get(lvl, -1)
            if prio > max_level_value:
                max_level_value = prio
                max_level_name = lvl

        climate_level = max_level_name

    portico = {
        "id": portico_row["id"],
        "name": portico_row["name"],
        "site": portico_row["site"],
        "nivel": portico_row["nivel"],
        "zone": portico_row["zone"],
        "has_climate": portico_row["has_climate"],
        "total_events": portico_row["total_events"],
        "total_in": portico_row["total_in"],
        "total_out": portico_row["total_out"],
        "last_event_at": portico_row["last_event_at"],
        "climate_level": climate_level,
    }

    return {
        "portico": portico,
        "personas": personas,
        "vehiculos": vehiculos,
        "equipos": equipos,
        "climate": climate_data,
    }


@router.get("/search-node")
async def search_node(term: str, db: AsyncSession = Depends(get_db)):
    """
    Busca:
      - Personas/vehículos/equipos actualmente dentro (vw_access_interior)
      - Pórticos/UR por nombre/zona/label del map_device (access_portico + map_device)

    Devuelve SIEMPRE la misma estructura de respuesta que usa el front.
    """
    if not term or not term.strip():
        return []

    pattern = f"%{term.strip().lower()}%"

    result = await db.execute(
        text(
            """
            WITH interior_matches AS (
                SELECT
                    i.entity_type,
                    i.entity_id,
                    CASE
                        WHEN i.entity_type = 'person'
                            THEN COALESCE(NULLIF(i.person_full_name, ''), i.display_name)
                        ELSE i.display_name
                    END AS display_name,
                    i.portico_id,
                    i.portico_name,
                    i.zone,
                    i.ts_last,
                    i.person_full_name,
                    ap.site_code,
                    md.id      AS map_device_id,
                    md.map_code,
                    md.x_pct,
                    md.y_pct
                FROM vw_access_interior i
                JOIN access_portico ap
                  ON ap.id = i.portico_id
                JOIN LATERAL (
                    SELECT
                        md.id,
                        md.label,
                        md.map_code,
                        md.x_pct,
                        md.y_pct
                    FROM map_device md
                    WHERE md.kind IN ('portico', 'portico_clima')
                      AND md.ref_id = i.portico_id
                    ORDER BY
                        CASE
                            WHEN ap.site_code = 'NP_MC' AND md.map_code = 'NP_dia' THEN 0
                            WHEN ap.site_code = 'NTI_AN' AND md.map_code = 'NTI_andes_norte' THEN 0
                            WHEN ap.site_code = 'UCL_DIA' AND md.map_code = 'UCL_dia' THEN 0
                            ELSE 1
                        END,
                        md.id
                    LIMIT 1
                ) md ON TRUE
                WHERE
                        LOWER(
                            COALESCE(
                                CASE
                                    WHEN i.entity_type = 'person'
                                        THEN NULLIF(i.person_full_name, '')
                                    ELSE i.display_name
                                END,
                                i.display_name,
                                ''
                            )
                        )                                       LIKE :pattern
                    OR  LOWER(COALESCE(i.person_rut, ''))      LIKE :pattern
                    OR  LOWER(COALESCE(i.person_full_name, '')) LIKE :pattern
                    OR  LOWER(COALESCE(i.vehicle_patente, '')) LIKE :pattern
                    OR  LOWER(COALESCE(i.equipment_name, ''))  LIKE :pattern
                    OR  LOWER(COALESCE(i.equipment_code, ''))  LIKE :pattern
            ),
            portico_matches AS (
                SELECT
                    'portico'::text      AS entity_type,
                    ap.id                AS entity_id,
                    ap.name              AS display_name,
                    ap.id                AS portico_id,
                    ap.name              AS portico_name,
                    ap.zone              AS zone,
                    NULL::timestamptz    AS ts_last,
                    NULL::text           AS person_full_name,
                    ap.site_code         AS site_code,
                    md.id                AS map_device_id,
                    md.map_code          AS map_code,
                    md.x_pct             AS x_pct,
                    md.y_pct             AS y_pct
                FROM access_portico ap
                JOIN LATERAL (
                    SELECT
                        md.id,
                        md.label,
                        md.map_code,
                        md.x_pct,
                        md.y_pct
                    FROM map_device md
                    WHERE md.kind IN ('portico', 'portico_clima')
                      AND md.ref_id = ap.id
                    ORDER BY
                        CASE
                            WHEN ap.site_code = 'NP_MC' AND md.map_code = 'NP_dia' THEN 0
                            WHEN ap.site_code = 'NTI_AN' AND md.map_code = 'NTI_andes_norte' THEN 0
                            WHEN ap.site_code = 'UCL_DIA' AND md.map_code = 'UCL_dia' THEN 0
                            ELSE 1
                        END,
                        md.id
                    LIMIT 1
                ) md ON TRUE
                WHERE
                        LOWER(ap.name)               LIKE :pattern
                    OR  LOWER(COALESCE(ap.zone,''))  LIKE :pattern
                    OR  LOWER(COALESCE(md.label,'')) LIKE :pattern
            )
            SELECT *
            FROM (
                SELECT * FROM interior_matches
                UNION ALL
                SELECT * FROM portico_matches
            ) t
            ORDER BY
                (t.ts_last IS NULL) ASC,          -- primero los que tienen last_seen real
                t.ts_last DESC NULLS LAST,
                t.display_name ASC
            LIMIT 20;
            """
        ),
        {"pattern": pattern},
    )

    rows = result.mappings().all()

    matches = []
    seen_entities = set()
    for r in rows:
        dedupe_key = (r["entity_type"], r["entity_id"])
        if dedupe_key in seen_entities:
            continue
        seen_entities.add(dedupe_key)

        matches.append(
            {
                "id": f"{r['entity_type']}-{r['entity_id']}",
                "entity_type": r["entity_type"],
                "entity_id": r["entity_id"],
                "label": r["display_name"],
                "portico": {
                    "id": r["portico_id"],
                    "name": r["portico_name"],
                    "zone": r["zone"],
                },
                "last_seen_at": r["ts_last"].isoformat() if r["ts_last"] else None,
                "map": {
                    "map_code": r["map_code"],
                    "device_id": r["map_device_id"],
                    "x_pct": float(r["x_pct"]),
                    "y_pct": float(r["y_pct"]),
                },
            }
        )

    return matches


# =========================================================
# NODE HISTORY (día actual) por entity_type + entity_id
# =========================================================
@router.get("/alerts/equipment-outside")
async def equipment_outside_alerts(db: AsyncSession = Depends(get_db)):
    """Equipos cuyo ultimo RFID fue visto fuera de su portico autorizado."""
    result = await db.execute(
        text(
            """
            WITH latest_equipment_event AS (
                SELECT DISTINCT ON (ta.entity_id)
                    ta.entity_id AS equipment_id,
                    COALESCE(
                        CASE
                            WHEN ae.extra ? 'portico'
                             AND (ae.extra->>'portico') ~ '^[0-9]+$'
                            THEN (ae.extra->>'portico')::bigint
                        END,
                        ap_by_gateway.id
                    ) AS actual_portico_id,
                    COALESCE(ae.ts_edge, ae.ts_ingested) AS seen_at
                FROM tag_assignment ta
                JOIN access_event ae ON ae.tag_id = ta.tag_id
                LEFT JOIN LATERAL (
                    SELECT ap.id
                    FROM access_portico ap
                    WHERE ap.gateway_id = ae.gateway_id AND ap.active = TRUE
                    ORDER BY ap.id
                    LIMIT 1
                ) ap_by_gateway ON TRUE
                WHERE ta.entity_type = 'equipment' AND ta.active = TRUE
                ORDER BY ta.entity_id, COALESCE(ae.ts_edge, ae.ts_ingested) DESC, ae.id DESC
            )
            SELECT
                e.id AS equipment_id,
                e.code AS equipment_code,
                e.name AS equipment_name,
                r.allowed_portico_id,
                allowed.name AS allowed_portico_name,
                le.actual_portico_id,
                actual.name AS actual_portico_name,
                le.seen_at,
                md.id AS map_device_id,
                md.map_code
            FROM equipment_portico_rule r
            JOIN equipment e ON e.id = r.equipment_id AND e.active = TRUE
            JOIN latest_equipment_event le ON le.equipment_id = r.equipment_id
            JOIN access_portico allowed ON allowed.id = r.allowed_portico_id
            JOIN access_portico actual ON actual.id = le.actual_portico_id
            LEFT JOIN LATERAL (
                SELECT id, map_code
                FROM map_device
                WHERE kind IN ('portico', 'portico_clima') AND ref_id = le.actual_portico_id
                ORDER BY id
                LIMIT 1
            ) md ON TRUE
            WHERE r.active = TRUE
              AND le.actual_portico_id IS DISTINCT FROM r.allowed_portico_id
            ORDER BY le.seen_at DESC
            """
        )
    )
    return [
        {
            **dict(row),
            "seen_at": row["seen_at"].isoformat() if row["seen_at"] else None,
        }
        for row in result.mappings().all()
    ]


@router.get("/node-history")
async def node_history(
    entity_type: str = Query(..., pattern="^(person|vehicle|equipment)$"),
    entity_id: int = Query(..., ge=1),
    db: AsyncSession = Depends(get_db),
):
    """
    Devuelve el historial de pórticos del día actual para una entidad (persona/vehículo/equipo),
    basado en access_event + tag_assignment + access_portico.
    """

    target_day = await _resolve_entity_history_day(db, entity_type, entity_id)

    sql = text(
        """
        WITH raw_history AS (
        SELECT
            ae.id                                AS event_id,
            COALESCE(ae.ts_edge, ae.ts_ingested) AS ts_event,
            ae.direction                         AS direction,
            ae.zone                              AS zone,
            COALESCE(ap_by_extra.id, ap_by_gw.id) AS portico_id,
            COALESCE(ap_by_extra.name, ap_by_gw.name) AS portico_name,
            COALESCE(ap_by_extra.gateway_id, ap_by_gw.gateway_id) AS gateway_id,
            md.id                                AS map_device_id,
            md.map_code                          AS map_code,
            md.x_pct                             AS x_pct,
            md.y_pct                             AS y_pct
        FROM access_event ae
        JOIN tag_assignment ta
          ON ta.tag_id = ae.tag_id
         AND ta.entity_type = :entity_type
         AND ta.entity_id   = :entity_id
         AND ta.active      = TRUE
        LEFT JOIN LATERAL (
            SELECT
                ap.id,
                ap.name,
                ap.gateway_id,
                ap.site_code
            FROM access_portico ap
            WHERE ap.active = TRUE
              AND ae.extra ? 'portico'
              AND (ae.extra->>'portico') ~ '^[0-9]+$'
              AND ap.id = (ae.extra->>'portico')::bigint
            LIMIT 1
        ) ap_by_extra ON TRUE
        LEFT JOIN LATERAL (
            SELECT
                ap.id,
                ap.name,
                ap.gateway_id,
                ap.site_code
            FROM access_portico ap
            WHERE ap.active = TRUE
              AND ap.gateway_id = ae.gateway_id
            ORDER BY ap.id
            LIMIT 1
        ) ap_by_gw ON TRUE
        LEFT JOIN LATERAL (
            SELECT
                md.id,
                md.map_code,
                md.x_pct,
                md.y_pct
            FROM map_device md
            WHERE md.kind IN ('portico', 'portico_clima')
              AND md.ref_id = COALESCE(ap_by_extra.id, ap_by_gw.id)
            ORDER BY
                CASE
                    WHEN COALESCE(ap_by_extra.site_code, ap_by_gw.site_code) = 'NP_MC' AND md.map_code = 'NP_dia' THEN 0
                    WHEN COALESCE(ap_by_extra.site_code, ap_by_gw.site_code) = 'NTI_AN' AND md.map_code = 'NTI_andes_norte' THEN 0
                    WHEN COALESCE(ap_by_extra.site_code, ap_by_gw.site_code) = 'UCL_DIA' AND md.map_code = 'UCL_dia' THEN 0
                    ELSE 1
                END,
                md.id
            LIMIT 1
        ) md ON TRUE
        WHERE COALESCE(ae.ts_edge, ae.ts_ingested) >= :target_day
          AND COALESCE(ae.ts_edge, ae.ts_ingested) < :target_day + interval '1 day'
          AND COALESCE(ap_by_extra.id, ap_by_gw.id) IS NOT NULL
        ), state_changes AS (
            SELECT
                raw_history.*,
                LAG(event_id) OVER event_order AS previous_event_id,
                LAG(direction) OVER event_order AS previous_direction,
                LAG(portico_id) OVER event_order AS previous_portico_id,
                LAG(zone) OVER event_order AS previous_zone
            FROM raw_history
            WINDOW event_order AS (ORDER BY ts_event ASC, event_id ASC)
        )
        SELECT
            ts_event,
            direction,
            zone,
            portico_id,
            portico_name,
            gateway_id,
            map_device_id,
            map_code,
            x_pct,
            y_pct
        FROM state_changes
        -- Una rafaga de lecturas IN (o OUT) en el mismo portico/zona es una
        -- sola transicion. Solo vuelve a mostrarse si cambia el estado o nodo.
        WHERE previous_event_id IS NULL
           OR direction IS DISTINCT FROM previous_direction
           OR portico_id IS DISTINCT FROM previous_portico_id
           OR zone IS DISTINCT FROM previous_zone
        ORDER BY ts_event ASC, event_id ASC
        LIMIT 500
        """
    )

    res = await db.execute(
        sql,
        {
            "entity_type": entity_type,
            "entity_id": entity_id,
            "target_day": target_day,
        },
    )
    data = res.mappings().all()

    out = []
    for r in data:
        out.append(
            {
                "ts_edge": r["ts_event"].isoformat() if r["ts_event"] else None,
                "ts_event": r["ts_event"].isoformat() if r["ts_event"] else None,
                "direction": r["direction"],
                "zone": r["zone"],
                "portico": {
                    "id": r["portico_id"],
                    "name": r["portico_name"],
                    "gateway_id": r["gateway_id"],
                },
                "map": (
                    {
                        "device_id": r["map_device_id"],
                        "map_code": r["map_code"],
                        "x_pct": float(r["x_pct"]),
                        "y_pct": float(r["y_pct"]),
                    }
                    if r["map_device_id"] is not None
                    else None
                ),
            }
        )

    return out
