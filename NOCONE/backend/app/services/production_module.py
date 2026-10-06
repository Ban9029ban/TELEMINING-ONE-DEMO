from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


SEED_PATH = Path(__file__).resolve().parents[1] / "data" / "production_module_seed.json"
DEFAULT_OPERATION_DATE = "2026-06-02T00:00:00"
SANTIAGO_TZ = ZoneInfo("America/Santiago")
OPERATIONAL_TIME_FIELDS = (
    "plannedStart",
    "plannedEnd",
    "realStart",
    "realEnd",
    "cncExternalStart",
    "cncExternalEnd",
    "cncInternalStart",
    "cncInternalEnd",
    "hip",
    "htp",
    "hir",
    "htr",
    "hie",
    "hte",
    "hii",
    "hti",
)


def load_seed_payload() -> Dict[str, Any]:
    if not SEED_PATH.exists():
        return build_empty_payload()

    raw = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    return repair_payload_text(raw)


def build_empty_payload() -> Dict[str, Any]:
    return {
        "meta": {
            "sourceWorkbook": "sql-seed",
            "operationDate": DEFAULT_OPERATION_DATE,
            "generatedAt": None,
            "maps": [
                {"code": "NP_dia", "label": "Diamante - NP"},
                {"code": "NTI_andes_norte", "label": "NTI Andes Norte"},
                {"code": "NTI_dia", "label": "NTI Dia"},
                {"code": "UCL_dia", "label": "UCL"},
            ],
        },
        "permissions": {
            "allowedRoles": ["admin_produccion"],
        },
        "referenceData": {
            "lists": {
                "Cuadrilla": [],
                "Turnos": [],
                "Equipos": [],
                "Niveles": [],
                "Posturas": [],
                "Mineria": [],
                "OOCC": [],
            },
            "cnc": {"external": [], "internal": []},
        },
        "dashboard": {
            "cumplimientoMineria": 0,
            "cumplimientoOOCC": 0,
        },
        "schedule": {
            "waypoints": [],
            "controlMineria": [],
            "controlOOCC": [],
            "ganttMineria": {"rows": []},
            "ganttOOCC": {"rows": []},
            "hoursMineria": {"crew": [], "equipment": []},
        },
    }


def repair_payload_text(value: Any) -> Any:
    if isinstance(value, str):
        repaired = value
        if any(token in repaired for token in ("Ã", "Â", "ð", "Ð")):
            try:
                repaired = repaired.encode("latin1").decode("utf-8")
            except UnicodeError:
                repaired = value
        return repaired

    if isinstance(value, list):
        return [repair_payload_text(item) for item in value]

    if isinstance(value, dict):
        return {
            repair_payload_text(key) if isinstance(key, str) else key: repair_payload_text(item)
            for key, item in value.items()
        }

    return value


def _clone(value: Any) -> Any:
    return deepcopy(value)


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _parse_operational_dt(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=SANTIAGO_TZ)
    return parsed.astimezone(SANTIAGO_TZ)


def _to_utc_dt(value: Any) -> datetime | None:
    parsed = _parse_operational_dt(value)
    return parsed.astimezone(timezone.utc) if parsed else None


