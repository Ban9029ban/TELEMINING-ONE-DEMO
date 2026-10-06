"""Listener ingest endpoint.

Receives BLE frames from the TCP listener and RFID UHF frames from GAO/Impinj
readers, then persists them into `access_event`.

Production rules
----------------
- A tag must already exist in `tag` and have an active assignment to be stored.
- Unknown or unassigned tags are ignored and never inserted into `tag`.
- RFID reads use the configured portico mode:
  - `ACCESS`: antenna 1 -> 2 means entry, 2 -> 1 means exit.
  - `READ`: any valid read means presence at the portico.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tag_codes import normalize_tag_code
from app.db.db import get_db
from app.schemas.tag_listener import TagBleIn, TagRfidIn


router = APIRouter(prefix="/listener", tags=["listener"])

PORTICO_MODE_READ = "READ"
PORTICO_MODE_ACCESS = "ACCESS"


def _normalize_tag_code(raw: str) -> str:
    return normalize_tag_code(raw)


def _normalize_portico_mode(raw: Optional[str]) -> str:
    value = str(raw or "").strip().upper()
    if value == PORTICO_MODE_ACCESS:
        return PORTICO_MODE_ACCESS
    return PORTICO_MODE_READ


def _coerce_int(value: Any, default: Optional[int] = None) -> Optional[int]:
    if value in (None, ""):
        return default
    try:
        return int(value)
    except Exception:
        return default


def _ensure_uuid(val: object) -> uuid.UUID:
    if isinstance(val, uuid.UUID):
        return val
    if isinstance(val, str):
        return uuid.UUID(val)
    if isinstance(val, int):
        return uuid.UUID(int=val)
    raise TypeError(f"UUID invalido: {type(val).__name__}")


def _safe_ts(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    else:
        ts = ts.astimezone(timezone.utc)
    if ts.year < 2020:
        ts = datetime.now(timezone.utc)
    return ts


def _level_from_portico(nivel: Optional[str]) -> int:
    parsed = _coerce_int(nivel)
    return parsed if parsed is not None else 1


def _remote_host_from_remote_addr(remote_addr: Optional[str]) -> Optional[str]:
    value = str(remote_addr or "").strip()
    if not value:
        return None

    if value.startswith("["):
        end = value.find("]")
        if end > 0:
            return value[1:end].strip() or None

    if value.count(":") == 1:
        host, _port = value.rsplit(":", 1)
        return host.strip() or None

    return value


def _transport_remote_addr_from_raw_event(raw_event: Optional[Dict[str, Any]]) -> Optional[str]:
    if not isinstance(raw_event, dict):
        return None
    value = raw_event.get("transport_remote_addr") or raw_event.get("remote_addr")
    return str(value).strip() if value else None


def _antenna_role(
    antenna_port: Optional[int],
    *,
    antenna_in_port: Optional[int],
    antenna_out_port: Optional[int],
) -> Optional[str]:
    if antenna_port is None:
        return None
    if antenna_in_port is not None and antenna_port == antenna_in_port:
        return "entry_side"
    if antenna_out_port is not None and antenna_port == antenna_out_port:
        return "exit_side"
    return "reader_side"


def _resolve_rfid_direction_and_logic(
    *,
    operating_mode: str,
    antenna_port: Optional[int],
    antenna_in_port: Optional[int],
    antenna_out_port: Optional[int],
    previous_antenna_port: Optional[int],
) -> Dict[str, str]:
    mode = _normalize_portico_mode(operating_mode)

    if mode == PORTICO_MODE_ACCESS:
        if (
            antenna_port is not None
            and previous_antenna_port is not None
            and antenna_in_port is not None
            and antenna_out_port is not None
        ):
            if previous_antenna_port == antenna_in_port and antenna_port == antenna_out_port:
                return {"direction": "in", "logic": "access_sequence_entry"}
            if previous_antenna_port == antenna_out_port and antenna_port == antenna_in_port:
                return {"direction": "out", "logic": "access_sequence_exit"}

        if antenna_port is not None and antenna_in_port is not None and antenna_port == antenna_in_port:
            return {"direction": "in", "logic": "access_presence_entry_side"}
        if antenna_port is not None and antenna_out_port is not None and antenna_port == antenna_out_port:
            return {"direction": "in", "logic": "access_presence_exit_side"}
        return {"direction": "in", "logic": "access_presence_unknown_side"}

    return {"direction": "in", "logic": "read_presence"}


async def _get_trackable_tag_id(db: AsyncSession, raw_code: str) -> Optional[uuid.UUID]:
    code = _normalize_tag_code(raw_code)
    if not code:
        raise ValueError("tag/EPC vacio")

    res = await db.execute(
        text(
            """
            SELECT t.id
            FROM tag t
            WHERE t.code = :code
              AND EXISTS (
                SELECT 1
                FROM tag_assignment ta
                WHERE ta.tag_id = t.id
                  AND ta.active = TRUE
              )
            ORDER BY t.id
            LIMIT 1
            """
        ),
        {"code": code},
    )
    row = res.first()
    if not row:
        return None
    return _ensure_uuid(row[0])


async def _get_or_create_gateway_id(db: AsyncSession, gateway_name: str) -> uuid.UUID:
    name = (gateway_name or "").strip()
    if not name:
        raise ValueError("gateway/reader vacio")

    res = await db.execute(
        text("SELECT id FROM gateway WHERE name = :name ORDER BY id LIMIT 1"),
        {"name": name},
    )
    row = res.first()
    if row:
        return _ensure_uuid(row[0])

    res = await db.execute(
        text("INSERT INTO gateway (name) VALUES (:name) RETURNING id"),
        {"name": name},
    )
    return _ensure_uuid(res.scalar_one())


async def _find_portico_id(
    db: AsyncSession,
    edge_id: Optional[str],
    gateway_id: uuid.UUID,
) -> Optional[int]:
    if edge_id:
        res = await db.execute(
            text(
                """
                SELECT id
                FROM access_portico
                WHERE specific_name = :sn
                   OR site_code = :sn
                   OR :sn = ANY(COALESCE(listener_aliases, ARRAY[]::text[]))
                ORDER BY id
                LIMIT 1
                """
            ),
            {"sn": edge_id},
        )
        row = res.first()
        if row:
            return int(row[0])

    res = await db.execute(
        text("SELECT id FROM access_portico WHERE gateway_id = :gid ORDER BY id LIMIT 1"),
        {"gid": gateway_id},
    )
    row = res.first()
    return int(row[0]) if row else None


async def _find_portico_specific_name(
    db: AsyncSession,
    edge_id: Optional[str],
) -> Optional[int]:
    if not edge_id:
        return None

    res = await db.execute(
        text(
            """
            SELECT id
            FROM access_portico
            WHERE specific_name = :sn
               OR site_code = :sn
               OR :sn = ANY(COALESCE(listener_aliases, ARRAY[]::text[]))
            ORDER BY id
            LIMIT 1
            """
        ),
        {"sn": edge_id},
    )
    row = res.first()
    return int(row[0]) if row else None


async def _load_portico_config_by_specific_name(
    db: AsyncSession,
    specific_name: str,
) -> Optional[Dict[str, Any]]:
    res = await db.execute(
        text(
            """
            SELECT
              ap.id,
              ap.name,
              ap.zone,
              ap.nivel,
              ap.specific_name,
              ap.listener_aliases,
              ap.operating_mode,
              ap.antenna_in_port,
              ap.antenna_out_port,
              ap.sequence_window_seconds
            FROM access_portico ap
            WHERE ap.active = TRUE
              AND (
                ap.specific_name = :specific_name
                OR ap.site_code = :specific_name
                OR :specific_name = ANY(COALESCE(ap.listener_aliases, ARRAY[]::text[]))
              )
            ORDER BY ap.id
            LIMIT 1
            """
        ),
        {"specific_name": specific_name},
    )
    row = res.mappings().first()
    if not row:
        return None
    return {
        "id": int(row["id"]),
        "name": row["name"],
        "zone": row["zone"],
        "nivel": row["nivel"],
        "specific_name": row["specific_name"],
        "listener_aliases": row["listener_aliases"] or [],
        "operating_mode": _normalize_portico_mode(row["operating_mode"]),
        "antenna_in_port": _coerce_int(row["antenna_in_port"], default=1),
        "antenna_out_port": _coerce_int(row["antenna_out_port"]),
        "sequence_window_seconds": max(1, _coerce_int(row["sequence_window_seconds"], default=15) or 15),
    }


async def _load_portico_config_by_gateway(
    db: AsyncSession,
    gateway_id: uuid.UUID,
) -> Optional[Dict[str, Any]]:
    res = await db.execute(
        text(
            """
            SELECT
              ap.id,
              ap.name,
              ap.zone,
              ap.nivel,
              ap.specific_name,
              ap.listener_aliases,
              ap.operating_mode,
              ap.antenna_in_port,
              ap.antenna_out_port,
              ap.sequence_window_seconds
            FROM access_portico ap
            WHERE ap.active = TRUE
              AND ap.gateway_id = :gateway_id
            ORDER BY ap.id
            LIMIT 1
            """
        ),
        {"gateway_id": gateway_id},
    )
    row = res.mappings().first()
    if not row:
        return None
    return {
        "id": int(row["id"]),
        "name": row["name"],
        "zone": row["zone"],
        "nivel": row["nivel"],
        "specific_name": row["specific_name"],
        "listener_aliases": row["listener_aliases"] or [],
        "operating_mode": _normalize_portico_mode(row["operating_mode"]),
        "antenna_in_port": _coerce_int(row["antenna_in_port"], default=1),
        "antenna_out_port": _coerce_int(row["antenna_out_port"]),
        "sequence_window_seconds": max(1, _coerce_int(row["sequence_window_seconds"], default=15) or 15),
    }


async def _load_portico_config_by_gateway_name(
    db: AsyncSession,
    gateway_name: str,
) -> Optional[Dict[str, Any]]:
    res = await db.execute(
        text(
            """
            SELECT
              ap.id,
              ap.name,
              ap.zone,
              ap.nivel,
              ap.specific_name,
              ap.listener_aliases,
              ap.operating_mode,
              ap.antenna_in_port,
              ap.antenna_out_port,
              ap.sequence_window_seconds
            FROM access_portico ap
            JOIN gateway g
              ON g.id = ap.gateway_id
            WHERE ap.active = TRUE
              AND g.name = :gateway_name
            ORDER BY ap.id
            LIMIT 1
            """
        ),
        {"gateway_name": gateway_name},
    )
    row = res.mappings().first()
    if not row:
        return None
    return {
        "id": int(row["id"]),
        "name": row["name"],
        "zone": row["zone"],
        "nivel": row["nivel"],
        "specific_name": row["specific_name"],
        "listener_aliases": row["listener_aliases"] or [],
        "operating_mode": _normalize_portico_mode(row["operating_mode"]),
        "antenna_in_port": _coerce_int(row["antenna_in_port"], default=1),
        "antenna_out_port": _coerce_int(row["antenna_out_port"]),
        "sequence_window_seconds": max(1, _coerce_int(row["sequence_window_seconds"], default=15) or 15),
    }


async def _find_rfid_portico_config(
    db: AsyncSession,
    *,
    gateway_id: uuid.UUID,
    reader_code: str,
    reader_host: Optional[str],
    antenna_port: Optional[int],
    raw_event: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    candidates = []
    if antenna_port is not None:
        candidates.append(f"{reader_code}:ANT{antenna_port}")
        if reader_host and reader_host != reader_code:
            candidates.append(f"{reader_host}:ANT{antenna_port}")

    for edge in (reader_code, reader_host):
        if edge:
            candidates.append(edge)

    seen = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        portico = await _load_portico_config_by_specific_name(db, candidate)
        if portico:
            return portico

    transport_remote_addr = _transport_remote_addr_from_raw_event(raw_event)
    transport_remote_host = _remote_host_from_remote_addr(transport_remote_addr)
    if transport_remote_host:
        if antenna_port is not None:
            portico = await _load_portico_config_by_specific_name(
                db,
                f"{transport_remote_host}:ANT{antenna_port}",
            )
            if portico:
                return portico

        portico = await _load_portico_config_by_specific_name(db, transport_remote_host)
        if portico:
            return portico

        portico = await _load_portico_config_by_gateway_name(db, transport_remote_host)
        if portico:
            return portico

    return await _load_portico_config_by_gateway(db, gateway_id)


async def _get_previous_rfid_portico_event(
    db: AsyncSession,
    *,
    tag_id: uuid.UUID,
    portico_id: int,
    seen_at: datetime,
    window_seconds: int,
) -> Optional[Dict[str, Any]]:
    window_start = _safe_ts(seen_at) - timedelta(seconds=max(1, int(window_seconds)))
    res = await db.execute(
        text(
            """
            SELECT
              CASE
                WHEN (ae.extra->>'antenna_port') ~ '^[0-9]+$'
                THEN (ae.extra->>'antenna_port')::int
                ELSE NULL
              END AS antenna_port,
              ae.direction,
              COALESCE(ae.ts_edge, ae.ts_ingested) AS seen_at
            FROM access_event ae
            WHERE ae.tag_id = :tag_id
              AND ae.kind = 'rfid'
              AND ae.extra ? 'portico'
              AND ae.extra->>'portico' = :portico_id
              AND COALESCE(ae.ts_edge, ae.ts_ingested) >= :window_start
              AND COALESCE(ae.ts_edge, ae.ts_ingested) < :seen_at
            ORDER BY COALESCE(ae.ts_edge, ae.ts_ingested) DESC, ae.id DESC
            LIMIT 1
            """
        ),
        {
            "tag_id": tag_id,
            "portico_id": str(portico_id),
            "window_start": window_start,
            "seen_at": _safe_ts(seen_at),
        },
    )
    row = res.mappings().first()
    if not row:
        return None

    return {
        "antenna_port": _coerce_int(row["antenna_port"]),
        "direction": row["direction"],
        "seen_at": row["seen_at"],
    }


async def _touch_portico_communication(
    db: AsyncSession,
    *,
    portico_id: int,
    reader_code: str,
    epc: str,
) -> None:
    """Actualiza liveness tecnico sin convertir un EPC desconocido en acceso."""
    await db.execute(
        text(
            """
            INSERT INTO portico_communication (
                portico_id, last_seen_at, last_reader_code, last_epc
            ) VALUES (:portico_id, NOW(), :reader_code, :epc)
            ON CONFLICT (portico_id) DO UPDATE
            SET last_seen_at = EXCLUDED.last_seen_at,
                last_reader_code = EXCLUDED.last_reader_code,
                last_epc = EXCLUDED.last_epc
            """
        ),
        {
            "portico_id": portico_id,
            "reader_code": reader_code,
            "epc": epc,
        },
    )
async def _insert_access_event(
    db: AsyncSession,
    *,
    tag_id: uuid.UUID,
    gateway_id: uuid.UUID,
    ts_edge: datetime,
    direction: str,
    kind: str,
    signal: str,
    rssi: Optional[int],
    zone: Optional[str],
    level: int,
    extra: Dict[str, Any],
) -> uuid.UUID:
    extra_json = json.dumps(extra, ensure_ascii=False)

    res = await db.execute(
        text(
            """
            INSERT INTO access_event
              (tag_id, gateway_id, ts_edge, direction, kind, signal, rssi, level, zone, extra)
            VALUES
              (:tag_id, :gateway_id, :ts_edge, :direction, :kind, :signal, :rssi, :level, :zone, CAST(:extra AS jsonb))
            RETURNING id
            """
        ),
        {
            "tag_id": tag_id,
            "gateway_id": gateway_id,
            "ts_edge": _safe_ts(ts_edge),
            "direction": direction,
            "kind": kind,
            "signal": signal,
            "rssi": rssi,
            "level": level,
            "zone": zone,
            "extra": extra_json,
        },
    )
    return _ensure_uuid(res.scalar_one())


@router.post("/tag-ble")
async def ingest_tag_ble(payload: TagBleIn, db: AsyncSession = Depends(get_db)):
    signal = "BT"
    normalized_tag = _normalize_tag_code(payload.bt_id)

    try:
        tag_id = await _get_trackable_tag_id(db, payload.bt_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"tag invalido: {exc}")

    if tag_id is None:
        return {
            "ok": True,
            "stored": False,
            "ignored": True,
            "reason": "tag_not_registered_or_assigned",
            "source": "ble",
            "tag_code": normalized_tag,
            "gateway": payload.backbone_code,
        }

    try:
        gateway_id = await _get_or_create_gateway_id(db, payload.backbone_code)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"gateway invalido: {exc}")

    portico_id = await _find_portico_id(db, payload.edge_id, gateway_id)
    extra: Dict[str, Any] = {
        "source": "ble",
        "signal": signal,
        "edge_id": payload.edge_id,
        "edge_kind": payload.edge_kind,
        "raw_line": payload.raw_line,
        "direction_logic": "ble_presence",
    }
    if portico_id is not None:
        extra["portico"] = portico_id

    access_event_id = await _insert_access_event(
        db,
        tag_id=tag_id,
        gateway_id=gateway_id,
        ts_edge=payload.ts_edge,
        direction="in",
        kind="ble",
        signal=signal,
        rssi=payload.rssi,
        zone=None,
        level=1,
        extra=extra,
    )
    await db.commit()

    return {
        "ok": True,
        "stored": True,
        "ignored": False,
        "source": "ble",
        "access_event_id": str(access_event_id),
        "tag_code": normalized_tag,
        "gateway": payload.backbone_code,
        "portico_id": portico_id,
        "direction": "in",
        "logic": "ble_presence",
    }


@router.post("/tag-rfid")
async def ingest_tag_rfid(payload: TagRfidIn, db: AsyncSession = Depends(get_db)):
    signal = "RFID_UHF"
    normalized_tag = _normalize_tag_code(payload.epc)

    try:
        gateway_id = await _get_or_create_gateway_id(db, payload.reader_code)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"reader/gateway invalido: {exc}")

    portico = await _find_rfid_portico_config(
        db,
        gateway_id=gateway_id,
        reader_code=payload.reader_code,
        reader_host=payload.reader_host,
        antenna_port=payload.antenna_port,
        raw_event=payload.raw_event,
    )
    if portico:
        await _touch_portico_communication(
            db,
            portico_id=int(portico["id"]),
            reader_code=payload.reader_code,
            epc=normalized_tag,
        )

    try:
        tag_id = await _get_trackable_tag_id(db, payload.epc)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"EPC invalido: {exc}")

    if tag_id is None:
        await db.commit()
        return {
            "ok": True,
            "stored": False,
            "ignored": True,
            "reason": "tag_not_registered_or_assigned",
            "source": "gao",
            "tag_code": normalized_tag,
            "gateway": payload.reader_code,
            "antenna_port": payload.antenna_port,
        }

    previous_event = None
    direction_logic = {"direction": "in", "logic": "reader_presence_unmapped"}
    if portico:
        previous_event = await _get_previous_rfid_portico_event(
            db,
            tag_id=tag_id,
            portico_id=int(portico["id"]),
            seen_at=payload.ts_edge,
            window_seconds=int(portico["sequence_window_seconds"]),
        )
        direction_logic = _resolve_rfid_direction_and_logic(
            operating_mode=portico["operating_mode"],
            antenna_port=payload.antenna_port,
            antenna_in_port=portico["antenna_in_port"],
            antenna_out_port=portico["antenna_out_port"],
            previous_antenna_port=previous_event["antenna_port"] if previous_event else None,
        )

    extra: Dict[str, Any] = {
        "source": "gao",
        "signal": signal,
        "reader_code": payload.reader_code,
        "reader_host": payload.reader_host or payload.reader_code,
        "antenna_port": payload.antenna_port,
        "antenna_name": payload.antenna_name,
        "tid": payload.tid,
        "frequency": payload.frequency,
        "phase": payload.phase_angle,
        "phase_angle": payload.phase_angle,
        "transmit_power_cdbm": payload.transmit_power_cdbm,
        "raw_event": payload.raw_event,
        "direction_logic": direction_logic["logic"],
    }

    transport_remote_addr = _transport_remote_addr_from_raw_event(payload.raw_event)
    transport_remote_host = _remote_host_from_remote_addr(transport_remote_addr)
    if transport_remote_addr:
        extra["transport_remote_addr"] = transport_remote_addr
    if transport_remote_host:
        extra["transport_remote_host"] = transport_remote_host

    zone = None
    level = 1
    if portico:
        zone = portico["zone"]
        level = _level_from_portico(portico["nivel"])
        extra["portico"] = int(portico["id"])
        extra["portico_name"] = portico["name"]
        extra["portico_mode"] = portico["operating_mode"]
        extra["antenna_in_port"] = portico["antenna_in_port"]
        extra["antenna_out_port"] = portico["antenna_out_port"]
        extra["sequence_window_seconds"] = portico["sequence_window_seconds"]
        extra["antenna_role"] = _antenna_role(
            payload.antenna_port,
            antenna_in_port=portico["antenna_in_port"],
            antenna_out_port=portico["antenna_out_port"],
        )
        if previous_event:
            extra["previous_antenna_port"] = previous_event["antenna_port"]
            extra["previous_direction"] = previous_event["direction"]
            extra["previous_seen_at"] = previous_event["seen_at"].isoformat() if previous_event["seen_at"] else None

    access_event_id = await _insert_access_event(
        db,
        tag_id=tag_id,
        gateway_id=gateway_id,
        ts_edge=payload.ts_edge,
        direction=direction_logic["direction"],
        kind="rfid",
        signal=signal,
        rssi=payload.rssi,
        zone=zone,
        level=level,
        extra=extra,
    )
    await db.commit()

    return {
        "ok": True,
        "stored": True,
        "ignored": False,
        "source": "gao",
        "access_event_id": str(access_event_id),
        "tag_code": normalized_tag,
        "gateway": payload.reader_code,
        "antenna_port": payload.antenna_port,
        "portico_id": int(portico["id"]) if portico else None,
        "portico_mode": portico["operating_mode"] if portico else None,
        "direction": direction_logic["direction"],
        "logic": direction_logic["logic"],
    }