def _duration_minutes(start_value: Any, end_value: Any) -> int:
    start = _parse_dt(start_value)
    end = _parse_dt(end_value)
    if not start or not end:
        return 0
    return max(0, int((end - start).total_seconds() // 60))


def _normalize_operational_dt(value: Any, operation_date: Any) -> str | None:
    parsed = _parse_dt(value)
    base_date = _parse_dt(operation_date) or _parse_dt(DEFAULT_OPERATION_DATE)
    if not parsed or not base_date:
        return str(value) if value else None

    normalized = parsed
    if normalized.date() == base_date.date() and normalized.hour < 12:
        normalized += timedelta(days=1)

    return normalized.isoformat(timespec="seconds")


def _sort_tasks(tasks: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(
        tasks,
        key=lambda item: (
            _parse_dt(item.get("plannedStart"))
            or _parse_dt(item.get("realStart"))
            or _parse_dt(item.get("date"))
            or datetime(1970, 1, 1)
        ),
    )


def _normalize_list_aliases(payload: Dict[str, Any]) -> None:
    reference_data = payload.setdefault("referenceData", {})
    lists = reference_data.setdefault("lists", {})

    mineria_items = lists.get("Mineria") or lists.get("Minería") or []
    oocc_items = lists.get("OOCC") or lists.get("OO.CC") or []
    turnos = lists.get("Turnos") or []

    lists["Mineria"] = mineria_items
    lists["OOCC"] = oocc_items
    lists["Turnos"] = [
        {
            "code": "Si" if str(item.get("code") or "") == "Sí" else item.get("code"),
            "label": "Si" if str(item.get("label") or "") == "Sí" else item.get("label"),
        }
        for item in turnos
    ]


def _normalize_task(task: Dict[str, Any], domain: str) -> Dict[str, Any]:
    normalized = dict(task)
    normalized["domain"] = domain

    for key in OPERATIONAL_TIME_FIELDS:
        normalized_value = _normalize_operational_dt(normalized.get(key), normalized.get("date"))
        if normalized_value:
            normalized[key] = normalized_value

    normalized["linkedPeople"] = [
        item for item in (normalized.get("linkedPeople") or []) if isinstance(item, dict)
    ]
    normalized["linkedVehicles"] = [
        item for item in (normalized.get("linkedVehicles") or []) if isinstance(item, dict)
    ]
    normalized["roles"] = list(normalized.get("roles") or [])
    normalized["progress"] = min(1.0, max(0.0, _safe_float(normalized.get("progress"), 0.0)))
    normalized["priority"] = max(0, _safe_int(normalized.get("priority"), 0))
    normalized["plannedMinutes"] = _duration_minutes(
        normalized.get("plannedStart"), normalized.get("plannedEnd")
    )
    normalized["realMinutes"] = _duration_minutes(normalized.get("realStart"), normalized.get("realEnd"))
    normalized["delayMinutes"] = max(
        0,
        normalized["realMinutes"] - normalized["plannedMinutes"],
    )

    if normalized["progress"] >= 1:
        normalized["status"] = "completed"
    elif normalized.get("realStart") and not normalized.get("realEnd"):
        normalized["status"] = "in_progress"
    elif normalized["delayMinutes"] > 0:
        normalized["status"] = "delayed"
    elif normalized.get("realStart"):
        normalized["status"] = "partially_complete"
    else:
        normalized["status"] = normalized.get("status") or "planned"

    return normalized


def _build_waypoints(tasks: List[Dict[str, Any]], previous_waypoints: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    previous_map = {str(item.get("id")): item for item in previous_waypoints or []}
    grouped: Dict[str, Dict[str, Any]] = {}

    for task in tasks:
        waypoint_id = str(task.get("waypointId") or "")
        if not waypoint_id:
            continue

        current = grouped.get(waypoint_id) or {
            "id": waypoint_id,
            "label": task.get("postura") or waypoint_id,
            "postura": task.get("postura") or waypoint_id,
            "nivel": task.get("nivel") or "",
            "mapCode": task.get("mapCode") or "NP_dia",
            "domains": set(),
            "taskCounts": {"mineria": 0, "oocc": 0},
            "trackingPorticoId": None,
            "trackingPorticoName": "",
            "observations": task.get("observation") or "",
        }
        current["domains"].add(task.get("domain") or "mineria")
        current["taskCounts"][task.get("domain") or "mineria"] += 1
        if task.get("trackingPorticoId"):
            current["trackingPorticoId"] = task.get("trackingPorticoId")
            current["trackingPorticoName"] = task.get("trackingPorticoName") or current["trackingPorticoName"]
        if not current["observations"] and task.get("observation"):
            current["observations"] = task.get("observation")
        grouped[waypoint_id] = current

    ordered = []
    for index, waypoint_id in enumerate(sorted(grouped.keys())):
        current = grouped[waypoint_id]
        previous = previous_map.get(waypoint_id) or {}
        x_pct = previous.get("xPct")
        y_pct = previous.get("yPct")
        if x_pct is None or y_pct is None:
            col = index % 4
            row = index // 4
            x_pct = round(min(0.84, 0.18 + col * 0.18), 4)
            y_pct = round(min(0.82, 0.18 + row * 0.16), 4)

        ordered.append(
            {
                **current,
                "domains": sorted(current["domains"]),
                "xPct": _safe_float(x_pct, 0.2),
                "yPct": _safe_float(y_pct, 0.2),
            }
        )

    return ordered


def _build_hours(tasks: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    crew_rows: Dict[str, Dict[str, Any]] = {}
    equipment_rows: Dict[str, Dict[str, Any]] = {}

    for task in tasks:
        planned_hours = round((_safe_int(task.get("plannedMinutes")) / 60), 2)
        real_hours = round((_safe_int(task.get("realMinutes")) / 60), 2)

        crew_plan = str(task.get("crewPlanned") or "").strip()
        crew_real = str(task.get("crewReal") or "").strip()
        equipment_plan = str(task.get("equipmentPlanned") or "").strip()
        equipment_real = str(task.get("equipmentReal") or "").strip()

        if crew_plan:
            current = crew_rows.setdefault(
                crew_plan,
                {
                    "label": crew_plan,
                    "plannedHours": 0,
                    "realHours": 0,
                    "targetHours": 0,
                    "plannedTasks": 0,
                    "realTasks": 0,
                },
            )
            current["plannedHours"] += planned_hours
            current["targetHours"] += planned_hours
            current["plannedTasks"] += 1

        if crew_real:
            current = crew_rows.setdefault(
                crew_real,
                {
                    "label": crew_real,
                    "plannedHours": 0,
                    "realHours": 0,
                    "targetHours": 0,
                    "plannedTasks": 0,
                    "realTasks": 0,
                },
            )
            current["realHours"] += real_hours
            current["realTasks"] += 1

        if equipment_plan:
            current = equipment_rows.setdefault(
                equipment_plan,
                {
                    "label": equipment_plan,
                    "plannedHours": 0,
                    "realHours": 0,
                    "targetHours": 0,
                    "plannedTasks": 0,
                    "realTasks": 0,
                },
            )
            current["plannedHours"] += planned_hours
            current["targetHours"] += planned_hours
            current["plannedTasks"] += 1

        if equipment_real:
            current = equipment_rows.setdefault(
                equipment_real,
                {
                    "label": equipment_real,
                    "plannedHours": 0,
                    "realHours": 0,
                    "targetHours": 0,
                    "plannedTasks": 0,
                    "realTasks": 0,
                },
            )
            current["realHours"] += real_hours
            current["realTasks"] += 1

    crew = sorted(
        (
            {
                **item,
                "plannedHours": round(item["plannedHours"], 2),
                "realHours": round(item["realHours"], 2),
                "targetHours": round(item["targetHours"], 2),
            }
            for item in crew_rows.values()
        ),
        key=lambda item: item["plannedHours"],
        reverse=True,
    )
    equipment = sorted(
        (
            {
                **item,
                "plannedHours": round(item["plannedHours"], 2),
                "realHours": round(item["realHours"], 2),
                "targetHours": round(item["targetHours"], 2),
            }
            for item in equipment_rows.values()
        ),
        key=lambda item: item["plannedHours"],
        reverse=True,
    )

    return {"crew": crew, "equipment": equipment}


def _average_progress(tasks: List[Dict[str, Any]]) -> float:
    if not tasks:
        return 0.0
    return sum(_safe_float(task.get("progress"), 0.0) for task in tasks) / len(tasks)


def _build_gantt_rows(waypoints: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [
        {
            "waypointId": item.get("id"),
            "postura": item.get("postura"),
            "nivel": item.get("nivel"),
            "mapCode": item.get("mapCode"),
            "observations": item.get("observations") or "",
        }
        for item in waypoints
    ]


async def _fetch_tagged_entities(
    db: AsyncSession, entity_type: str, table_name: str, label_column: str, limit: int
) -> List[Dict[str, Any]]:
    query = text(
        f"""
        SELECT
            e.id,
            e.{label_column} AS label,
            ta.tag_id
        FROM {table_name} e
        JOIN LATERAL (
            SELECT tag_id
            FROM tag_assignment ta
            WHERE ta.entity_type = :entity_type
              AND ta.entity_id = e.id
              AND ta.active = TRUE
            ORDER BY ta.updated_at DESC NULLS LAST, ta.id DESC
            LIMIT 1
        ) ta ON TRUE
        ORDER BY e.id ASC
        LIMIT :limit
        """
    )
    result = await db.execute(query, {"entity_type": entity_type, "limit": limit})
    return [dict(row) for row in result.mappings().all()]


async def _fetch_porticos(db: AsyncSession) -> List[Dict[str, Any]]:
    result = await db.execute(
        text(
            """
            SELECT id, name, gateway_id, site_code, nivel, zone
            FROM access_portico
            WHERE active = TRUE
            ORDER BY id ASC
            """
        )
    )
    return [dict(row) for row in result.mappings().all()]


def _pick_portico_for_task(porticos: List[Dict[str, Any]], task: Dict[str, Any], index: int) -> Dict[str, Any] | None:
    if not porticos:
        return None

    map_code = str(task.get("mapCode") or "").upper()
    nivel = str(task.get("nivel") or "").upper()

    matching = [
        item
        for item in porticos
        if nivel and str(item.get("nivel") or "").upper() == nivel
        or map_code and str(item.get("site_code") or "").upper().startswith(map_code[:3])
    ]
    source = matching or porticos
    return source[index % len(source)]


async def _seed_tracking_events_for_task(
    db: AsyncSession,
    task: Dict[str, Any],
    portico: Dict[str, Any],
) -> None:
    start = _to_utc_dt(task.get("realStart") or task.get("plannedStart"))
    end = _to_utc_dt(task.get("realEnd") or task.get("plannedEnd"))
    if not start:
        return
    if not end or end <= start:
        end = start + timedelta(minutes=max(20, _safe_int(task.get("plannedMinutes"), 30)))

    start_naive = _parse_dt(task.get("realStart") or task.get("plannedStart"))
    end_naive = _parse_dt(task.get("realEnd") or task.get("plannedEnd"))
    cleanup_start = min(
        start,
        start_naive.replace(tzinfo=timezone.utc) if start_naive else start,
    ) - timedelta(hours=1)
    cleanup_end = max(
        end,
        end_naive.replace(tzinfo=timezone.utc) if end_naive else end,
    ) + timedelta(hours=1)

    entities: List[Tuple[str, Dict[str, Any]]] = []
    entities.extend(("person", item) for item in task.get("linkedPeople") or [])
    entities.extend(("vehicle", item) for item in task.get("linkedVehicles") or [])

    for entity_type, entity in entities:
        tag_id = entity.get("tagId")
        entity_id = entity.get("id")
        if not tag_id or not entity_id:
            continue

        payload = {
            "tag_id": tag_id,
            "gateway_id": portico.get("gateway_id"),
            "portico_id": str(portico.get("id")) if portico.get("id") is not None else None,
            "zone": portico.get("zone") or task.get("nivel") or "NP",
            "level": 1,
            "kind": entity_type,
            "start_ts": start,
            "end_ts": end,
            "cleanup_start": cleanup_start,
            "cleanup_end": cleanup_end,
        }

        delete_sql = """
            DELETE FROM access_event
            WHERE tag_id = :tag_id
              AND COALESCE(extra->>'origin', '') = 'production_module_seed'
              AND COALESCE(ts_edge, ts_ingested) BETWEEN :cleanup_start AND :cleanup_end
        """
        if payload["portico_id"] is not None:
            delete_sql += """
              AND COALESCE(extra->>'portico', '') = CAST(:portico_id AS text)
            """

        await db.execute(text(delete_sql), payload)

        for direction, key in (("in", "start_ts"), ("out", "end_ts")):
            await db.execute(
                text(
                    """
                    INSERT INTO access_event (
                        tag_id,
                        gateway_id,
                        ts_edge,
                        ts_ingested,
                        zone,
                        direction,
                        level,
                        kind,
                        extra
                    )
                    SELECT
                        :tag_id,
                        :gateway_id,
                        :event_ts,
                        :event_ts,
                        CAST(:zone AS varchar),
                        CAST(:direction AS varchar),
                        :level,
                        CAST(:kind AS varchar),
                        jsonb_build_object('portico', CAST(:portico_id AS text), 'origin', 'production_module_seed')
                    WHERE NOT EXISTS (
                        SELECT 1
                        FROM access_event ae
                        WHERE ae.tag_id = :tag_id
                          AND ae.gateway_id = :gateway_id
                          AND COALESCE(ae.ts_edge, ae.ts_ingested) = :event_ts
                          AND ae.direction = CAST(:direction AS varchar)
                    )
                    """
                ),
                {
                    **payload,
                    "direction": direction,
                    "event_ts": payload[key],
                },
            )


async def validate_task_tracking(
    db: AsyncSession,
    task: Dict[str, Any],
) -> Dict[str, Any]:
    tracking_portico_id = task.get("trackingPorticoId")
    linked_people = [item for item in (task.get("linkedPeople") or []) if isinstance(item, dict)]
    linked_vehicles = [item for item in (task.get("linkedVehicles") or []) if isinstance(item, dict)]

    if not tracking_portico_id or (not linked_people and not linked_vehicles):
        return {"status": "no_links", "items": []}

    start = _to_utc_dt(task.get("realStart") or task.get("plannedStart"))
    end = _to_utc_dt(task.get("realEnd") or task.get("plannedEnd"))
    if not start:
        return {"status": "no_links", "items": []}
    if not end or end <= start:
        end = start + timedelta(minutes=max(20, _safe_int(task.get("plannedMinutes"), 30)))

    window_start = start - timedelta(minutes=15)
    window_end = end + timedelta(minutes=15)
    try:
        portico_id = int(tracking_portico_id)
    except (TypeError, ValueError):
        return {"status": "no_links", "items": []}

    sql = text(
        """
        SELECT
            COUNT(*) AS events,
            MIN(event_ts) AS first_seen,
            MAX(event_ts) AS last_seen
        FROM (
            SELECT
                COALESCE(ae.ts_edge, ae.ts_ingested) AS event_ts,
                COALESCE(
                    CASE
                        WHEN ae.extra ? 'portico' AND (ae.extra->>'portico') ~ '^[0-9]+$'
                        THEN (ae.extra->>'portico')::bigint
                        ELSE NULL
                    END,
                    ap_by_gw.id
                ) AS portico_id
            FROM access_event ae
            JOIN tag_assignment ta
              ON ta.tag_id = ae.tag_id
             AND ta.entity_type = :entity_type
             AND ta.entity_id = :entity_id
             AND ta.active = TRUE
            LEFT JOIN LATERAL (
                SELECT ap.id
                FROM access_portico ap
                WHERE ap.gateway_id = ae.gateway_id
                  AND ap.active = TRUE
                ORDER BY ap.id
                LIMIT 1
            ) ap_by_gw ON TRUE
            WHERE COALESCE(ae.ts_edge, ae.ts_ingested) >= :window_start
              AND COALESCE(ae.ts_edge, ae.ts_ingested) <= :window_end
        ) events
        WHERE events.portico_id = :portico_id
        """
    )

    items = []
    for entity_type, entities in (("person", linked_people), ("vehicle", linked_vehicles)):
        for entity in entities:
            entity_id = entity.get("id")
            if entity_id in (None, ""):
                continue
            result = await db.execute(
                sql,
                {
                    "entity_type": entity_type,
                    "entity_id": entity_id,
                    "window_start": window_start,
                    "window_end": window_end,
                    "portico_id": portico_id,
                },
            )
            row = result.mappings().first() or {}
            first_seen = row.get("first_seen")
            last_seen = row.get("last_seen")
            events = int(row.get("events") or 0)
            dwell_minutes = 0
            if first_seen and last_seen:
                dwell_minutes = max(0, int((last_seen - first_seen).total_seconds() // 60))

            items.append(
                {
                    "id": entity_id,
                    "name": entity.get("name") or entity.get("label") or f"{entity_type} {entity_id}",
                    "label": entity.get("label") or entity.get("name") or f"{entity_type} {entity_id}",
                    "entityType": entity_type,
                    "matched": events > 0,
                    "events": events,
                    "dwellMinutes": dwell_minutes,
                    "firstSeen": first_seen.isoformat() if first_seen else None,
                    "lastSeen": last_seen.isoformat() if last_seen else None,
                }
            )

    matched_count = sum(1 for item in items if item["matched"])
    status = "missing"
    if matched_count == len(items) and items:
        status = "ok"
    elif matched_count > 0:
        status = "partial"

    return {
        "status": status if items else "no_links",
        "items": items,
        "window": {
            "start": start.isoformat(),
            "end": end.isoformat(),
        },
    }


async def enrich_payload_from_db(db: AsyncSession, payload: Dict[str, Any]) -> Dict[str, Any]:
    normalized = repair_payload_text(_clone(payload or build_empty_payload()))
    normalized.setdefault("meta", {})
    normalized["meta"].setdefault("operationDate", DEFAULT_OPERATION_DATE)
    normalized["meta"]["generatedAt"] = (
        normalized["meta"].get("generatedAt") or datetime.utcnow().isoformat() + "Z"
    )
    normalized.setdefault("permissions", {}).setdefault("allowedRoles", ["admin_produccion"])
    normalized.setdefault("dashboard", {})
    normalized.setdefault("schedule", {})
    normalized.setdefault("referenceData", {}).setdefault("cnc", {"external": [], "internal": []})
    _normalize_list_aliases(normalized)

    schedule = normalized["schedule"]
    mineria_tasks = [
        _normalize_task(item, "mineria") for item in schedule.get("controlMineria") or []
    ]
    oocc_tasks = [
        _normalize_task(item, "oocc") for item in schedule.get("controlOOCC") or []
    ]

    tagged_people = await _fetch_tagged_entities(db, "person", "person", "full_name", 24)
    tagged_vehicles = await _fetch_tagged_entities(db, "vehicle", "vehicles", "patente", 12)
    porticos = await _fetch_porticos(db)
    people_by_id = {item["id"]: item for item in tagged_people}
    vehicles_by_id = {item["id"]: item for item in tagged_vehicles}

    for index, task in enumerate(mineria_tasks + oocc_tasks):
        portico = _pick_portico_for_task(porticos, task, index)
        if portico and not task.get("trackingPorticoId"):
            task["trackingPorticoId"] = portico.get("id")
            task["trackingPorticoName"] = portico.get("name") or ""

        if not task.get("linkedPeople") and tagged_people:
            first = tagged_people[index % len(tagged_people)]
            second = tagged_people[(index + 5) % len(tagged_people)]
            linked_people = []
            for item in (first, second):
                if item["id"] in {entity.get("id") for entity in linked_people}:
                    continue
                linked_people.append(
                    {
                        "id": item["id"],
                        "name": item["label"],
                        "label": item["label"],
                        "type": "person",
                        "tagId": item["tag_id"],
                    }
                )
            task["linkedPeople"] = linked_people
        else:
            task["linkedPeople"] = [
                {
                    **entity,
                    "tagId": entity.get("tagId") or people_by_id.get(entity.get("id"), {}).get("tag_id"),
                }
                for entity in task.get("linkedPeople") or []
            ]

        if not task.get("linkedVehicles") and tagged_vehicles:
            vehicle = tagged_vehicles[index % len(tagged_vehicles)]
            if index % 2 == 0:
                task["linkedVehicles"] = [
                    {
                        "id": vehicle["id"],
                        "name": vehicle["label"],
                        "label": vehicle["label"],
                        "type": "vehicle",
                        "tagId": vehicle["tag_id"],
                    }
                ]
        else:
            task["linkedVehicles"] = [
                {
                    **entity,
                    "tagId": entity.get("tagId") or vehicles_by_id.get(entity.get("id"), {}).get("tag_id"),
                }
                for entity in task.get("linkedVehicles") or []
            ]

    all_tasks = _sort_tasks(mineria_tasks + oocc_tasks)
    waypoints = _build_waypoints(all_tasks, schedule.get("waypoints") or [])

    normalized["schedule"]["controlMineria"] = _sort_tasks(mineria_tasks)
    normalized["schedule"]["controlOOCC"] = _sort_tasks(oocc_tasks)
    normalized["schedule"]["waypoints"] = waypoints
    normalized["schedule"]["ganttMineria"] = {"rows": _build_gantt_rows(waypoints)}
    normalized["schedule"]["ganttOOCC"] = {"rows": _build_gantt_rows(waypoints)}
    normalized["schedule"]["hoursMineria"] = _build_hours(mineria_tasks)
    normalized["dashboard"]["cumplimientoMineria"] = round(_average_progress(mineria_tasks), 4)
    normalized["dashboard"]["cumplimientoOOCC"] = round(_average_progress(oocc_tasks), 4)

    portico_map = {item["id"]: item for item in porticos}
    for task in all_tasks:
        portico = portico_map.get(task.get("trackingPorticoId"))
        if portico:
            await _seed_tracking_events_for_task(db, task, portico)

    return normalized
