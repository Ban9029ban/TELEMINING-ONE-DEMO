from __future__ import annotations

import asyncio
import base64
import io
import json
import mimetypes
import os
import re
import shutil
import socket
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

import numpy as np
import onnxruntime as ort
import requests
from PIL import Image
from fastapi import APIRouter, Body, Depends, File, HTTPException, Path as FastApiPath, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.permissions import is_admin_role, user_has_any_permission
from app.db.db import async_session, get_db
from app.deps.auth import get_current_user
from app.models import AiModel
from app.services.app_settings import (
    CAMERA_MONITORING_DEFAULT_INTERVAL_SECONDS,
    get_camera_monitoring_interval_seconds,
    get_nok_visual_layout,
    upsert_nok_visual_layout,
)
from app.schemas.cameras import (
    AiModelOut,
    CameraAnalyticsSnapshotIn,
    CameraAnalyzeFrameIn,
    CameraAnalyzeFrameOut,
    CameraDetectionOut,
    CameraEvidenceVideoUploadOut,
    CameraExternalFindingIn,
    CameraExternalFindingOut,
    CameraFindingOut,
    CameraFindingSnapshotRowIn,
    CameraRecentFindingIn,
    CamerasConfigOut,
    CameraSourceIn,
    CameraSourceProbeOut,
    CameraVideoOut,
)

router = APIRouter(prefix="/cameras", tags=["cameras"])


async def _require_camera_permission(
    db: AsyncSession,
    current: Any,
    *required_pairs: tuple[str, str],
) -> None:
    allowed = await user_has_any_permission(
        db,
        int(current.id),
        getattr(current, "role", None),
        required_pairs,
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="Usuario sin permisos para este recurso")

DEFAULT_AI_MODELS = [
    {
        "code": "operational_safety_monitor",
        "name": "Monitor operacional y seguridad",
        "description": (
            "Combina deteccion general en navegador con apoyo PPE desde backend "
            "para hallazgos de personas, vehiculos y EPP en tiempo real."
        ),
    },
    {
        "code": "person_detection",
        "name": "Deteccion de personas",
        "description": "Detecta y dibuja bounding boxes sobre personas en la escena.",
    },
    {
        "code": "person_count",
        "name": "Conteo de personas",
        "description": "Cuenta cuantas personas hay en el frame.",
    },
    {
        "code": "object_detection",
        "name": "Deteccion de objetos generales",
        "description": "Detecta objetos comunes en la escena.",
    },
    {
        "code": "bolt_detection",
        "name": "Deteccion de pernos / vehiculos",
        "description": "Detecta pernos o vehiculos segun el modelo configurado.",
    },
]

CAMERA_SOURCE_TYPES = {"video_file", "mp4_url", "hls", "http", "rtsp"}
DEVICE_KINDS = {"camera", "gate", "fan"}
DEVICE_KIND_ALIASES = {
    "camara": "camera",
    "camaras": "camera",
    "cctv": "camera",
    "porton": "gate",
    "portones": "gate",
    "gate": "gate",
    "gates": "gate",
    "ventilador": "fan",
    "ventiladores": "fan",
    "fan": "fan",
    "fans": "fan",
}
DEVICE_KIND_LABELS = {
    "camera": "Camara",
    "gate": "Porton",
    "fan": "Ventilador",
}
NOK_SUPPORT_DEVICE_KINDS = ("gate", "fan")
STREAM_ROOT = Path(os.getenv("TMONE_CAMERA_STREAM_ROOT", "/tmp/tmone_camera_streams"))
STREAM_HLS_TIME = max(1, int(os.getenv("TMONE_CAMERA_HLS_TIME", "2")))
STREAM_HLS_LIST_SIZE = max(3, int(os.getenv("TMONE_CAMERA_HLS_LIST_SIZE", "6")))
STREAM_BOOT_TIMEOUT = max(5.0, float(os.getenv("TMONE_CAMERA_STREAM_BOOT_TIMEOUT", "18")))
STREAM_TOUCH_TTL = max(15.0, float(os.getenv("TMONE_CAMERA_STREAM_TOUCH_TTL", "120")))
STREAM_PROBE_TIMEOUT = max(4.0, float(os.getenv("TMONE_CAMERA_STREAM_PROBE_TIMEOUT", "10")))
FFMPEG_BIN = os.getenv("TMONE_FFMPEG_BIN") or shutil.which("ffmpeg") or "ffmpeg"
EVIDENCE_ROOT = Path(os.getenv("TMONE_CAMERA_EVIDENCE_ROOT", "/tmp/tmone_camera_evidence"))
EVIDENCE_ALLOWED_EXTENSIONS = {".mp4", ".webm", ".mov", ".mkv", ".avi"}

PPE_MODEL_URL = os.getenv(
    "TMONE_PPE_MODEL_URL",
    "https://huggingface.co/Hexmon/vyra-yolo-ppe-detection/resolve/main/best.onnx?download=true",
)
PPE_MODEL_FILE = Path(os.getenv("TMONE_PPE_MODEL_FILE", "/tmp/tmone_models/vyra_ppe_best.onnx"))
PPE_INPUT = 640
PPE_IOU_THRESHOLD = 0.45
PPE_FALLBACK_SSL = os.getenv("TMONE_PPE_ALLOW_INSECURE_SSL", "true").lower() == "true"
OPERATIONAL_MODEL_URL = os.getenv(
    "TMONE_OPERATIONAL_MODEL_URL",
    "http://zenit-web/models/yolov8s.onnx",
)
OPERATIONAL_MODEL_FILE = Path(os.getenv("TMONE_OPERATIONAL_MODEL_FILE", "/tmp/tmone_models/yolov8s.onnx"))
OPERATIONAL_MODEL_MIN_BYTES = 5_000_000

PPE_CLASS_NAMES = {
    0: "Fall-Detected",
    1: "Gloves",
    2: "Goggles",
    3: "Hardhat",
    4: "Ladder",
    5: "Mask",
    6: "NO-Gloves",
    7: "NO-Goggles",
    8: "NO-Hardhat",
    9: "NO-Mask",
    10: "NO-Safety Vest",
    11: "Person",
    12: "Safety Cone",
    13: "Safety Vest",
}

PPE_SUPPORTED_FINDINGS = {
    "1": {"label": "Personal sin casco de seguridad", "severity": "high"},
    "3": {"label": "Personal sin lentes de seguridad", "severity": "medium"},
    "5": {"label": "Personal sin guantes antigolpe", "severity": "high"},
    "15": {"label": "Personal ejecutando labores con EPP incompleto", "severity": "high"},
}

OPERATIONAL_CLASS_NAMES = {
    0: "Persona",
    1: "Bicicleta",
    2: "Auto",
    3: "Moto",
    5: "Bus",
    7: "Camion",
    67: "Celular",
}
OPERATIONAL_PERSON_IDS = {0}
OPERATIONAL_VEHICLE_IDS = {1, 2, 3, 5, 7}
OPERATIONAL_PHONE_IDS = {67}

CAMERA_DASHBOARD_DEMO_PANEL = "dashboard_live_demo"
CAMERA_DASHBOARD_DEMO_MODEL = "operational_safety_monitor"
CAMERA_DASHBOARD_STALE_MINUTES = 90
CAMERA_POSITION_OVERRIDES: dict[int, dict[str, float]] = {}
NOK_MAP_DISPLAY_ORDER = {
    "NP_dia": 10,
    "NTI_nok": 20,
    "NTI_andes_norte": 20,
    "NTI_dia": 30,
    "UCL_dia": 40,
}
CAMERA_NETWORK_MONITOR_ENABLED = os.getenv("TMONE_CAMERA_NETWORK_MONITOR_ENABLED", "true").lower() == "true"
CAMERA_NETWORK_MONITOR_INTERVAL_FALLBACK_SECONDS = max(
    30.0,
    float(os.getenv("TMONE_CAMERA_NETWORK_MONITOR_INTERVAL_SECONDS", str(CAMERA_MONITORING_DEFAULT_INTERVAL_SECONDS))),
)
CAMERA_NETWORK_REFRESH_TTL_FALLBACK_SECONDS = max(
    30.0,
    float(os.getenv("TMONE_CAMERA_NETWORK_REFRESH_TTL_SECONDS", str(CAMERA_MONITORING_DEFAULT_INTERVAL_SECONDS))),
)
CAMERA_NETWORK_PING_TIMEOUT_SECONDS = max(
    0.5,
    float(os.getenv("TMONE_CAMERA_NETWORK_PING_TIMEOUT_SECONDS", "1.5")),
)
CAMERA_NETWORK_PROBE_CONCURRENCY = max(
    1,
    int(os.getenv("TMONE_CAMERA_NETWORK_PROBE_CONCURRENCY", "20")),
)
PING_BIN = shutil.which("ping")
CAMERA_NETWORK_STATUS_LOG_TABLE = "camera_network_status_log_instance"
CAMERA_NETWORK_STATUS_CURRENT_TABLE = "camera_network_status_current_instance"


def _clean_monitor_meta(value: Any) -> str | None:
    text_value = str(value or "").strip()
    return text_value or None


def _slugify_monitor_meta(value: Any, fallback: str) -> str:
    normalized = re.sub(r"[^a-z0-9._-]+", "-", str(value or "").strip().casefold()).strip("-._")
    return normalized or fallback


def _resolve_camera_network_monitor_host() -> str:
    return (
        _clean_monitor_meta(os.getenv("COMPUTERNAME"))
        or _clean_monitor_meta(os.getenv("HOSTNAME"))
        or _clean_monitor_meta(socket.gethostname())
        or "backend"
    )


def _resolve_camera_network_monitor_instance_id() -> str:
    explicit = _clean_monitor_meta(os.getenv("TMONE_CAMERA_NETWORK_MONITOR_INSTANCE_ID"))
    if explicit:
        return explicit[:160]

    env_fragment = _slugify_monitor_meta(os.getenv("APP_ENV") or settings.app_env or "develop", "develop")
    host_fragment = _slugify_monitor_meta(_resolve_camera_network_monitor_host(), "backend")
    return f"{env_fragment}@{host_fragment}"[:160]


CAMERA_NETWORK_MONITOR_HOST = _resolve_camera_network_monitor_host()
CAMERA_NETWORK_MONITOR_INSTANCE_ID = _resolve_camera_network_monitor_instance_id()

_ppe_session: ort.InferenceSession | None = None
_operational_session: ort.InferenceSession | None = None


@dataclass
class CameraRelayRuntime:
    camera_id: int
    source_signature: str
    output_dir: Path
    playlist_path: Path
    process: asyncio.subprocess.Process
    started_at: float
    last_touched: float


@dataclass
class CameraNetworkProbeResult:
    camera_id: int
    camera_name: str
    camera_ip: str | None
    camera_port: int | None
    checked_at: datetime
    is_online: bool
    status: str
    response_ms: int | None
    error_detail: str | None
    check_method: str


_relay_registry: dict[int, CameraRelayRuntime] = {}
_relay_locks: dict[int, asyncio.Lock] = {}
_camera_network_monitor_task: asyncio.Task | None = None
_camera_network_monitor_stop: asyncio.Event | None = None
_camera_network_refresh_lock = asyncio.Lock()


def _camera_lock(camera_id: int) -> asyncio.Lock:
    lock = _relay_locks.get(camera_id)
    if lock is None:
        lock = asyncio.Lock()
        _relay_locks[camera_id] = lock
    return lock


async def _ensure_default_ai_models(db: AsyncSession) -> None:
    result = await db.execute(select(AiModel.code))
    existing_codes = {code for code in result.scalars().all() if code}

    for item in DEFAULT_AI_MODELS:
        if item["code"] in existing_codes:
            continue
        db.add(
            AiModel(
                code=item["code"],
                name=item["name"],
                description=item["description"],
            )
        )

    await db.commit()


async def _ensure_camera_source_schema(db: AsyncSession) -> None:
    await db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS camera_video (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                device_kind TEXT NOT NULL DEFAULT 'camera',
                source TEXT NOT NULL DEFAULT '',
                source_type TEXT NOT NULL DEFAULT 'video_file',
                camera_ip TEXT NULL,
                camera_port INTEGER NULL,
                camera_path TEXT NULL,
                camera_user TEXT NULL,
                camera_password TEXT NULL,
                site TEXT NULL,
                nivel TEXT NULL,
                map_code TEXT NULL,
                x_pct DOUBLE PRECISION NULL,
                y_pct DOUBLE PRECISION NULL,
                nok_map_code TEXT NULL,
                nok_x_pct DOUBLE PRECISION NULL,
                nok_y_pct DOUBLE PRECISION NULL,
                nok_alt_map_number INTEGER NULL,
                nok_alt_display_name TEXT NULL,
                notes TEXT NULL,
                nok_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                nok_map_number INTEGER NULL,
                nok_display_name TEXT NULL,
                is_seed_overridden BOOLEAN NOT NULL DEFAULT FALSE,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
    )

    alter_statements = [
        "ALTER TABLE camera_video ADD COLUMN IF NOT EXISTS device_kind TEXT NOT NULL DEFAULT 'camera'",
        "ALTER TABLE camera_video ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'video_file'",
        "ALTER TABLE camera_video ADD COLUMN IF NOT EXISTS camera_ip TEXT NULL",
        "ALTER TABLE camera_video ADD COLUMN IF NOT EXISTS camera_port INTEGER NULL",
        "ALTER TABLE camera_video ADD COLUMN IF NOT EXISTS camera_path TEXT NULL",
        "ALTER TABLE camera_video ADD COLUMN IF NOT EXISTS camera_user TEXT NULL",
        "ALTER TABLE camera_video ADD COLUMN IF NOT EXISTS camera_password TEXT NULL",
        "ALTER TABLE camera_video ADD COLUMN IF NOT EXISTS site TEXT NULL",
        "ALTER TABLE camera_video ADD COLUMN IF NOT EXISTS nivel TEXT NULL",
        "ALTER TABLE camera_video ADD COLUMN IF NOT EXISTS map_code TEXT NULL",
        "ALTER TABLE camera_video ADD COLUMN IF NOT EXISTS x_pct DOUBLE PRECISION NULL",
        "ALTER TABLE camera_video ADD COLUMN IF NOT EXISTS y_pct DOUBLE PRECISION NULL",
        "ALTER TABLE camera_video ADD COLUMN IF NOT EXISTS nok_map_code TEXT NULL",
        "ALTER TABLE camera_video ADD COLUMN IF NOT EXISTS nok_x_pct DOUBLE PRECISION NULL",
        "ALTER TABLE camera_video ADD COLUMN IF NOT EXISTS nok_y_pct DOUBLE PRECISION NULL",
        "ALTER TABLE camera_video ADD COLUMN IF NOT EXISTS nok_alt_map_number INTEGER NULL",
        "ALTER TABLE camera_video ADD COLUMN IF NOT EXISTS nok_alt_display_name TEXT NULL",
        "ALTER TABLE camera_video ADD COLUMN IF NOT EXISTS notes TEXT NULL",
        "ALTER TABLE camera_video ADD COLUMN IF NOT EXISTS nok_enabled BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE camera_video ADD COLUMN IF NOT EXISTS nok_map_number INTEGER NULL",
        "ALTER TABLE camera_video ADD COLUMN IF NOT EXISTS nok_display_name TEXT NULL",
        "ALTER TABLE camera_video ADD COLUMN IF NOT EXISTS is_seed_overridden BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE camera_video ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
        "ALTER TABLE camera_video ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
        "UPDATE camera_video SET device_kind = 'camera' WHERE COALESCE(device_kind, '') = ''",
        "ALTER TABLE camera_video ALTER COLUMN source SET DEFAULT ''",
    ]
    for sql in alter_statements:
        await db.execute(text(sql))

    await db.execute(
        text(
            """
            UPDATE camera_video
            SET source_type = CASE
                WHEN COALESCE(source_type, '') = '' AND source ILIKE 'rtsp://%' THEN 'rtsp'
                WHEN COALESCE(source_type, '') = '' AND source ILIKE '%.m3u8%' THEN 'hls'
                WHEN COALESCE(source_type, '') = '' AND source ILIKE 'http%' THEN 'mp4_url'
                WHEN COALESCE(source_type, '') = '' THEN 'video_file'
                ELSE source_type
            END,
            updated_at = NOW()
            """
        )
    )
    await db.commit()


def _normalize_source_type(value: Any) -> str:
    raw = str(value or "").strip().lower()
    aliases = {
        "file": "video_file",
        "video": "video_file",
        "video_local": "video_file",
        "mp4": "mp4_url",
        "url": "mp4_url",
        "m3u8": "hls",
        "https": "http",
    }
    normalized = aliases.get(raw, raw or "video_file")
    if normalized not in CAMERA_SOURCE_TYPES:
        raise HTTPException(status_code=422, detail=f"Tipo de fuente invalido: {value}")
    return normalized


def _normalize_device_kind(value: Any) -> str:
    raw = str(value or "").strip().lower()
    normalized = DEVICE_KIND_ALIASES.get(raw, raw or "camera")
    if normalized not in DEVICE_KINDS:
        raise HTTPException(status_code=422, detail=f"Tipo de dispositivo invalido: {value}")
    return normalized


def _device_kind_label(device_kind: str) -> str:
    return DEVICE_KIND_LABELS.get(device_kind, device_kind.title())


def _coalesce_str(value: Any) -> str | None:
    text_value = str(value or "").strip()
    return text_value or None


def _normalize_compare_text(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").casefold())


def _normalize_map_code(value: Any) -> str | None:
    map_code = _coalesce_str(value)
    if not map_code:
        return None
    if len(map_code) > 120 or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", map_code):
        raise HTTPException(status_code=422, detail=f"Mapa invalido: {map_code}")
    return map_code


def _default_map_label(map_code: str) -> str:
    cleaned = str(map_code or "").strip()
    if not cleaned:
        return "Plano sin nombre"
    return cleaned.replace("_", " ")


def _sort_nok_map_key(map_code: str) -> tuple[int, str]:
    return (NOK_MAP_DISPLAY_ORDER.get(map_code, 1000), map_code)


def _validate_pct(value: Any, label: str) -> float | None:
    if value is None or value == "":
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"{label} invalido") from exc
    if parsed < 0 or parsed > 1:
        raise HTTPException(status_code=422, detail=f"{label} debe estar entre 0 y 1")
    return round(parsed, 4)


def _slugify_fragment(value: Any, fallback: str) -> str:
    raw = str(value or "").strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", raw).strip("-")
    return slug or fallback


def _guess_evidence_extension(filename: str | None, content_type: str | None) -> str:
    suffix = Path(filename or "").suffix.lower()
    if suffix in EVIDENCE_ALLOWED_EXTENSIONS:
        return suffix

    guessed = mimetypes.guess_extension(str(content_type or "").strip().lower()) or ""
    if guessed == ".qt":
        guessed = ".mov"
    if guessed in EVIDENCE_ALLOWED_EXTENSIONS:
        return guessed

    return ".mp4"


def _build_finding_evidence_video_url(finding_event_id: int, evidence_video_name: str | None) -> str | None:
    if not evidence_video_name:
        return None
    return f"{settings.api_prefix}/cameras/external/findings/{finding_event_id}/evidence-video"


def _build_source_from_parts(source_type: str, row: dict[str, Any]) -> str:
    source = str(row.get("source") or "").strip()
    if source:
        return source

    path = str(row.get("camera_path") or "").strip()
    if source_type == "video_file":
        if not path:
            return ""
        return path if path.startswith("/") else f"/videos/{path}"

    host = str(row.get("camera_ip") or "").strip()
    if not host:
        return ""

    username = str(row.get("camera_user") or "").strip()
    password = str(row.get("camera_password") or "").strip()
    auth_fragment = ""
    if username:
        safe_user = quote(username, safe="")
        safe_password = quote(password, safe="") if password else ""
        auth_fragment = f"{safe_user}:{safe_password}@" if safe_password else f"{safe_user}@"

    if source_type == "rtsp":
        scheme = "rtsp"
        default_port = 554
    elif source_type in {"http", "hls", "mp4_url"}:
        scheme = "https" if str(row.get("camera_port") or "") == "443" else "http"
        default_port = 443 if scheme == "https" else 80
    else:
        return source

    clean_path = path.lstrip("/")
    port = row.get("camera_port")
    port_fragment = ""
    if port:
        try:
            numeric_port = int(port)
            if numeric_port != default_port:
                port_fragment = f":{numeric_port}"
        except (TypeError, ValueError):
            port_fragment = f":{port}"

    if clean_path:
        return f"{scheme}://{auth_fragment}{host}{port_fragment}/{clean_path}"
    return f"{scheme}://{auth_fragment}{host}{port_fragment}"


def _enrich_camera_parts(row: dict[str, Any]) -> dict[str, Any]:
    source = str(row.get("source") or "").strip()
    if not source or source.startswith("/"):
        return row

    parsed = urlparse(source)
    if parsed.scheme not in {"rtsp", "http", "https"}:
        return row

    if not row.get("camera_ip") and parsed.hostname:
        row["camera_ip"] = parsed.hostname
    if not row.get("camera_port"):
        row["camera_port"] = parsed.port or (554 if parsed.scheme == "rtsp" else 443 if parsed.scheme == "https" else 80)
    if not row.get("camera_user") and parsed.username:
        row["camera_user"] = parsed.username
    if not row.get("camera_password") and parsed.password:
        row["camera_password"] = parsed.password
    if not row.get("camera_path"):
        path = parsed.path.lstrip("/")
        if parsed.query:
            path = f"{path}?{parsed.query}"
        row["camera_path"] = path or None
    return row


def _mask_source_credentials(source: str) -> str:
    if not source:
        return source
    parsed = urlparse(source)
    if not parsed.username:
        return source

    host = parsed.hostname or ""
    port_fragment = f":{parsed.port}" if parsed.port else ""
    user = parsed.username
    masked_auth = f"{quote(user, safe='')}:" + "***@"
    if not parsed.password:
        masked_auth = f"{quote(user, safe='')}@"

    path = parsed.path or ""
    if parsed.query:
        path = f"{path}?{parsed.query}"
    return f"{parsed.scheme}://{masked_auth}{host}{port_fragment}{path}"


def _source_type_label(source_type: str) -> str:
    labels = {
        "video_file": "Video local",
        "mp4_url": "MP4 por URL",
        "hls": "HLS",
        "http": "HTTP / MJPEG",
        "rtsp": "RTSP",
    }
    return labels.get(source_type, source_type.upper())


def _camera_row_to_out(row: dict[str, Any]) -> dict[str, Any]:
    data = dict(row)
    data["device_kind"] = _normalize_device_kind(data.get("device_kind"))
    data["device_kind_label"] = _device_kind_label(data["device_kind"])
    data["source_type"] = _normalize_source_type(data.get("source_type"))
    data = _enrich_camera_parts(data)
    resolved_source = _build_source_from_parts(data["source_type"], data)
    masked_source = _mask_source_credentials(resolved_source)
    data["source"] = masked_source
    data["map_code"] = _normalize_map_code(data.get("map_code")) if data.get("map_code") else None
    data["x_pct"] = float(data["x_pct"]) if data.get("x_pct") is not None else None
    data["y_pct"] = float(data["y_pct"]) if data.get("y_pct") is not None else None
    data["nok_map_code"] = _normalize_map_code(data.get("nok_map_code")) if data.get("nok_map_code") else None
    data["nok_x_pct"] = float(data["nok_x_pct"]) if data.get("nok_x_pct") is not None else None
    data["nok_y_pct"] = float(data["nok_y_pct"]) if data.get("nok_y_pct") is not None else None
    data["nok_alt_map_number"] = int(data["nok_alt_map_number"]) if data.get("nok_alt_map_number") is not None else None
    data["nok_alt_display_name"] = _coalesce_str(data.get("nok_alt_display_name"))
    data["nok_enabled"] = bool(data.get("nok_enabled"))
    data["nok_map_number"] = int(data["nok_map_number"]) if data.get("nok_map_number") is not None else None
    data["nok_display_name"] = _coalesce_str(data.get("nok_display_name"))

    has_secret_source = bool(_coalesce_str(data.get("camera_user")) or _coalesce_str(data.get("camera_password")))
    uses_relay = data["source_type"] in {"rtsp", "http"} or (
        has_secret_source and data["source_type"] in {"hls", "mp4_url"}
    )
    if data["device_kind"] != "camera":
        playback_url = ""
        playback_kind = "status"
    elif uses_relay:
        playback_url = f"{settings.api_prefix}/cameras/stream/{data['id']}/index.m3u8"
        playback_kind = "hls"
    elif data["source_type"] == "hls":
        playback_url = data["source"]
        playback_kind = "hls"
    else:
        playback_url = data["source"]
        playback_kind = "video"

    data["source_type_label"] = _source_type_label(data["source_type"])
    data["relay_source"] = resolved_source
    data["resolved_source"] = masked_source
    data["playback_url"] = playback_url
    data["playback_kind"] = playback_kind
    data["uses_relay"] = uses_relay
    data["is_live"] = data["device_kind"] == "camera" and data["source_type"] in {"rtsp", "http", "hls"}
    data["notes"] = _coalesce_str(data.get("notes"))
    data["site"] = _coalesce_str(data.get("site"))
    data["nivel"] = _coalesce_str(data.get("nivel"))
    data["camera_ip"] = _coalesce_str(data.get("camera_ip"))
    data["camera_path"] = _coalesce_str(data.get("camera_path"))
    data["camera_user"] = _coalesce_str(data.get("camera_user"))
    data["camera_password"] = _coalesce_str(data.get("camera_password"))
    data["has_credentials"] = bool(data["camera_user"])
    data["camera_port"] = int(data["camera_port"]) if data.get("camera_port") is not None else None
    return data


async def _ensure_default_nok_support_devices(db: AsyncSession, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized_rows = [dict(row) for row in rows]
    if not normalized_rows:
        return normalized_rows

    maps_by_code: dict[str, list[dict[str, Any]]] = {}
    for row in normalized_rows:
        map_code = _normalize_map_code(row.get("map_code")) if row.get("map_code") else None
        if not map_code:
            continue
        maps_by_code.setdefault(map_code, []).append(row)

    if not maps_by_code:
        return normalized_rows

    existing_by_map_kind: set[tuple[str, str]] = set()
    for map_code, map_rows in maps_by_code.items():
        for row in map_rows:
            # Hidden/deactivated support devices must not be recreated on reads.
            kind = _normalize_device_kind(row.get("device_kind"))
            existing_by_map_kind.add((map_code, kind))

    next_id = max(int(row.get("id") or 0) for row in normalized_rows) + 1
    created_rows: list[dict[str, Any]] = []

    for map_code, map_rows in maps_by_code.items():
        seed_camera = next(
            (
                row
                for row in map_rows
                if _normalize_device_kind(row.get("device_kind")) == "camera"
            ),
            None,
        )
        base_host = _coalesce_str((seed_camera or {}).get("camera_ip"))
        base_port = (seed_camera or {}).get("camera_port")
        base_site = _coalesce_str((seed_camera or {}).get("site")) or _default_map_label(map_code)
        base_nivel = _coalesce_str((seed_camera or {}).get("nivel"))
        base_x = float((seed_camera or {}).get("x_pct") or 0.5)
        base_y = float((seed_camera or {}).get("y_pct") or 0.5)
        existing_nok_numbers = [
            int(row["nok_map_number"])
            for row in map_rows
            if row.get("nok_map_number") is not None
        ]
        next_nok_number = (max(existing_nok_numbers) + 1) if existing_nok_numbers else 1

        for offset, kind in enumerate(NOK_SUPPORT_DEVICE_KINDS):
            if (map_code, kind) in existing_by_map_kind:
                continue

            label = _device_kind_label(kind)
            name = f"{label} {_default_map_label(map_code)}"
            derived_source = None
            if base_host:
                port_fragment = f":{int(base_port)}" if base_port else ""
                derived_source = f"http://{base_host}{port_fragment}"

            x_offset = 0.035 if kind == "fan" else -0.035
            y_offset = 0.03 if kind == "fan" else -0.03
            x_pct = round(max(0.0, min(1.0, base_x + x_offset)), 4)
            y_pct = round(max(0.0, min(1.0, base_y + y_offset)), 4)

            row_payload = {
                "id": next_id,
                "name": name,
                "device_kind": kind,
                "source": derived_source or "",
                "source_type": "http",
                "camera_ip": base_host,
                "camera_port": int(base_port) if base_port not in (None, "") else None,
                "camera_path": None,
                "camera_user": None,
                "camera_password": None,
                "site": base_site,
                "nivel": base_nivel,
                "map_code": map_code,
                "x_pct": x_pct,
                "y_pct": y_pct,
                "nok_map_code": None,
                "nok_x_pct": None,
                "nok_y_pct": None,
                "nok_alt_map_number": None,
                "nok_alt_display_name": None,
                "notes": "Dispositivo NOC creado automaticamente para monitoreo de keep alive.",
                "nok_enabled": True,
                "nok_map_number": next_nok_number,
                "nok_display_name": name,
                "is_active": True,
            }

            await db.execute(
                text(
                    """
                    INSERT INTO camera_video (
                        id,
                        name,
                        device_kind,
                        source,
                        source_type,
                        camera_ip,
                        camera_port,
                        camera_path,
                        camera_user,
                        camera_password,
                        site,
                        nivel,
                        map_code,
                        x_pct,
                        y_pct,
                        nok_map_code,
                        nok_x_pct,
                        nok_y_pct,
                        nok_alt_map_number,
                        nok_alt_display_name,
                        notes,
                        nok_enabled,
                        nok_map_number,
                        nok_display_name,
                        is_seed_overridden,
                        is_active,
                        updated_at
                    ) VALUES (
                        :id,
                        :name,
                        :device_kind,
                        :source,
                        :source_type,
                        :camera_ip,
                        :camera_port,
                        :camera_path,
                        :camera_user,
                        :camera_password,
                        :site,
                        :nivel,
                        :map_code,
                        :x_pct,
                        :y_pct,
                        :nok_map_code,
                        :nok_x_pct,
                        :nok_y_pct,
                        :nok_alt_map_number,
                        :nok_alt_display_name,
                        :notes,
                        :nok_enabled,
                        :nok_map_number,
                        :nok_display_name,
                        TRUE,
                        :is_active,
                        NOW()
                    )
                    """
                ),
                row_payload,
            )

            created_rows.append(row_payload)
            map_rows.append(row_payload)
            existing_by_map_kind.add((map_code, kind))
            next_nok_number += 1
            next_id += 1

    if created_rows:
        await db.commit()
        normalized_rows.extend(created_rows)

    return normalized_rows


async def _fetch_camera_rows(db: AsyncSession, active_only: bool = False) -> list[dict[str, Any]]:
    await _ensure_camera_source_schema(db)

    sql = """
        SELECT
            id,
            name,
            device_kind,
            source,
            source_type,
            camera_ip,
            camera_port,
            camera_path,
            camera_user,
            camera_password,
            site,
            nivel,
            map_code,
            x_pct,
            y_pct,
            nok_map_code,
            nok_x_pct,
            nok_y_pct,
            nok_alt_map_number,
            nok_alt_display_name,
            notes,
            nok_enabled,
            nok_map_number,
            nok_display_name,
            is_active
        FROM camera_video
    """
    if active_only:
        sql += " WHERE is_active = TRUE"
    sql += " ORDER BY id"
    result = await db.execute(text(sql))
    rows = [dict(row) for row in result.mappings().all()]

    await _sync_camera_map_devices(db, rows)
    return [_camera_row_to_out(row) for row in rows]


async def _fetch_camera_row(db: AsyncSession, camera_id: int, active_only: bool = False) -> dict[str, Any] | None:
    rows = await _fetch_camera_rows(db, active_only=active_only)
    for row in rows:
        if int(row["id"]) == int(camera_id):
            return row
    return None


async def _resolve_camera_reference(
    db: AsyncSession,
    *,
    camera_id: int | None = None,
    camera_name: str | None = None,
    map_code: str | None = None,
) -> dict[str, Any]:
    normalized_map_code = _normalize_map_code(map_code) if map_code else None

    if camera_id is not None:
        camera_row = await _fetch_camera_row(db, int(camera_id), active_only=False)
        if not camera_row:
            raise HTTPException(status_code=404, detail="Camara no encontrada")
        if normalized_map_code and camera_row.get("map_code") != normalized_map_code:
            raise HTTPException(status_code=409, detail="La camara no pertenece al mapa indicado")
        return camera_row

    desired_name = _coalesce_str(camera_name)
    if not desired_name:
        raise HTTPException(status_code=422, detail="Debes indicar camera_id o camera_name")

    rows = await _fetch_camera_rows(db, active_only=False)
    if normalized_map_code:
        rows = [row for row in rows if row.get("map_code") == normalized_map_code]

    target = desired_name.casefold()
    exact_matches = [row for row in rows if str(row.get("name") or "").casefold() == target]
    if exact_matches:
        return exact_matches[0]

    partial_matches = [row for row in rows if target in str(row.get("name") or "").casefold()]
    if len(partial_matches) == 1:
        return partial_matches[0]
    if len(partial_matches) > 1:
        raise HTTPException(status_code=409, detail="Nombre de camara ambiguo; usa camera_id")
    raise HTTPException(status_code=404, detail="Camara no encontrada")


async def _fetch_camera_map_devices(db: AsyncSession, map_code: str) -> list[dict[str, Any]]:
    await _ensure_camera_source_schema(db)
    camera_rows = await db.execute(
        text(
            """
            SELECT
                id,
                name,
                device_kind,
                source,
                source_type,
                camera_ip,
                camera_port,
                camera_path,
                camera_user,
                camera_password,
                site,
                nivel,
                map_code,
                x_pct,
                y_pct,
                notes,
                nok_enabled,
                nok_map_number,
                nok_display_name,
                is_active
            FROM camera_video
            ORDER BY id
            """
        )
    )
    await _sync_camera_map_devices(db, [dict(row) for row in camera_rows.mappings().all()])
    result = await db.execute(
        text(
            """
            SELECT
                md.id AS map_device_id,
                md.map_code,
                md.kind,
                md.ref_id,
                md.label,
                md.x_pct,
                md.y_pct,
                cv.id AS id,
                cv.name,
                cv.device_kind,
                cv.source,
                cv.source_type,
                cv.camera_ip,
                cv.camera_port,
                cv.camera_path,
                cv.camera_user,
                cv.camera_password,
                cv.site,
                cv.nivel,
                cv.map_code AS camera_map_code,
                cv.notes,
                cv.is_active
            FROM map_device md
            JOIN camera_video cv
              ON cv.id = md.ref_id
            WHERE md.map_code = :map_code
            ORDER BY md.id
            """
        ),
        {"map_code": map_code},
    )
    rows = []
    for row in result.mappings().all():
        camera_meta = _camera_row_to_out(dict(row))
        is_online = bool(camera_meta["is_active"] and (camera_meta.get("playback_url") or camera_meta.get("camera_ip")))
        rows.append(
            {
                "id": row["map_device_id"],
                "map_code": row["map_code"],
                "kind": row.get("kind") or camera_meta["device_kind"],
                "ref_id": row["ref_id"],
                "label": row["label"] or camera_meta["name"],
                "x_pct": float(row["x_pct"]),
                "y_pct": float(row["y_pct"]),
                "status": "online" if is_online else "inactive",
                "is_active": bool(camera_meta["is_active"]),
                "is_online": is_online,
                "camera_id": camera_meta["id"],
                "camera_name": camera_meta["name"],
                "device_kind": camera_meta["device_kind"],
                "device_kind_label": camera_meta["device_kind_label"],
                "camera_source": camera_meta["resolved_source"],
                "camera_source_type": camera_meta["source_type"],
                "camera_source_type_label": camera_meta["source_type_label"],
                "camera_ip": camera_meta["camera_ip"],
                "camera_port": camera_meta["camera_port"],
                "camera_path": camera_meta["camera_path"],
                "camera_site": camera_meta["site"],
                "camera_nivel": camera_meta["nivel"],
                "camera_notes": camera_meta["notes"],
                "camera_playback_url": camera_meta["playback_url"],
                "camera_playback_kind": camera_meta["playback_kind"],
                "camera_uses_relay": camera_meta["uses_relay"],
            }
        )
    return rows


async def _ensure_camera_network_status_schema(db: AsyncSession) -> None:
    await db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS camera_network_status_log (
                id BIGSERIAL PRIMARY KEY,
                camera_id INTEGER NOT NULL,
                camera_name TEXT NOT NULL,
                camera_ip TEXT NULL,
                camera_port INTEGER NULL,
                status TEXT NOT NULL DEFAULT 'offline',
                is_online BOOLEAN NOT NULL DEFAULT FALSE,
                checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                response_ms INTEGER NULL,
                error_detail TEXT NULL,
                check_method TEXT NULL
            )
            """
        )
    )
    await db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS camera_network_status_current (
                camera_id INTEGER PRIMARY KEY,
                camera_name TEXT NOT NULL,
                camera_ip TEXT NULL,
                camera_port INTEGER NULL,
                status TEXT NOT NULL DEFAULT 'offline',
                is_online BOOLEAN NOT NULL DEFAULT FALSE,
                checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_online_at TIMESTAMPTZ NULL,
                last_offline_at TIMESTAMPTZ NULL,
                offline_since TIMESTAMPTZ NULL,
                response_ms INTEGER NULL,
                error_detail TEXT NULL,
                check_method TEXT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    await db.execute(
        text(
            f"""
            CREATE TABLE IF NOT EXISTS {CAMERA_NETWORK_STATUS_LOG_TABLE} (
                id BIGSERIAL PRIMARY KEY,
                backend_instance_id TEXT NOT NULL,
                backend_host TEXT NULL,
                camera_id INTEGER NOT NULL,
                camera_name TEXT NOT NULL,
                camera_ip TEXT NULL,
                camera_port INTEGER NULL,
                status TEXT NOT NULL DEFAULT 'offline',
                is_online BOOLEAN NOT NULL DEFAULT FALSE,
                checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                response_ms INTEGER NULL,
                error_detail TEXT NULL,
                check_method TEXT NULL
            )
            """
        )
    )
    await db.execute(
        text(
            f"""
            CREATE TABLE IF NOT EXISTS {CAMERA_NETWORK_STATUS_CURRENT_TABLE} (
                backend_instance_id TEXT NOT NULL,
                backend_host TEXT NULL,
                camera_id INTEGER NOT NULL,
                camera_name TEXT NOT NULL,
                camera_ip TEXT NULL,
                camera_port INTEGER NULL,
                status TEXT NOT NULL DEFAULT 'offline',
                is_online BOOLEAN NOT NULL DEFAULT FALSE,
                checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_online_at TIMESTAMPTZ NULL,
                last_offline_at TIMESTAMPTZ NULL,
                offline_since TIMESTAMPTZ NULL,
                response_ms INTEGER NULL,
                error_detail TEXT NULL,
                check_method TEXT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (backend_instance_id, camera_id)
            )
            """
        )
    )

    alter_statements = [
        "ALTER TABLE camera_network_status_log ADD COLUMN IF NOT EXISTS camera_ip TEXT NULL",
        "ALTER TABLE camera_network_status_log ADD COLUMN IF NOT EXISTS camera_port INTEGER NULL",
        "ALTER TABLE camera_network_status_log ADD COLUMN IF NOT EXISTS response_ms INTEGER NULL",
        "ALTER TABLE camera_network_status_log ADD COLUMN IF NOT EXISTS error_detail TEXT NULL",
        "ALTER TABLE camera_network_status_log ADD COLUMN IF NOT EXISTS check_method TEXT NULL",
        "ALTER TABLE camera_network_status_current ADD COLUMN IF NOT EXISTS camera_ip TEXT NULL",
        "ALTER TABLE camera_network_status_current ADD COLUMN IF NOT EXISTS camera_port INTEGER NULL",
        "ALTER TABLE camera_network_status_current ADD COLUMN IF NOT EXISTS checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
        "ALTER TABLE camera_network_status_current ADD COLUMN IF NOT EXISTS last_online_at TIMESTAMPTZ NULL",
        "ALTER TABLE camera_network_status_current ADD COLUMN IF NOT EXISTS last_offline_at TIMESTAMPTZ NULL",
        "ALTER TABLE camera_network_status_current ADD COLUMN IF NOT EXISTS offline_since TIMESTAMPTZ NULL",
        "ALTER TABLE camera_network_status_current ADD COLUMN IF NOT EXISTS response_ms INTEGER NULL",
        "ALTER TABLE camera_network_status_current ADD COLUMN IF NOT EXISTS error_detail TEXT NULL",
        "ALTER TABLE camera_network_status_current ADD COLUMN IF NOT EXISTS check_method TEXT NULL",
        "ALTER TABLE camera_network_status_current ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
        f"ALTER TABLE {CAMERA_NETWORK_STATUS_LOG_TABLE} ADD COLUMN IF NOT EXISTS backend_instance_id TEXT",
        f"ALTER TABLE {CAMERA_NETWORK_STATUS_LOG_TABLE} ADD COLUMN IF NOT EXISTS backend_host TEXT NULL",
        f"ALTER TABLE {CAMERA_NETWORK_STATUS_LOG_TABLE} ADD COLUMN IF NOT EXISTS camera_ip TEXT NULL",
        f"ALTER TABLE {CAMERA_NETWORK_STATUS_LOG_TABLE} ADD COLUMN IF NOT EXISTS camera_port INTEGER NULL",
        f"ALTER TABLE {CAMERA_NETWORK_STATUS_LOG_TABLE} ADD COLUMN IF NOT EXISTS response_ms INTEGER NULL",
        f"ALTER TABLE {CAMERA_NETWORK_STATUS_LOG_TABLE} ADD COLUMN IF NOT EXISTS error_detail TEXT NULL",
        f"ALTER TABLE {CAMERA_NETWORK_STATUS_LOG_TABLE} ADD COLUMN IF NOT EXISTS check_method TEXT NULL",
        f"ALTER TABLE {CAMERA_NETWORK_STATUS_CURRENT_TABLE} ADD COLUMN IF NOT EXISTS backend_instance_id TEXT",
        f"ALTER TABLE {CAMERA_NETWORK_STATUS_CURRENT_TABLE} ADD COLUMN IF NOT EXISTS backend_host TEXT NULL",
        f"ALTER TABLE {CAMERA_NETWORK_STATUS_CURRENT_TABLE} ADD COLUMN IF NOT EXISTS camera_ip TEXT NULL",
        f"ALTER TABLE {CAMERA_NETWORK_STATUS_CURRENT_TABLE} ADD COLUMN IF NOT EXISTS camera_port INTEGER NULL",
        f"ALTER TABLE {CAMERA_NETWORK_STATUS_CURRENT_TABLE} ADD COLUMN IF NOT EXISTS checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
        f"ALTER TABLE {CAMERA_NETWORK_STATUS_CURRENT_TABLE} ADD COLUMN IF NOT EXISTS last_online_at TIMESTAMPTZ NULL",
        f"ALTER TABLE {CAMERA_NETWORK_STATUS_CURRENT_TABLE} ADD COLUMN IF NOT EXISTS last_offline_at TIMESTAMPTZ NULL",
        f"ALTER TABLE {CAMERA_NETWORK_STATUS_CURRENT_TABLE} ADD COLUMN IF NOT EXISTS offline_since TIMESTAMPTZ NULL",
        f"ALTER TABLE {CAMERA_NETWORK_STATUS_CURRENT_TABLE} ADD COLUMN IF NOT EXISTS response_ms INTEGER NULL",
        f"ALTER TABLE {CAMERA_NETWORK_STATUS_CURRENT_TABLE} ADD COLUMN IF NOT EXISTS error_detail TEXT NULL",
        f"ALTER TABLE {CAMERA_NETWORK_STATUS_CURRENT_TABLE} ADD COLUMN IF NOT EXISTS check_method TEXT NULL",
        f"ALTER TABLE {CAMERA_NETWORK_STATUS_CURRENT_TABLE} ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
    ]
    for sql in alter_statements:
        await db.execute(text(sql))

    await db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_camera_network_status_log_camera_checked
            ON camera_network_status_log (camera_id, checked_at DESC)
            """
        )
    )
    await db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_camera_network_status_current_checked
            ON camera_network_status_current (checked_at DESC)
            """
        )
    )
    await db.execute(
        text(
            f"""
            CREATE INDEX IF NOT EXISTS idx_camera_network_status_log_instance_camera_checked
            ON {CAMERA_NETWORK_STATUS_LOG_TABLE} (backend_instance_id, camera_id, checked_at DESC)
            """
        )
    )
    await db.execute(
        text(
            f"""
            CREATE INDEX IF NOT EXISTS idx_camera_network_status_current_instance_checked
            ON {CAMERA_NETWORK_STATUS_CURRENT_TABLE} (backend_instance_id, checked_at DESC)
            """
        )
    )
    await db.commit()


def _as_utc_datetime(value: Any) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _extract_host_from_source(source: Any) -> str | None:
    raw_source = _coalesce_str(source)
    if not raw_source:
        return None

    candidate = raw_source if "://" in raw_source else f"rtsp://{raw_source}"
    parsed = urlparse(candidate)
    return _coalesce_str(parsed.hostname)


def _resolve_camera_probe_target(camera: dict[str, Any]) -> tuple[str | None, int | None]:
    source = camera.get("relay_source") or camera.get("source") or camera.get("resolved_source")
    host = _coalesce_str(camera.get("camera_ip")) or _extract_host_from_source(source)

    port = camera.get("camera_port")
    if port is not None:
        try:
            return host, int(port)
        except (TypeError, ValueError):
            return host, None

    raw_source = _coalesce_str(source)
    if raw_source and "://" in raw_source:
        parsed = urlparse(raw_source)
        if parsed.port:
            return host, int(parsed.port)
        if parsed.scheme == "https":
            return host, 443
        if parsed.scheme == "http":
            return host, 80

    default_ports = {
        "rtsp": 554,
        "http": 80,
        "hls": 80,
        "mp4_url": 80,
    }
    return host, default_ports.get(str(camera.get("source_type") or "").strip().lower())


def _compact_probe_error(raw_text: Any) -> str | None:
    if raw_text is None:
        return None
    text_value = str(raw_text).strip()
    if not text_value:
        return None

    normalized = " ".join(text_value.split())
    return normalized[:240]


async def _run_icmp_ping(host: str) -> tuple[bool, int | None, str | None, str]:
    if not PING_BIN:
        return False, None, "Binario ping no disponible en el backend", "icmp"

    if os.name == "nt":
        timeout_ms = max(250, int(CAMERA_NETWORK_PING_TIMEOUT_SECONDS * 1000))
        command = [PING_BIN, "-n", "1", "-w", str(timeout_ms), host]
    else:
        command = [
            PING_BIN,
            "-c",
            "1",
            "-W",
            str(max(1, int(round(CAMERA_NETWORK_PING_TIMEOUT_SECONDS)))),
            host,
        ]

    started = time.perf_counter()
    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except OSError as exc:
        return False, None, _compact_probe_error(str(exc)), "icmp"
    try:
        stdout, stderr = await asyncio.wait_for(
            process.communicate(),
            timeout=CAMERA_NETWORK_PING_TIMEOUT_SECONDS + 1.0,
        )
    except asyncio.TimeoutError:
        process.kill()
        await process.communicate()
        return False, None, "Timeout ejecutando ping", "icmp"

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    combined = "\n".join(
        part
        for part in (
            stdout.decode("utf-8", errors="ignore"),
            stderr.decode("utf-8", errors="ignore"),
        )
        if part
    )
    if process.returncode == 0:
        return True, elapsed_ms, None, "icmp"
    return False, elapsed_ms, _compact_probe_error(combined) or f"ping rc {process.returncode}", "icmp"


async def _run_tcp_probe(host: str, port: int | None) -> tuple[bool, int | None, str | None, str]:
    if not port:
        return False, None, "Puerto TCP no configurado para este dispositivo", "tcp"

    started = time.perf_counter()
    writer = None
    try:
        _reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, int(port)),
            timeout=CAMERA_NETWORK_PING_TIMEOUT_SECONDS,
        )
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return True, elapsed_ms, None, "tcp"
    except asyncio.TimeoutError:
        return False, None, f"Timeout TCP hacia {host}:{port}", "tcp"
    except Exception as exc:
        return False, None, _compact_probe_error(str(exc)) or f"Fallo TCP hacia {host}:{port}", "tcp"
    finally:
        if writer is not None:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass


async def _run_rtsp_probe(host: str, port: int) -> tuple[bool, int | None, str | None]:
    """Require an actual RTSP reply: TCP acceptance alone can come from a proxy."""
    writer = None
    started = time.perf_counter()
    async def exchange():
        nonlocal writer
        reader, writer = await asyncio.open_connection(host, port)
        authority = f"[{host}]" if ":" in host else host
        writer.write(f"OPTIONS rtsp://{authority}:{port}/ RTSP/1.0\r\nCSeq: 7183\r\n\r\n".encode("ascii"))
        await writer.drain()
        return await reader.readuntil(b"\r\n\r\n")
    try:
        data = await asyncio.wait_for(exchange(), timeout=CAMERA_NETWORK_PING_TIMEOUT_SECONDS + 2)
        lines = data.decode("ascii", errors="replace").split("\r\n")
        valid_status = re.fullmatch(r"RTSP/1\.0 [1-5][0-9]{2}(?: .*)?", lines[0])
        headers = dict(line.lower().split(":", 1) for line in lines[1:] if ":" in line)
        if not valid_status or headers.get("cseq", "").strip() != "7183":
            return False, None, "Sin respuesta RTSP válida de la cámara"
        return True, int((time.perf_counter() - started) * 1000), None
    except asyncio.TimeoutError:
        return False, None, "Sin respuesta RTSP: aceptar TCP no confirma conexión con la cámara"
    except (OSError, asyncio.IncompleteReadError, asyncio.LimitOverrunError, UnicodeError) as exc:
        return False, None, _compact_probe_error(str(exc)) or "Sin respuesta RTSP"
    finally:
        if writer is not None:
            writer.close()
            try:
                await asyncio.wait_for(writer.wait_closed(), timeout=1)
            except Exception:
                pass


async def _probe_camera_stream_available(camera: dict[str, Any]) -> tuple[bool, int | None, str | None]:
    """Validate a real video frame; host reachability is not enough for cameras."""
    source_type = str(camera.get("source_type") or "").strip().lower()
    if source_type == "video_file":
        return False, None, "Fuente local sin conexión real de cámara"
    if not _ffmpeg_exists():
        return False, None, "ffmpeg no está disponible para validar el stream real"

    source = str(camera.get("relay_source") or camera.get("resolved_source") or "").strip()
    if not source:
        return False, None, "Cámara sin URL de stream configurada"

    command = [FFMPEG_BIN, "-hide_banner", "-loglevel", "error", "-nostdin"]
    if source_type == "rtsp":
        command.extend(["-rtsp_transport", "tcp", "-fflags", "nobuffer", "-flags", "low_delay"])
    else:
        command.extend(["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "2"])
    command.extend(["-i", source, "-frames:v", "1", "-f", "null", "-"])
    started = time.perf_counter()
    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        _, stderr = await asyncio.wait_for(process.communicate(), timeout=STREAM_PROBE_TIMEOUT)
    except asyncio.TimeoutError:
        process.kill()
        await process.communicate()
        return False, int((time.perf_counter() - started) * 1000), "Timeout leyendo el stream real"

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    if process.returncode == 0:
        return True, elapsed_ms, None
    stderr_text = (stderr or b"").decode("utf-8", errors="ignore").strip()
    return False, elapsed_ms, stderr_text.splitlines()[-1][:240] if stderr_text else "El stream no entregó frames"


async def _probe_camera_network(camera: dict[str, Any]) -> CameraNetworkProbeResult:
    camera_id = int(camera["id"])
    camera_name = str(camera.get("name") or f"Camara {camera_id}")
    checked_at = datetime.now(timezone.utc)
    host, port = _resolve_camera_probe_target(camera)

    if not host:
        return CameraNetworkProbeResult(
            camera_id=camera_id,
            camera_name=camera_name,
            camera_ip=None,
            camera_port=port,
            checked_at=checked_at,
            is_online=False,
            status="offline",
            response_ms=None,
            error_detail="Dispositivo sin IP o host configurado",
            check_method="config",
        )

    icmp_ok, icmp_ms, icmp_error, icmp_method = await _run_icmp_ping(host)
    if icmp_ok:
        return CameraNetworkProbeResult(
            camera_id=camera_id,
            camera_name=camera_name,
            camera_ip=host,
            camera_port=port,
            checked_at=checked_at,
            is_online=True,
            status="online",
            response_ms=icmp_ms,
            error_detail=None,
            check_method=icmp_method,
        )

    if str(camera.get("device_kind") or "camera").lower() == "camera":
        source_type = str(camera.get("source_type") or "").lower()
        source = str(camera.get("relay_source") or camera.get("resolved_source") or camera.get("source") or "")
        if source_type == "rtsp" or source.lower().startswith("rtsp://") or port == 554:
            online, elapsed, error = await _run_rtsp_probe(host, port or 554)
            method = "rtsp"
        else:
            online, elapsed, error = await _probe_camera_stream_available(camera)
            method = "stream"
        return CameraNetworkProbeResult(
            camera_id=camera_id, camera_name=camera_name, camera_ip=host, camera_port=port,
            checked_at=checked_at, is_online=online, status="online" if online else "offline",
            response_ms=elapsed, error_detail=error, check_method=method,
        )

    tcp_ok, tcp_ms, tcp_error, tcp_method = await _run_tcp_probe(host, port)
    if tcp_ok:
        return CameraNetworkProbeResult(
            camera_id=camera_id,
            camera_name=camera_name,
            camera_ip=host,
            camera_port=port,
            checked_at=checked_at,
            is_online=True,
            status="online",
            response_ms=tcp_ms,
            error_detail=None,
            check_method=tcp_method,
        )

    error_detail = tcp_error or icmp_error or "Dispositivo fuera de linea"
    check_method = "icmp+tcp" if port else icmp_method
    return CameraNetworkProbeResult(
        camera_id=camera_id,
        camera_name=camera_name,
        camera_ip=host,
        camera_port=port,
        checked_at=checked_at,
        is_online=False,
        status="offline",
        response_ms=icmp_ms if icmp_ms is not None else tcp_ms,
        error_detail=error_detail,
        check_method=check_method,
    )


async def _ensure_camera_map_catalog_schema(db: AsyncSession) -> None:
    await db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS camera_map_catalog (
                code TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                image_path TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 100,
                show_in_nok BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    await db.commit()


def _build_nok_map_entries_from_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    catalog: dict[str, dict[str, Any]] = {}
    for row in rows:
        if not bool(row.get("nok_enabled")):
            continue
        map_code = _coalesce_str(row.get("map_code"))
        if not map_code:
            continue
        if map_code in catalog:
            continue
        catalog[map_code] = {
            "code": map_code,
            "label": _coalesce_str(row.get("site")) or _default_map_label(map_code),
            "image_url": f"/maps/{map_code}.jpeg",
            "sort_order": NOK_MAP_DISPLAY_ORDER.get(map_code, 1000),
        }

    return sorted(
        catalog.values(),
        key=lambda item: (int(item.get("sort_order") or 1000), str(item["code"])),
    )


async def _fetch_nok_map_entries(db: AsyncSession, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    await _ensure_camera_map_catalog_schema(db)
    result = await db.execute(
        text(
            """
            SELECT
                code,
                label,
                image_path,
                sort_order
            FROM camera_map_catalog
            WHERE show_in_nok = TRUE
            ORDER BY sort_order, code
            """
        )
    )

    catalog_entries = [
        {
            "code": str(row["code"]),
            "label": str(row["label"]),
            "image_url": _coalesce_str(row.get("image_path")) or f"/maps/{row['code']}.jpeg",
            "sort_order": int(row.get("sort_order") or 1000),
        }
        for row in result.mappings().all()
        if row.get("code") and row.get("label")
    ]

    if not catalog_entries:
        return _build_nok_map_entries_from_rows(rows)

    derived_by_code = {item["code"]: item for item in _build_nok_map_entries_from_rows(rows)}
    merged = list(catalog_entries)
    existing_codes = {item["code"] for item in merged}
    for map_code, derived in derived_by_code.items():
        if map_code not in existing_codes:
            merged.append(derived)

    return sorted(
        merged,
        key=lambda item: (int(item.get("sort_order") or 1000), str(item["code"])),
    )


def _select_nok_camera_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    for row in rows:
        if not bool(row.get("nok_enabled")):
            continue

        base_map_code = _coalesce_str(row.get("map_code"))
        alt_map_code = _coalesce_str(row.get("nok_map_code"))
        same_map_alt_override = bool(
            base_map_code
            and alt_map_code
            and alt_map_code == base_map_code
            and (
                row.get("nok_x_pct") is not None
                or row.get("nok_y_pct") is not None
                or row.get("nok_alt_map_number") is not None
                or _coalesce_str(row.get("nok_alt_display_name"))
            )
        )

        if base_map_code:
            selected.append(
                {
                    **dict(row),
                    "map_code": base_map_code,
                    "x_pct": row.get("nok_x_pct") if same_map_alt_override and row.get("nok_x_pct") is not None else row.get("x_pct"),
                    "y_pct": row.get("nok_y_pct") if same_map_alt_override and row.get("nok_y_pct") is not None else row.get("y_pct"),
                    "nok_map_number": (
                        int(row["nok_alt_map_number"])
                        if same_map_alt_override and row.get("nok_alt_map_number") is not None
                        else (int(row["nok_map_number"]) if row.get("nok_map_number") is not None else None)
                    ),
                    "nok_display_name": (
                        _coalesce_str(row.get("nok_alt_display_name"))
                        if same_map_alt_override and _coalesce_str(row.get("nok_alt_display_name"))
                        else (row.get("nok_display_name") or row.get("name"))
                    ),
                    "nok_virtual": False,
                }
            )

        if not alt_map_code:
            continue

        has_alt_overrides = (
            alt_map_code != base_map_code
            or row.get("nok_x_pct") is not None
            or row.get("nok_y_pct") is not None
            or row.get("nok_alt_map_number") is not None
            or _coalesce_str(row.get("nok_alt_display_name"))
        )
        if not has_alt_overrides:
            continue
        if same_map_alt_override:
            continue

        effective_x_pct = row.get("nok_x_pct")
        if effective_x_pct is None:
            effective_x_pct = row.get("x_pct")

        effective_y_pct = row.get("nok_y_pct")
        if effective_y_pct is None:
            effective_y_pct = row.get("y_pct")

        selected.append(
            {
                **dict(row),
                "map_code": alt_map_code,
                "x_pct": effective_x_pct,
                "y_pct": effective_y_pct,
                "nok_map_number": int(row["nok_alt_map_number"]) if row.get("nok_alt_map_number") is not None else (
                    int(row["nok_map_number"]) if row.get("nok_map_number") is not None else None
                ),
                "nok_display_name": _coalesce_str(row.get("nok_alt_display_name")) or row.get("nok_display_name") or row.get("name"),
                "nok_virtual": False,
            }
        )

    selected.sort(
        key=lambda item: (
            *_sort_nok_map_key(str(item.get("map_code") or "")),
            item.get("nok_map_number") is None,
            item.get("nok_map_number") or int(item["id"]),
            int(item["id"]),
        )
    )
    return selected


async def _fetch_camera_network_current_map(db: AsyncSession) -> dict[int, dict[str, Any]]:
    await _ensure_camera_network_status_schema(db)
    result = await db.execute(
        text(
            f"""
            SELECT
                backend_instance_id,
                backend_host,
                camera_id,
                camera_name,
                camera_ip,
                camera_port,
                status,
                is_online,
                checked_at,
                last_online_at,
                last_offline_at,
                offline_since,
                response_ms,
                error_detail,
                check_method,
                updated_at
            FROM {CAMERA_NETWORK_STATUS_CURRENT_TABLE}
            WHERE backend_instance_id = :backend_instance_id
            """
        ),
        {"backend_instance_id": CAMERA_NETWORK_MONITOR_INSTANCE_ID},
    )
    return {
        int(row["camera_id"]): dict(row)
        for row in result.mappings().all()
        if row.get("camera_id") is not None
    }

async def _get_camera_network_interval_seconds(db: AsyncSession) -> float:
    interval_seconds = await get_camera_monitoring_interval_seconds(
        db,
        fallback=int(CAMERA_NETWORK_MONITOR_INTERVAL_FALLBACK_SECONDS),
    )
    return float(max(30, interval_seconds))


def _is_camera_network_status_stale_for_interval(
    current_row: dict[str, Any] | None,
    reference: datetime,
    interval_seconds: float,
) -> bool:
    checked_at = _as_utc_datetime((current_row or {}).get("checked_at"))
    if checked_at is None:
        return True
    return (reference - checked_at).total_seconds() >= interval_seconds


async def _persist_camera_network_probe(
    db: AsyncSession,
    probe: CameraNetworkProbeResult,
    existing_row: dict[str, Any] | None,
) -> dict[str, Any]:
    previous = existing_row or {}
    previous_is_online = previous.get("is_online")
    previous_last_online = _as_utc_datetime(previous.get("last_online_at"))
    previous_last_offline = _as_utc_datetime(previous.get("last_offline_at"))
    previous_offline_since = _as_utc_datetime(previous.get("offline_since"))

    if probe.is_online:
        last_online_at = probe.checked_at
        last_offline_at = previous_last_offline
        offline_since = None
    else:
        last_online_at = previous_last_online
        last_offline_at = probe.checked_at
        offline_since = (
            previous_offline_since
            if previous_is_online is False and previous_offline_since is not None
            else probe.checked_at
        )

    payload = {
        "backend_instance_id": CAMERA_NETWORK_MONITOR_INSTANCE_ID,
        "backend_host": CAMERA_NETWORK_MONITOR_HOST,
        "camera_id": int(probe.camera_id),
        "camera_name": probe.camera_name,
        "camera_ip": probe.camera_ip,
        "camera_port": probe.camera_port,
        "status": probe.status,
        "is_online": bool(probe.is_online),
        "checked_at": probe.checked_at,
        "last_online_at": last_online_at,
        "last_offline_at": last_offline_at,
        "offline_since": offline_since,
        "response_ms": probe.response_ms,
        "error_detail": probe.error_detail,
        "check_method": probe.check_method,
    }

    await db.execute(
        text(
            f"""
            INSERT INTO {CAMERA_NETWORK_STATUS_LOG_TABLE} (
                backend_instance_id,
                backend_host,
                camera_id,
                camera_name,
                camera_ip,
                camera_port,
                status,
                is_online,
                checked_at,
                response_ms,
                error_detail,
                check_method
            ) VALUES (
                :backend_instance_id,
                :backend_host,
                :camera_id,
                :camera_name,
                :camera_ip,
                :camera_port,
                :status,
                :is_online,
                :checked_at,
                :response_ms,
                :error_detail,
                :check_method
            )
            """
        ),
        payload,
    )
    await db.execute(
        text(
            f"""
            INSERT INTO {CAMERA_NETWORK_STATUS_CURRENT_TABLE} (
                backend_instance_id,
                backend_host,
                camera_id,
                camera_name,
                camera_ip,
                camera_port,
                status,
                is_online,
                checked_at,
                last_online_at,
                last_offline_at,
                offline_since,
                response_ms,
                error_detail,
                check_method,
                updated_at
            ) VALUES (
                :backend_instance_id,
                :backend_host,
                :camera_id,
                :camera_name,
                :camera_ip,
                :camera_port,
                :status,
                :is_online,
                :checked_at,
                :last_online_at,
                :last_offline_at,
                :offline_since,
                :response_ms,
                :error_detail,
                :check_method,
                NOW()
            )
            ON CONFLICT (backend_instance_id, camera_id) DO UPDATE
            SET
                backend_host = EXCLUDED.backend_host,
                camera_name = EXCLUDED.camera_name,
                camera_ip = EXCLUDED.camera_ip,
                camera_port = EXCLUDED.camera_port,
                status = EXCLUDED.status,
                is_online = EXCLUDED.is_online,
                checked_at = EXCLUDED.checked_at,
                last_online_at = EXCLUDED.last_online_at,
                last_offline_at = EXCLUDED.last_offline_at,
                offline_since = EXCLUDED.offline_since,
                response_ms = EXCLUDED.response_ms,
                error_detail = EXCLUDED.error_detail,
                check_method = EXCLUDED.check_method,
                updated_at = NOW()
            """
        ),
        payload,
    )
    return payload


async def _refresh_camera_network_snapshot(
    db: AsyncSession,
    *,
    rows: list[dict[str, Any]] | None = None,
    force: bool = False,
) -> dict[int, dict[str, Any]]:
    async with _camera_network_refresh_lock:
        await _ensure_camera_network_status_schema(db)
        camera_rows = rows if rows is not None else await _fetch_camera_rows(db, active_only=False)
        candidates = _select_nok_camera_rows(camera_rows)
        current_map = await _fetch_camera_network_current_map(db)
        if not candidates:
            return current_map

        unique_candidates: list[dict[str, Any]] = []
        seen_camera_ids: set[int] = set()
        for camera in candidates:
            camera_id = int(camera["id"])
            if camera_id in seen_camera_ids:
                continue
            seen_camera_ids.add(camera_id)
            unique_candidates.append(camera)

        now_utc = datetime.now(timezone.utc)
        refresh_interval_seconds = await _get_camera_network_interval_seconds(db)
        to_probe = [
            camera
            for camera in unique_candidates
            if force
            or _is_camera_network_status_stale_for_interval(
                current_map.get(int(camera["id"])),
                now_utc,
                refresh_interval_seconds,
            )
        ]
        if not to_probe:
            return current_map

        semaphore = asyncio.Semaphore(CAMERA_NETWORK_PROBE_CONCURRENCY)

        async def run_probe(camera: dict[str, Any]) -> CameraNetworkProbeResult:
            async with semaphore:
                return await _probe_camera_network(camera)

        results = await asyncio.gather(*(run_probe(camera) for camera in to_probe), return_exceptions=True)

        for camera, result in zip(to_probe, results):
            camera_id = int(camera["id"])
            if isinstance(result, Exception):
                result = CameraNetworkProbeResult(
                    camera_id=camera_id,
                    camera_name=str(camera.get("name") or f"Camara {camera_id}"),
                    camera_ip=_coalesce_str(camera.get("camera_ip")),
                    camera_port=int(camera["camera_port"]) if camera.get("camera_port") is not None else None,
                    checked_at=datetime.now(timezone.utc),
                    is_online=False,
                    status="offline",
                    response_ms=None,
                    error_detail=_compact_probe_error(str(result)) or "Fallo inesperado al consultar la camara",
                    check_method="exception",
                )

            persisted = await _persist_camera_network_probe(db, result, current_map.get(camera_id))
            current_map[camera_id] = persisted

        await db.commit()
        return current_map


def _serialize_nok_camera(camera: dict[str, Any], status_row: dict[str, Any] | None, reference: datetime) -> dict[str, Any]:
    current = status_row or {}
    checked_at = _as_utc_datetime(current.get("checked_at"))
    last_online_at = _as_utc_datetime(current.get("last_online_at"))
    last_offline_at = _as_utc_datetime(current.get("last_offline_at"))
    offline_since = _as_utc_datetime(current.get("offline_since"))
    is_online = bool(current.get("is_online"))
    offline_duration_seconds = 0
    if offline_since is not None and not is_online:
        offline_duration_seconds = max(0, int((reference - offline_since).total_seconds()))

    return {
        "camera_id": int(camera["id"]),
        "device_kind": camera.get("device_kind") or "camera",
        "device_kind_label": _device_kind_label(str(camera.get("device_kind") or "camera")),
        "name": camera["name"],
        "display_name": camera.get("nok_display_name") or camera.get("name"),
        "map_number": camera.get("nok_map_number"),
        "is_virtual": bool(camera.get("nok_virtual")),
        "map_code": camera.get("map_code"),
        "site": camera.get("site"),
        "nivel": camera.get("nivel"),
        "ip": camera.get("camera_ip"),
        "port": camera.get("camera_port"),
        "x_pct": camera.get("x_pct"),
        "y_pct": camera.get("y_pct"),
        "source_type": camera.get("source_type"),
        "source_type_label": camera.get("source_type_label"),
        "playback_url": camera.get("playback_url"),
        "is_active": bool(camera.get("is_active")),
        "status": current.get("status") or ("online" if is_online else "offline"),
        "is_online": is_online,
        "checked_at": checked_at,
        "last_online_at": last_online_at,
        "last_offline_at": last_offline_at,
        "offline_since": offline_since,
        "offline_duration_seconds": offline_duration_seconds,
        "response_ms": current.get("response_ms"),
        "error_detail": current.get("error_detail"),
        "check_method": current.get("check_method"),
    }


async def _build_nok_camera_overview(
    db: AsyncSession,
    *,
    force_refresh: bool = False,
) -> dict[str, Any]:
    camera_rows = await _fetch_camera_rows(db, active_only=False)
    candidates = _select_nok_camera_rows(camera_rows)
    map_entries = await _fetch_nok_map_entries(db, candidates)
    current_map = await _refresh_camera_network_snapshot(db, rows=candidates, force=force_refresh)
    reference = datetime.now(timezone.utc)
    refresh_interval_seconds = await _get_camera_network_interval_seconds(db)

    overview_maps: list[dict[str, Any]] = []
    flattened: list[dict[str, Any]] = []

    for map_item in map_entries:
        map_code = map_item["code"]
        map_cameras = [
            _serialize_nok_camera(camera, current_map.get(int(camera["id"])), reference)
            for camera in candidates
            if camera.get("map_code") == map_code
        ]
        map_cameras.sort(key=lambda item: (item.get("map_number") is None, item.get("map_number") or item["camera_id"]))
        flattened.extend(map_cameras)

        online_count = sum(1 for item in map_cameras if item["is_online"])
        offline_count = sum(1 for item in map_cameras if not item["is_online"])
        inactive_count = sum(1 for item in map_cameras if not item["is_active"])

        overview_maps.append(
            {
                "code": map_code,
                "label": map_item["label"],
                "image_url": map_item["image_url"],
                "camera_count": len(map_cameras),
                "online_count": online_count,
                "offline_count": offline_count,
                "inactive_count": inactive_count,
                "has_offline_alerts": offline_count > 0,
                "cameras": map_cameras,
            }
        )

    last_checked_at = max(
        (item["checked_at"] for item in flattened if item.get("checked_at") is not None),
        default=None,
    )
    unique_flattened = {int(item["camera_id"]): item for item in flattened}
    unique_items = list(unique_flattened.values())

    return {
        "generated_at": reference,
        "refresh_ttl_seconds": refresh_interval_seconds,
        "monitor_instance": {
            "instance_id": CAMERA_NETWORK_MONITOR_INSTANCE_ID,
            "host": CAMERA_NETWORK_MONITOR_HOST,
            "isolated_by_instance": True,
        },
        "summary": {
            "maps": len(overview_maps),
            "total_cameras": len(unique_items),
            "online_cameras": sum(1 for item in unique_items if item["is_online"]),
            "offline_cameras": sum(1 for item in unique_items if not item["is_online"]),
            "inactive_cameras": sum(1 for item in unique_items if not item["is_active"]),
            "last_checked_at": last_checked_at,
        },
        "maps": overview_maps,
    }


async def _camera_network_monitor_loop() -> None:
    global _camera_network_monitor_stop

    if _camera_network_monitor_stop is None:
        return

    while not _camera_network_monitor_stop.is_set():
        next_interval_seconds = CAMERA_NETWORK_MONITOR_INTERVAL_FALLBACK_SECONDS
        try:
            async with async_session() as db:
                rows = await _fetch_camera_rows(db, active_only=False)
                await _refresh_camera_network_snapshot(db, rows=rows, force=True)
                next_interval_seconds = await _get_camera_network_interval_seconds(db)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print(f"[camera-network-monitor] {exc}")

        try:
            await asyncio.wait_for(
                _camera_network_monitor_stop.wait(),
                timeout=next_interval_seconds,
            )
        except asyncio.TimeoutError:
            continue


async def start_camera_network_monitor() -> None:
    global _camera_network_monitor_task, _camera_network_monitor_stop

    if not CAMERA_NETWORK_MONITOR_ENABLED:
        return
    if _camera_network_monitor_task is not None and not _camera_network_monitor_task.done():
        return

    _camera_network_monitor_stop = asyncio.Event()
    _camera_network_monitor_task = asyncio.create_task(_camera_network_monitor_loop())


async def stop_camera_network_monitor() -> None:
    global _camera_network_monitor_task, _camera_network_monitor_stop

    if _camera_network_monitor_stop is not None:
        _camera_network_monitor_stop.set()

    task = _camera_network_monitor_task
    _camera_network_monitor_task = None
    _camera_network_monitor_stop = None

    if task is None:
        return

    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


async def _next_camera_id(db: AsyncSession) -> int:
    await db.execute(text("CREATE SEQUENCE IF NOT EXISTS camera_video_id_seq"))
    await db.execute(text("LOCK TABLE camera_video IN SHARE ROW EXCLUSIVE MODE"))
    result = await db.execute(text("SELECT setval('camera_video_id_seq', GREATEST(nextval('camera_video_id_seq'), COALESCE(MAX(id), 0) + 1), TRUE) FROM camera_video"))
    return int(result.scalar() or 1)


def _sanitize_camera_payload(payload: CameraSourceIn) -> dict[str, Any]:
    source_type = _normalize_source_type(payload.source_type)
    device_kind = _normalize_device_kind(payload.device_kind)
    name = _coalesce_str(payload.name)
    if not name:
        raise HTTPException(status_code=422, detail="Nombre requerido")

    camera_ip = _coalesce_str(payload.camera_ip)
    camera_path = _coalesce_str(payload.camera_path)
    camera_user = _coalesce_str(payload.camera_user)
    camera_password = _coalesce_str(payload.camera_password)
    source = _coalesce_str(payload.source)
    map_code = _normalize_map_code(payload.map_code)
    x_pct = _validate_pct(payload.x_pct, "X")
    y_pct = _validate_pct(payload.y_pct, "Y")
    nok_map_code = _normalize_map_code(payload.nok_map_code)
    nok_x_pct = _validate_pct(payload.nok_x_pct, "X NOK")
    nok_y_pct = _validate_pct(payload.nok_y_pct, "Y NOK")
    nok_enabled = bool(payload.nok_enabled)

    nok_map_number = None
    if payload.nok_map_number not in (None, ""):
        try:
            nok_map_number = int(payload.nok_map_number)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=422, detail="Numero NOK invalido") from exc

    nok_display_name = _coalesce_str(payload.nok_display_name)
    if nok_enabled and not nok_display_name:
        nok_display_name = name

    nok_alt_map_number = None
    if payload.nok_alt_map_number not in (None, ""):
        try:
            nok_alt_map_number = int(payload.nok_alt_map_number)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=422, detail="Numero NOK alterno invalido") from exc

    nok_alt_display_name = _coalesce_str(payload.nok_alt_display_name)
    if nok_map_code and not nok_alt_display_name:
        nok_alt_display_name = nok_display_name or name

    camera_port = None
    if payload.camera_port not in (None, ""):
        try:
            camera_port = int(payload.camera_port)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=422, detail="Puerto invalido") from exc

    data: dict[str, Any] = {
        "name": name,
        "device_kind": device_kind,
        "source": source,
        "source_type": source_type,
        "camera_ip": camera_ip,
        "camera_port": camera_port,
        "camera_path": camera_path,
        "camera_user": camera_user,
        "camera_password": camera_password,
        "site": _coalesce_str(payload.site),
        "nivel": _coalesce_str(payload.nivel),
        "map_code": map_code,
        "x_pct": x_pct,
        "y_pct": y_pct,
        "nok_map_code": nok_map_code,
        "nok_x_pct": nok_x_pct,
        "nok_y_pct": nok_y_pct,
        "nok_alt_map_number": nok_alt_map_number,
        "nok_alt_display_name": nok_alt_display_name,
        "nok_enabled": nok_enabled,
        "nok_map_number": nok_map_number,
        "nok_display_name": nok_display_name,
        "notes": _coalesce_str(payload.notes),
        "is_seed_overridden": True,
        "is_active": bool(payload.is_active),
    }

    resolved_source = _build_source_from_parts(source_type, data)
    if not resolved_source and device_kind == "camera":
        raise HTTPException(status_code=422, detail="Debes ingresar una ruta o URL de origen valida")
    if not resolved_source and device_kind != "camera":
        if not camera_ip:
            raise HTTPException(status_code=422, detail="Debes ingresar IP/host para el dispositivo NOC")
        port_fragment = f":{camera_port}" if camera_port else ""
        resolved_source = f"http://{camera_ip}{port_fragment}"

    data["source"] = resolved_source
    return data


async def _ensure_default_camera_sources(db: AsyncSession) -> None:
    rows = await _fetch_camera_rows(db, active_only=False)
    await _ensure_camera_map_catalog_schema(db)
    await _sync_camera_map_devices(db, rows)


async def _ensure_camera_map_adjustments(db: AsyncSession) -> None:
    if not CAMERA_POSITION_OVERRIDES:
        return

    changed = False
    for camera_id, override in CAMERA_POSITION_OVERRIDES.items():
        sets: list[str] = []
        params: dict[str, Any] = {"camera_id": int(camera_id)}
        for key in ("x_pct", "y_pct"):
            if override.get(key) is None:
                continue
            sets.append(f"{key} = :{key}")
            params[key] = float(override[key])

        if not sets:
            continue

        await db.execute(
            text(
                f"""
                UPDATE camera_video
                SET {", ".join(sets)},
                    updated_at = NOW()
                WHERE id = :camera_id
                """
            ),
            params,
        )
        await db.execute(
            text(
                f"""
                UPDATE map_device
                SET {", ".join(sets)}
                WHERE kind = 'camera'
                  AND ref_id = :camera_id
                """
            ),
            params,
        )
        changed = True

    if changed:
        await db.commit()


async def _sync_camera_map_devices(db: AsyncSession, rows: list[dict[str, Any]]) -> None:
    changed = False
    for row in rows:
        camera_id = int(row["id"])
        device_kind = _normalize_device_kind(row.get("device_kind"))
        map_code = _normalize_map_code(row.get("map_code")) if row.get("map_code") else None
        x_pct = row.get("x_pct")
        y_pct = row.get("y_pct")
        if not row.get("is_active", True) or not map_code or x_pct is None or y_pct is None:
            await db.execute(
                text(
                    """
                    DELETE FROM map_device
                    WHERE kind = :kind
                      AND ref_id = :ref_id
                    """
                ),
                {"ref_id": camera_id, "kind": device_kind},
            )
            changed = True
            continue

        if map_code and x_pct is not None and y_pct is not None:
            await db.execute(
                text(
                    """
                    DELETE FROM map_device
                    WHERE kind = :kind
                      AND ref_id = :ref_id
                      AND map_code <> :map_code
                    """
                ),
                {"ref_id": camera_id, "map_code": map_code, "kind": device_kind},
            )
            exists = await db.execute(
                text(
                    """
                    SELECT id
                    FROM map_device
                    WHERE kind = :kind
                      AND ref_id = :ref_id
                      AND map_code = :map_code
                    ORDER BY id DESC
                    LIMIT 1
                    """
                ),
                {"ref_id": camera_id, "map_code": map_code, "kind": device_kind},
            )
            existing_row = exists.first()
            params = {
                "ref_id": camera_id,
                "kind": device_kind,
                "map_code": map_code,
                "label": row.get("name") or f"Dispositivo {camera_id}",
                "x_pct": float(x_pct),
                "y_pct": float(y_pct),
            }
            if existing_row:
                params["id"] = existing_row[0]
                await db.execute(
                    text(
                        """
                        UPDATE map_device
                        SET label = :label,
                            x_pct = :x_pct,
                            y_pct = :y_pct
                        WHERE id = :id
                        """
                    ),
                    params,
                )
            else:
                await db.execute(
                    text(
                        """
                        INSERT INTO map_device (map_code, kind, ref_id, label, x_pct, y_pct)
                        VALUES (:map_code, :kind, :ref_id, :label, :x_pct, :y_pct)
                        """
                    ),
                    params,
                )
            changed = True
    if changed:
        await db.commit()


async def _ensure_camera_finding_schema(db: AsyncSession) -> None:
    await db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS camera_finding_event (
                id BIGSERIAL PRIMARY KEY,
                detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                video_id INTEGER NULL,
                panel_key TEXT NOT NULL,
                model_code TEXT NOT NULL,
                finding_code TEXT NOT NULL,
                finding_label TEXT NOT NULL,
                severity TEXT NOT NULL,
                coverage TEXT NOT NULL,
                zone TEXT NOT NULL,
                confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
                evidence TEXT NOT NULL DEFAULT '',
                payload JSONB NOT NULL DEFAULT '{}'::jsonb
            )
            """
        )
    )
    alter_statements = [
        "ALTER TABLE camera_finding_event ADD COLUMN IF NOT EXISTS finding_group TEXT NULL",
        "ALTER TABLE camera_finding_event ADD COLUMN IF NOT EXISTS external_event_id TEXT NULL",
        "ALTER TABLE camera_finding_event ADD COLUMN IF NOT EXISTS event_source TEXT NOT NULL DEFAULT 'backend'",
        "ALTER TABLE camera_finding_event ADD COLUMN IF NOT EXISTS evidence_video_path TEXT NULL",
        "ALTER TABLE camera_finding_event ADD COLUMN IF NOT EXISTS evidence_video_name TEXT NULL",
        "ALTER TABLE camera_finding_event ADD COLUMN IF NOT EXISTS evidence_video_mime TEXT NULL",
        "ALTER TABLE camera_finding_event ADD COLUMN IF NOT EXISTS evidence_video_size BIGINT NULL",
        "ALTER TABLE camera_finding_event ADD COLUMN IF NOT EXISTS evidence_video_uploaded_at TIMESTAMPTZ NULL",
    ]
    for sql in alter_statements:
        await db.execute(text(sql))

    await db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_camera_finding_event_detected_at
            ON camera_finding_event(detected_at DESC)
            """
        )
    )
    await db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_camera_finding_event_code
            ON camera_finding_event(finding_code)
            """
        )
    )
    await db.execute(
        text(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_camera_finding_event_external_event_id
            ON camera_finding_event(external_event_id)
            """
        )
    )
    await db.commit()


async def _ensure_camera_analytics_snapshot_schema(db: AsyncSession) -> None:
    await _ensure_camera_finding_schema(db)
    await db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS camera_finding_snapshot (
                id BIGSERIAL PRIMARY KEY,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                video_id INTEGER NOT NULL,
                panel_key TEXT NOT NULL,
                model_code TEXT NOT NULL,
                finding_code TEXT NOT NULL,
                finding_group TEXT NOT NULL DEFAULT '',
                finding_label TEXT NOT NULL,
                severity TEXT NOT NULL DEFAULT '',
                coverage TEXT NOT NULL DEFAULT '',
                coverage_mode TEXT NULL,
                active_count INTEGER NOT NULL DEFAULT 0,
                total_count INTEGER NOT NULL DEFAULT 0,
                last_seen_at TIMESTAMPTZ NULL,
                last_evidence TEXT NOT NULL DEFAULT '',
                payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                UNIQUE (video_id, panel_key, model_code, finding_code)
            )
            """
        )
    )
    await db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_camera_finding_snapshot_updated_at
            ON camera_finding_snapshot(updated_at DESC)
            """
        )
    )
    await db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_camera_finding_snapshot_group
            ON camera_finding_snapshot(finding_group)
            """
        )
    )
    await db.commit()


async def _ensure_camera_live_snapshot_schema(db: AsyncSession) -> None:
    await db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS camera_live_snapshot (
                id BIGSERIAL PRIMARY KEY,
                video_id INTEGER NOT NULL,
                panel_key TEXT NOT NULL,
                model_code TEXT NOT NULL,
                active_persons INTEGER NOT NULL DEFAULT 0,
                active_vehicles INTEGER NOT NULL DEFAULT 0,
                active_findings INTEGER NOT NULL DEFAULT 0,
                cumulative_findings INTEGER NOT NULL DEFAULT 0,
                payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (video_id, panel_key, model_code)
            )
            """
        )
    )
    await db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_camera_live_snapshot_updated_at
            ON camera_live_snapshot(updated_at DESC)
            """
        )
    )
    await db.commit()


def _download_model_file_if_needed(
    *,
    model_url: str,
    model_file: Path,
    min_size_bytes: int,
    allow_insecure_ssl: bool,
) -> Path:
    if model_file.exists() and model_file.stat().st_size > min_size_bytes:
        return model_file

    model_file.parent.mkdir(parents=True, exist_ok=True)
    temp_path = model_file.with_suffix(".tmp")

    def _download(verify: bool) -> None:
        with requests.get(model_url, stream=True, timeout=180, verify=verify) as response:
            response.raise_for_status()
            with open(temp_path, "wb") as handle:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        handle.write(chunk)

    try:
        _download(True)
    except requests.exceptions.SSLError:
        if not allow_insecure_ssl:
            raise
        _download(False)

    temp_path.replace(model_file)
    return model_file


def _download_model_if_needed() -> Path:
    return _download_model_file_if_needed(
        model_url=PPE_MODEL_URL,
        model_file=PPE_MODEL_FILE,
        min_size_bytes=5_000_000,
        allow_insecure_ssl=PPE_FALLBACK_SSL,
    )


def _download_operational_model_if_needed() -> Path:
    return _download_model_file_if_needed(
        model_url=OPERATIONAL_MODEL_URL,
        model_file=OPERATIONAL_MODEL_FILE,
        min_size_bytes=OPERATIONAL_MODEL_MIN_BYTES,
        allow_insecure_ssl=False,
    )


def _get_ppe_session() -> ort.InferenceSession:
    global _ppe_session
    if _ppe_session is not None:
        return _ppe_session

    model_path = _download_model_if_needed()
    _ppe_session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    return _ppe_session


def _get_operational_session() -> ort.InferenceSession:
    global _operational_session
    if _operational_session is not None:
        return _operational_session

    model_path = _download_operational_model_if_needed()
    _operational_session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    return _operational_session


def _decode_image(image_base64: str) -> Image.Image:
    raw = image_base64.strip()
    if "," in raw:
        raw = raw.split(",", 1)[1]

    try:
        data = base64.b64decode(raw)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Imagen base64 invalida: {exc}") from exc

    try:
        return Image.open(io.BytesIO(data)).convert("RGB")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"No se pudo abrir la imagen: {exc}") from exc


def _preprocess_for_ppe(image: Image.Image) -> tuple[np.ndarray, int, int]:
    original_w, original_h = image.size
    resized = image.resize((PPE_INPUT, PPE_INPUT), Image.BILINEAR)
    array = np.asarray(resized, dtype=np.float32) / 255.0
    array = np.transpose(array, (2, 0, 1))[None, ...]
    return array, original_w, original_h


def _threshold_for_operational_class(class_id: int) -> float:
    if class_id in OPERATIONAL_PERSON_IDS:
        return 0.38
    if class_id in OPERATIONAL_VEHICLE_IDS:
        return 0.33
    if class_id in OPERATIONAL_PHONE_IDS:
        return 0.28
    return 0.45


def _parse_operational_output(output: np.ndarray, original_w: int, original_h: int) -> list[dict[str, Any]]:
    rows = output
    if rows.ndim == 3:
        rows = rows[0]
    if rows.ndim != 2:
        return []
    if rows.shape[-1] != 6 and rows.shape[0] == 6:
        rows = rows.T
    if rows.shape[-1] != 6:
        return []

    scale_x = original_w / PPE_INPUT
    scale_y = original_h / PPE_INPUT
    detections: list[dict[str, Any]] = []

    for row in rows.tolist():
        x1, y1, x2, y2, score, raw_class_id = [float(value) for value in row[:6]]
        class_id = int(round(raw_class_id))
        if score < _threshold_for_operational_class(class_id):
            continue
        if x2 <= x1 or y2 <= y1:
            continue

        detections.append(
            {
                "class_id": class_id,
                "class_name": OPERATIONAL_CLASS_NAMES.get(class_id, f"Clase {class_id}"),
                "score": round(score, 4),
                "x1": round(max(0.0, x1 * scale_x), 2),
                "y1": round(max(0.0, y1 * scale_y), 2),
                "x2": round(min(float(original_w), x2 * scale_x), 2),
                "y2": round(min(float(original_h), y2 * scale_y), 2),
            }
        )

    return detections


def _threshold_for_ppe_class(class_name: str) -> float:
    if class_name == "Person":
        return 0.34
    if class_name.startswith("NO-"):
        return 0.26
    if class_name in {"Hardhat", "Goggles", "Gloves", "Mask", "Safety Vest"}:
        return 0.22
    return 0.4


def _compute_iou(left: dict[str, Any], right: dict[str, Any]) -> float:
    x1 = max(left["x1"], right["x1"])
    y1 = max(left["y1"], right["y1"])
    x2 = min(left["x2"], right["x2"])
    y2 = min(left["y2"], right["y2"])

    inter_w = max(0.0, x2 - x1)
    inter_h = max(0.0, y2 - y1)
    inter_area = inter_w * inter_h
    if inter_area <= 0:
        return 0.0

    left_area = max(0.0, left["x2"] - left["x1"]) * max(0.0, left["y2"] - left["y1"])
    right_area = max(0.0, right["x2"] - right["x1"]) * max(0.0, right["y2"] - right["y1"])
    union = left_area + right_area - inter_area
    if union <= 0:
        return 0.0
    return inter_area / union


def _nms_per_class(detections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    kept: list[dict[str, Any]] = []
    by_class: dict[str, list[dict[str, Any]]] = {}
    for detection in detections:
        by_class.setdefault(detection["class_name"], []).append(detection)

    for items in by_class.values():
        remaining = sorted(items, key=lambda item: item["score"], reverse=True)
        while remaining:
            current = remaining.pop(0)
            kept.append(current)
            remaining = [item for item in remaining if _compute_iou(current, item) < PPE_IOU_THRESHOLD]

    return kept


def _zone_from_bbox(x1: float, y1: float, x2: float, y2: float, width: int, height: int) -> str:
    cx = (x1 + x2) / 2
    cy = (y1 + y2) / 2
    horizontal = "Izquierda" if cx < width / 3 else "Derecha" if cx > (width * 2) / 3 else "Centro"
    vertical = "Superior" if cy < height / 3 else "Inferior" if cy > (height * 2) / 3 else "Media"
    return f"{horizontal} / {vertical}"


def _parse_ppe_output(output: np.ndarray, original_w: int, original_h: int) -> list[dict[str, Any]]:
    if output.ndim != 2 or output.shape[0] < 18:
        return []

    boxes = output[:4, :]
    scores = output[4:, :]
    class_ids = np.argmax(scores, axis=0)
    confidences = scores[class_ids, np.arange(scores.shape[1])]

    detections: list[dict[str, Any]] = []
    scale_x = original_w / PPE_INPUT
    scale_y = original_h / PPE_INPUT

    for index, class_id in enumerate(class_ids.tolist()):
        class_name = PPE_CLASS_NAMES.get(class_id, f"class_{class_id}")
        score = float(confidences[index])
        if score < _threshold_for_ppe_class(class_name):
            continue

        cx, cy, width, height = [float(value) for value in boxes[:, index]]
        x1 = max(0.0, (cx - width / 2) * scale_x)
        y1 = max(0.0, (cy - height / 2) * scale_y)
        x2 = min(float(original_w), (cx + width / 2) * scale_x)
        y2 = min(float(original_h), (cy + height / 2) * scale_y)
        if x2 <= x1 or y2 <= y1:
            continue

        detections.append(
            {
                "class_id": class_id,
                "class_name": class_name,
                "score": round(score, 4),
                "x1": round(x1, 2),
                "y1": round(y1, 2),
                "x2": round(x2, 2),
                "y2": round(y2, 2),
            }
        )

    return _nms_per_class(detections)


def _contains_center(outer: dict[str, Any], inner: dict[str, Any], padding: float = 0.15) -> bool:
    width = outer["x2"] - outer["x1"]
    height = outer["y2"] - outer["y1"]
    cx = (inner["x1"] + inner["x2"]) / 2
    cy = (inner["y1"] + inner["y2"]) / 2
    return (
        cx >= outer["x1"] - width * padding
        and cx <= outer["x2"] + width * padding
        and cy >= outer["y1"] - height * padding
        and cy <= outer["y2"] + height * padding
    )


def _build_ppe_uid(code: str, bbox: dict[str, Any]) -> str:
    return (
        f"{code}:"
        f"{int(round(bbox['x1'] / 12))}:"
        f"{int(round(bbox['y1'] / 12))}:"
        f"{int(round(bbox['x2'] / 12))}:"
        f"{int(round(bbox['y2'] / 12))}"
    )


def _build_finding(
    code: str,
    bbox: dict[str, Any],
    width: int,
    height: int,
    confidence: float,
    evidence: str,
) -> dict[str, Any]:
    meta = PPE_SUPPORTED_FINDINGS[code]
    return {
        "code": code,
        "label": meta["label"],
        "severity": meta["severity"],
        "coverage": "ppe_live",
        "zone": _zone_from_bbox(bbox["x1"], bbox["y1"], bbox["x2"], bbox["y2"], width, height),
        "confidence": round(confidence * 100, 1),
        "evidence": evidence,
        "uid": _build_ppe_uid(code, bbox),
    }


def _derive_ppe_findings(
    detections: list[dict[str, Any]],
    original_w: int,
    original_h: int,
) -> list[dict[str, Any]]:
    persons = [item for item in detections if item["class_name"] == "Person"]
    no_hardhat = [item for item in detections if item["class_name"] == "NO-Hardhat"]
    no_goggles = [item for item in detections if item["class_name"] == "NO-Goggles"]
    no_gloves = [item for item in detections if item["class_name"] == "NO-Gloves"]
    no_vest = [item for item in detections if item["class_name"] == "NO-Safety Vest"]

    findings: list[dict[str, Any]] = []
    seen_keys: set[str] = set()

    def related(person: dict[str, Any], items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [item for item in items if _contains_center(person, item)]

    for person in persons:
        missing_parts: list[str] = []

        related_no_hardhat = related(person, no_hardhat)
        if related_no_hardhat:
            score = max(item["score"] for item in related_no_hardhat)
            finding = _build_finding("1", person, original_w, original_h, score, "NO-Hardhat asociado a persona")
            key = f"{finding['code']}:{finding['uid']}"
            if key not in seen_keys:
                seen_keys.add(key)
                findings.append(finding)
            missing_parts.append("casco")

        related_no_goggles = related(person, no_goggles)
        if related_no_goggles:
            score = max(item["score"] for item in related_no_goggles)
            finding = _build_finding("3", person, original_w, original_h, score, "NO-Goggles asociado a persona")
            key = f"{finding['code']}:{finding['uid']}"
            if key not in seen_keys:
                seen_keys.add(key)
                findings.append(finding)
            missing_parts.append("lentes")

        related_no_gloves = related(person, no_gloves)
        if related_no_gloves:
            score = max(item["score"] for item in related_no_gloves)
            finding = _build_finding("5", person, original_w, original_h, score, "NO-Gloves asociado a persona")
            key = f"{finding['code']}:{finding['uid']}"
            if key not in seen_keys:
                seen_keys.add(key)
                findings.append(finding)
            missing_parts.append("guantes")

        if related(person, no_vest):
            missing_parts.append("chaleco")

        if missing_parts:
            evidence = f"EPP incompleto: {', '.join(sorted(set(missing_parts)))}"
            confidence = max(
                [item["score"] for item in related_no_hardhat + related_no_goggles + related_no_gloves + related(person, no_vest)]
                or [0.3]
            )
            finding = _build_finding("15", person, original_w, original_h, confidence, evidence)
            key = f"{finding['code']}:{finding['uid']}"
            if key not in seen_keys:
                seen_keys.add(key)
                findings.append(finding)

    return findings


def _run_ppe_analysis(image: Image.Image) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    tensor, original_w, original_h = _preprocess_for_ppe(image)
    session = _get_ppe_session()
    output = session.run(None, {session.get_inputs()[0].name: tensor})[0][0]
    detections = _parse_ppe_output(output, original_w, original_h)
    findings = _derive_ppe_findings(detections, original_w, original_h)
    return detections, findings


def _run_operational_analysis(image: Image.Image) -> list[dict[str, Any]]:
    tensor, original_w, original_h = _preprocess_for_ppe(image)
    session = _get_operational_session()
    output = session.run(None, {session.get_inputs()[0].name: tensor})[0]
    return _parse_operational_output(output, original_w, original_h)


async def _persist_camera_findings(
    db: AsyncSession,
    payload: CameraAnalyzeFrameIn,
    findings: list[dict[str, Any]],
) -> int:
    if not findings:
        return 0

    await _ensure_camera_finding_schema(db)
    rows = [
        {
            "video_id": payload.video_id,
            "panel_key": payload.panel_key,
            "model_code": payload.model_code,
            "finding_code": finding["code"],
            "finding_label": finding["label"],
            "severity": finding["severity"],
            "coverage": finding["coverage"],
            "zone": finding["zone"],
            "confidence": finding["confidence"],
            "evidence": finding["evidence"],
            "payload": json.dumps(finding, ensure_ascii=True),
        }
        for finding in findings
    ]

    await db.execute(
        text(
            """
            INSERT INTO camera_finding_event (
                video_id,
                panel_key,
                model_code,
                finding_code,
                finding_label,
                severity,
                coverage,
                zone,
                confidence,
                evidence,
                payload
            ) VALUES (
                :video_id,
                :panel_key,
                :model_code,
                :finding_code,
                :finding_label,
                :severity,
                :coverage,
                :zone,
                :confidence,
                :evidence,
                CAST(:payload AS JSONB)
            )
            """
        ),
        rows,
    )
    await db.commit()
    return len(rows)


async def _replace_camera_finding_snapshot_rows(
    db: AsyncSession,
    *,
    video_id: int,
    panel_key: str,
    model_code: str,
    summary_rows: list[CameraFindingSnapshotRowIn],
) -> int:
    await _ensure_camera_analytics_snapshot_schema(db)
    await db.execute(
        text(
            """
            DELETE FROM camera_finding_snapshot
            WHERE video_id = :video_id
              AND panel_key = :panel_key
              AND model_code = :model_code
            """
        ),
        {
            "video_id": video_id,
            "panel_key": panel_key,
            "model_code": model_code,
        },
    )

    rows = [
        {
            "video_id": video_id,
            "panel_key": panel_key,
            "model_code": model_code,
            "finding_code": row.code,
            "finding_group": row.group,
            "finding_label": row.label,
            "severity": row.severity,
            "coverage": row.coverage,
            "coverage_mode": row.coverage_mode,
            "active_count": max(0, int(row.active_count or 0)),
            "total_count": max(0, int(row.total_count or 0)),
            "last_seen_at": row.last_seen_at,
            "last_evidence": row.last_evidence or "",
            "payload": json.dumps(row.model_dump(mode="json"), ensure_ascii=True),
        }
        for row in summary_rows
    ]

    if not rows:
        return 0

    await db.execute(
        text(
            """
            INSERT INTO camera_finding_snapshot (
                video_id,
                panel_key,
                model_code,
                finding_code,
                finding_group,
                finding_label,
                severity,
                coverage,
                coverage_mode,
                active_count,
                total_count,
                last_seen_at,
                last_evidence,
                payload
            ) VALUES (
                :video_id,
                :panel_key,
                :model_code,
                :finding_code,
                :finding_group,
                :finding_label,
                :severity,
                :coverage,
                :coverage_mode,
                :active_count,
                :total_count,
                :last_seen_at,
                :last_evidence,
                CAST(:payload AS JSONB)
            )
            """
        ),
        rows,
    )
    return len(rows)


async def _upsert_camera_live_snapshot_partial(
    db: AsyncSession,
    *,
    video_id: int,
    panel_key: str,
    model_code: str,
    active_persons: int | None = None,
    active_vehicles: int | None = None,
    active_findings: int | None = None,
    cumulative_findings: int | None = None,
    summary_rows: list[CameraFindingSnapshotRowIn] | None = None,
    source_tag: str = "external_ai",
) -> dict[str, int]:
    await _ensure_camera_live_snapshot_schema(db)
    summary_rows = summary_rows or []

    existing_result = await db.execute(
        text(
            """
            SELECT
                active_persons,
                active_vehicles,
                active_findings,
                cumulative_findings
            FROM camera_live_snapshot
            WHERE video_id = :video_id
              AND panel_key = :panel_key
              AND model_code = :model_code
            LIMIT 1
            """
        ),
        {
            "video_id": video_id,
            "panel_key": panel_key,
            "model_code": model_code,
        },
    )
    existing_row = existing_result.mappings().first() or {}

    summary_active = sum(max(0, int(item.active_count or 0)) for item in summary_rows) if summary_rows else None
    summary_total = sum(max(0, int(item.total_count or 0)) for item in summary_rows) if summary_rows else None

    payload_data = {
        "source": source_tag,
        "summary_rows": len(summary_rows),
    }
    final_payload = {
        "active_persons": max(0, int(active_persons if active_persons is not None else existing_row.get("active_persons") or 0)),
        "active_vehicles": max(0, int(active_vehicles if active_vehicles is not None else existing_row.get("active_vehicles") or 0)),
        "active_findings": max(
            0,
            int(
                active_findings
                if active_findings is not None
                else summary_active if summary_active is not None
                else existing_row.get("active_findings") or 0
            ),
        ),
        "cumulative_findings": max(
            0,
            int(
                cumulative_findings
                if cumulative_findings is not None
                else summary_total if summary_total is not None
                else existing_row.get("cumulative_findings") or 0
            ),
        ),
        "payload": json.dumps(payload_data, ensure_ascii=True),
    }

    await db.execute(
        text(
            """
            INSERT INTO camera_live_snapshot (
                video_id,
                panel_key,
                model_code,
                active_persons,
                active_vehicles,
                active_findings,
                cumulative_findings,
                payload,
                updated_at
            ) VALUES (
                :video_id,
                :panel_key,
                :model_code,
                :active_persons,
                :active_vehicles,
                :active_findings,
                :cumulative_findings,
                CAST(:payload AS JSONB),
                NOW()
            )
            ON CONFLICT (video_id, panel_key, model_code) DO UPDATE
            SET active_persons = EXCLUDED.active_persons,
                active_vehicles = EXCLUDED.active_vehicles,
                active_findings = EXCLUDED.active_findings,
                cumulative_findings = EXCLUDED.cumulative_findings,
                payload = EXCLUDED.payload,
                updated_at = NOW()
            """
        ),
        {
            "video_id": video_id,
            "panel_key": panel_key,
            "model_code": model_code,
            **final_payload,
        },
    )
    return {
        "active_persons": final_payload["active_persons"],
        "active_vehicles": final_payload["active_vehicles"],
        "active_findings": final_payload["active_findings"],
        "cumulative_findings": final_payload["cumulative_findings"],
    }


async def _persist_camera_analytics_snapshot(
    db: AsyncSession,
    payload: CameraAnalyticsSnapshotIn,
) -> dict[str, int]:
    await _ensure_camera_analytics_snapshot_schema(db)
    await _ensure_camera_live_snapshot_schema(db)

    await db.execute(
        text(
            """
            DELETE FROM camera_finding_snapshot
            WHERE video_id = :video_id
              AND panel_key = :panel_key
              AND model_code = :model_code
            """
        ),
        {
            "video_id": payload.video_id,
            "panel_key": payload.panel_key,
            "model_code": payload.model_code,
        },
    )

    snapshot_rows = [
        {
            "video_id": payload.video_id,
            "panel_key": payload.panel_key,
            "model_code": payload.model_code,
            "finding_code": row.code,
            "finding_group": row.group,
            "finding_label": row.label,
            "severity": row.severity,
            "coverage": row.coverage,
            "coverage_mode": row.coverage_mode,
            "active_count": max(0, int(row.active_count or 0)),
            "total_count": max(0, int(row.total_count or 0)),
            "last_seen_at": row.last_seen_at,
            "last_evidence": row.last_evidence or "",
            "payload": json.dumps(row.model_dump(mode="json"), ensure_ascii=True),
        }
        for row in payload.summary_rows
    ]

    if snapshot_rows:
        await db.execute(
            text(
                """
                INSERT INTO camera_finding_snapshot (
                    video_id,
                    panel_key,
                    model_code,
                    finding_code,
                    finding_group,
                    finding_label,
                    severity,
                    coverage,
                    coverage_mode,
                    active_count,
                    total_count,
                    last_seen_at,
                    last_evidence,
                    payload
                ) VALUES (
                    :video_id,
                    :panel_key,
                    :model_code,
                    :finding_code,
                    :finding_group,
                    :finding_label,
                    :severity,
                    :coverage,
                    :coverage_mode,
                    :active_count,
                    :total_count,
                    :last_seen_at,
                    :last_evidence,
                    CAST(:payload AS JSONB)
                )
                """
            ),
            snapshot_rows,
        )

    finding_rows = [
        {
            "detected_at": item.detected_at,
            "video_id": payload.video_id,
            "panel_key": payload.panel_key,
            "model_code": payload.model_code,
            "finding_code": item.code,
            "finding_group": item.group,
            "finding_label": item.label,
            "severity": item.severity,
            "coverage": item.coverage,
            "zone": item.zone,
            "confidence": item.confidence,
            "evidence": item.evidence or "",
            "external_event_id": item.event_id,
            "payload": json.dumps(item.model_dump(mode="json"), ensure_ascii=True),
        }
        for item in payload.recent_findings
    ]

    if finding_rows:
        await db.execute(
            text(
                """
                INSERT INTO camera_finding_event (
                    detected_at,
                    video_id,
                    panel_key,
                    model_code,
                    finding_code,
                    finding_group,
                    finding_label,
                    severity,
                    coverage,
                    zone,
                    confidence,
                    evidence,
                    external_event_id,
                    event_source,
                    payload
                ) VALUES (
                    :detected_at,
                    :video_id,
                    :panel_key,
                    :model_code,
                    :finding_code,
                    :finding_group,
                    :finding_label,
                    :severity,
                    :coverage,
                    :zone,
                    :confidence,
                    :evidence,
                    :external_event_id,
                    'frontend_snapshot',
                    CAST(:payload AS JSONB)
                )
                ON CONFLICT (external_event_id) DO NOTHING
                """
            ),
            finding_rows,
        )

    live_snapshot_payload = {
        "active_persons": max(0, int(payload.active_persons or 0)),
        "active_vehicles": max(0, int(payload.active_vehicles or 0)),
        "active_findings": max(0, int(payload.active_findings or 0)),
        "cumulative_findings": max(0, int(payload.cumulative_findings or 0)),
        "summary_rows": len(snapshot_rows),
        "recent_findings": len(finding_rows),
    }
    await db.execute(
        text(
            """
            INSERT INTO camera_live_snapshot (
                video_id,
                panel_key,
                model_code,
                active_persons,
                active_vehicles,
                active_findings,
                cumulative_findings,
                payload,
                updated_at
            ) VALUES (
                :video_id,
                :panel_key,
                :model_code,
                :active_persons,
                :active_vehicles,
                :active_findings,
                :cumulative_findings,
                CAST(:payload AS JSONB),
                NOW()
            )
            ON CONFLICT (video_id, panel_key, model_code) DO UPDATE
            SET active_persons = EXCLUDED.active_persons,
                active_vehicles = EXCLUDED.active_vehicles,
                active_findings = EXCLUDED.active_findings,
                cumulative_findings = EXCLUDED.cumulative_findings,
                payload = EXCLUDED.payload,
                updated_at = NOW()
            """
        ),
        {
            "video_id": payload.video_id,
            "panel_key": payload.panel_key,
            "model_code": payload.model_code,
            "active_persons": live_snapshot_payload["active_persons"],
            "active_vehicles": live_snapshot_payload["active_vehicles"],
            "active_findings": live_snapshot_payload["active_findings"],
            "cumulative_findings": live_snapshot_payload["cumulative_findings"],
            "payload": json.dumps(live_snapshot_payload, ensure_ascii=True),
        },
    )

    await db.commit()
    return {
        "snapshot_rows": len(snapshot_rows),
        "recent_rows": len(finding_rows),
    }


async def _ensure_camera_dashboard_demo_seed(db: AsyncSession, map_code: str) -> None:
    await _ensure_camera_analytics_snapshot_schema(db)
    await _ensure_camera_live_snapshot_schema(db)

    staleness = await db.execute(
        text(
            """
            SELECT
                MAX(cfe.detected_at) AS last_event_at,
                MAX(cls.updated_at) AS last_live_at
            FROM camera_video cv
            LEFT JOIN camera_finding_event cfe
              ON cfe.video_id = cv.id
            LEFT JOIN camera_live_snapshot cls
              ON cls.video_id = cv.id
            WHERE cv.map_code = :map_code
            """
        ),
        {"map_code": map_code},
    )
    stale_row = staleness.mappings().first() or {}
    fresh_after = datetime.now(timezone.utc) - timedelta(minutes=CAMERA_DASHBOARD_STALE_MINUTES)
    last_event_at = stale_row.get("last_event_at")
    last_live_at = stale_row.get("last_live_at")
    if (
        isinstance(last_event_at, datetime)
        and isinstance(last_live_at, datetime)
        and last_event_at >= fresh_after
        and last_live_at >= fresh_after
    ):
        return

    camera_result = await db.execute(
        text(
            """
            SELECT id, name
            FROM camera_video
            WHERE map_code = :map_code
                            AND COALESCE(device_kind, 'camera') = 'camera'
              AND is_active = TRUE
            ORDER BY CASE
                WHEN id = 2 THEN 0
                WHEN id = 1004 THEN 1
                WHEN id = 1006 THEN 2
                ELSE 10
            END,
            id
            """
        ),
        {"map_code": map_code},
    )
    cameras = camera_result.mappings().all()
    if not cameras:
        return

    def pick_camera(preferred_ids: list[int], used_ids: set[int]) -> dict[str, Any]:
        for preferred_id in preferred_ids:
            for camera in cameras:
                if int(camera["id"]) == preferred_id and preferred_id not in used_ids:
                    used_ids.add(preferred_id)
                    return {"id": int(camera["id"]), "name": str(camera["name"])}
        for camera in cameras:
            camera_id = int(camera["id"])
            if camera_id not in used_ids:
                used_ids.add(camera_id)
                return {"id": camera_id, "name": str(camera["name"])}
        fallback = cameras[0]
        return {"id": int(fallback["id"]), "name": str(fallback["name"])}

    used_ids: set[int] = set()
    cam_a = pick_camera([2], used_ids)
    cam_b = pick_camera([1004], used_ids)
    cam_c = pick_camera([1006, 1003], used_ids)

    now = datetime.now(timezone.utc)
    demo_events = [
        {
            "detected_at": now - timedelta(seconds=18),
            "video_id": cam_a["id"],
            "panel_key": CAMERA_DASHBOARD_DEMO_PANEL,
            "model_code": CAMERA_DASHBOARD_DEMO_MODEL,
            "finding_code": "21",
            "finding_group": "Peatonal",
            "finding_label": "Personal transitando por areas de maniobra de equipos pesados",
            "severity": "high",
            "coverage": "Tiempo real",
            "zone": "Derecha / Inferior",
            "confidence": 92.4,
            "evidence": f"Evento live asociado a {cam_a['name']}",
            "external_event_id": f"dashboard-demo-{map_code}-{cam_a['id']}-21",
        },
        {
            "detected_at": now - timedelta(seconds=34),
            "video_id": cam_a["id"],
            "panel_key": CAMERA_DASHBOARD_DEMO_PANEL,
            "model_code": CAMERA_DASHBOARD_DEMO_MODEL,
            "finding_code": "20",
            "finding_group": "Peatonal",
            "finding_label": "Personal permaneciendo en puntos ciegos de camiones, camionetas o maquinaria",
            "severity": "high",
            "coverage": "Tiempo real",
            "zone": "Centro / Inferior",
            "confidence": 88.1,
            "evidence": f"Evento live asociado a {cam_a['name']}",
            "external_event_id": f"dashboard-demo-{map_code}-{cam_a['id']}-20",
        },
        {
            "detected_at": now - timedelta(seconds=46),
            "video_id": cam_a["id"],
            "panel_key": CAMERA_DASHBOARD_DEMO_PANEL,
            "model_code": CAMERA_DASHBOARD_DEMO_MODEL,
            "finding_code": "17",
            "finding_group": "Peatonal",
            "finding_label": "Personal transitando demasiado cerca de equipos o vehiculos en movimiento",
            "severity": "medium",
            "coverage": "Tiempo real",
            "zone": "Centro / Inferior",
            "confidence": 86.5,
            "evidence": f"Evento live asociado a {cam_a['name']}",
            "external_event_id": f"dashboard-demo-{map_code}-{cam_a['id']}-17",
        },
        {
            "detected_at": now - timedelta(seconds=58),
            "video_id": cam_b["id"],
            "panel_key": CAMERA_DASHBOARD_DEMO_PANEL,
            "model_code": CAMERA_DASHBOARD_DEMO_MODEL,
            "finding_code": "1",
            "finding_group": "EPP",
            "finding_label": "Personal sin casco de seguridad",
            "severity": "high",
            "coverage": "Modelo PPE activo",
            "zone": "Centro / Superior",
            "confidence": 83.7,
            "evidence": f"Incumplimiento EPP detectado en {cam_b['name']}",
            "external_event_id": f"dashboard-demo-{map_code}-{cam_b['id']}-1",
        },
        {
            "detected_at": now - timedelta(seconds=74),
            "video_id": cam_b["id"],
            "panel_key": CAMERA_DASHBOARD_DEMO_PANEL,
            "model_code": CAMERA_DASHBOARD_DEMO_MODEL,
            "finding_code": "15",
            "finding_group": "EPP",
            "finding_label": "Personal ejecutando labores con EPP incompleto",
            "severity": "high",
            "coverage": "Modelo PPE activo",
            "zone": "Centro / Superior",
            "confidence": 81.9,
            "evidence": f"Incumplimiento EPP detectado en {cam_b['name']}",
            "external_event_id": f"dashboard-demo-{map_code}-{cam_b['id']}-15",
        },
        {
            "detected_at": now - timedelta(seconds=88),
            "video_id": cam_c["id"],
            "panel_key": CAMERA_DASHBOARD_DEMO_PANEL,
            "model_code": CAMERA_DASHBOARD_DEMO_MODEL,
            "finding_code": "29",
            "finding_group": "Interaccion",
            "finding_label": "Operacion simultanea de vehiculos y personas sin separacion segura",
            "severity": "high",
            "coverage": "Tiempo real",
            "zone": "Izquierda / Superior",
            "confidence": 84.2,
            "evidence": f"Interaccion peaton-vehiculo registrada en {cam_c['name']}",
            "external_event_id": f"dashboard-demo-{map_code}-{cam_c['id']}-29",
        },
        {
            "detected_at": now - timedelta(seconds=104),
            "video_id": cam_c["id"],
            "panel_key": CAMERA_DASHBOARD_DEMO_PANEL,
            "model_code": CAMERA_DASHBOARD_DEMO_MODEL,
            "finding_code": "3",
            "finding_group": "EPP",
            "finding_label": "Personal sin lentes de seguridad",
            "severity": "medium",
            "coverage": "Modelo PPE activo",
            "zone": "Izquierda / Superior",
            "confidence": 78.4,
            "evidence": f"Incumplimiento EPP detectado en {cam_c['name']}",
            "external_event_id": f"dashboard-demo-{map_code}-{cam_c['id']}-3",
        },
    ]

    summary_rows = [
        {
            "video_id": cam_a["id"],
            "panel_key": CAMERA_DASHBOARD_DEMO_PANEL,
            "model_code": CAMERA_DASHBOARD_DEMO_MODEL,
            "finding_code": "17",
            "finding_group": "Peatonal",
            "finding_label": "Personal transitando demasiado cerca de equipos o vehiculos en movimiento",
            "severity": "medium",
            "coverage": "Tiempo real",
            "coverage_mode": "heuristic",
            "active_count": 1,
            "total_count": 4,
            "last_seen_at": now - timedelta(seconds=46),
            "last_evidence": f"Evento live asociado a {cam_a['name']}",
        },
        {
            "video_id": cam_a["id"],
            "panel_key": CAMERA_DASHBOARD_DEMO_PANEL,
            "model_code": CAMERA_DASHBOARD_DEMO_MODEL,
            "finding_code": "20",
            "finding_group": "Peatonal",
            "finding_label": "Personal permaneciendo en puntos ciegos de camiones, camionetas o maquinaria",
            "severity": "high",
            "coverage": "Tiempo real",
            "coverage_mode": "heuristic",
            "active_count": 1,
            "total_count": 3,
            "last_seen_at": now - timedelta(seconds=34),
            "last_evidence": f"Evento live asociado a {cam_a['name']}",
        },
        {
            "video_id": cam_a["id"],
            "panel_key": CAMERA_DASHBOARD_DEMO_PANEL,
            "model_code": CAMERA_DASHBOARD_DEMO_MODEL,
            "finding_code": "21",
            "finding_group": "Peatonal",
            "finding_label": "Personal transitando por areas de maniobra de equipos pesados",
            "severity": "high",
            "coverage": "Tiempo real",
            "coverage_mode": "heuristic",
            "active_count": 1,
            "total_count": 5,
            "last_seen_at": now - timedelta(seconds=18),
            "last_evidence": f"Evento live asociado a {cam_a['name']}",
        },
        {
            "video_id": cam_b["id"],
            "panel_key": CAMERA_DASHBOARD_DEMO_PANEL,
            "model_code": CAMERA_DASHBOARD_DEMO_MODEL,
            "finding_code": "1",
            "finding_group": "EPP",
            "finding_label": "Personal sin casco de seguridad",
            "severity": "high",
            "coverage": "Modelo PPE activo",
            "coverage_mode": "ppe_live",
            "active_count": 1,
            "total_count": 4,
            "last_seen_at": now - timedelta(seconds=58),
            "last_evidence": f"Incumplimiento EPP detectado en {cam_b['name']}",
        },
        {
            "video_id": cam_b["id"],
            "panel_key": CAMERA_DASHBOARD_DEMO_PANEL,
            "model_code": CAMERA_DASHBOARD_DEMO_MODEL,
            "finding_code": "15",
            "finding_group": "EPP",
            "finding_label": "Personal ejecutando labores con EPP incompleto",
            "severity": "high",
            "coverage": "Modelo PPE activo",
            "coverage_mode": "ppe_live",
            "active_count": 1,
            "total_count": 2,
            "last_seen_at": now - timedelta(seconds=74),
            "last_evidence": f"Incumplimiento EPP detectado en {cam_b['name']}",
        },
        {
            "video_id": cam_c["id"],
            "panel_key": CAMERA_DASHBOARD_DEMO_PANEL,
            "model_code": CAMERA_DASHBOARD_DEMO_MODEL,
            "finding_code": "3",
            "finding_group": "EPP",
            "finding_label": "Personal sin lentes de seguridad",
            "severity": "medium",
            "coverage": "Modelo PPE activo",
            "coverage_mode": "ppe_live",
            "active_count": 1,
            "total_count": 3,
            "last_seen_at": now - timedelta(seconds=104),
            "last_evidence": f"Incumplimiento EPP detectado en {cam_c['name']}",
        },
        {
            "video_id": cam_c["id"],
            "panel_key": CAMERA_DASHBOARD_DEMO_PANEL,
            "model_code": CAMERA_DASHBOARD_DEMO_MODEL,
            "finding_code": "29",
            "finding_group": "Interaccion",
            "finding_label": "Operacion simultanea de vehiculos y personas sin separacion segura",
            "severity": "high",
            "coverage": "Tiempo real",
            "coverage_mode": "heuristic",
            "active_count": 1,
            "total_count": 4,
            "last_seen_at": now - timedelta(seconds=88),
            "last_evidence": f"Interaccion peaton-vehiculo registrada en {cam_c['name']}",
        },
    ]

    live_rows = [
        {
            "video_id": cam_a["id"],
            "panel_key": CAMERA_DASHBOARD_DEMO_PANEL,
            "model_code": CAMERA_DASHBOARD_DEMO_MODEL,
            "active_persons": 4,
            "active_vehicles": 2,
            "active_findings": 3,
            "cumulative_findings": 12,
        },
        {
            "video_id": cam_b["id"],
            "panel_key": CAMERA_DASHBOARD_DEMO_PANEL,
            "model_code": CAMERA_DASHBOARD_DEMO_MODEL,
            "active_persons": 2,
            "active_vehicles": 1,
            "active_findings": 2,
            "cumulative_findings": 6,
        },
        {
            "video_id": cam_c["id"],
            "panel_key": CAMERA_DASHBOARD_DEMO_PANEL,
            "model_code": CAMERA_DASHBOARD_DEMO_MODEL,
            "active_persons": 1,
            "active_vehicles": 1,
            "active_findings": 2,
            "cumulative_findings": 4,
        },
    ]

    await db.execute(
        text(
            """
            DELETE FROM camera_finding_event
            WHERE panel_key = :panel_key
              AND model_code = :model_code
            """
        ),
        {"panel_key": CAMERA_DASHBOARD_DEMO_PANEL, "model_code": CAMERA_DASHBOARD_DEMO_MODEL},
    )
    await db.execute(
        text(
            """
            DELETE FROM camera_finding_snapshot
            WHERE panel_key = :panel_key
              AND model_code = :model_code
            """
        ),
        {"panel_key": CAMERA_DASHBOARD_DEMO_PANEL, "model_code": CAMERA_DASHBOARD_DEMO_MODEL},
    )
    await db.execute(
        text(
            """
            DELETE FROM camera_live_snapshot
            WHERE panel_key = :panel_key
              AND model_code = :model_code
            """
        ),
        {"panel_key": CAMERA_DASHBOARD_DEMO_PANEL, "model_code": CAMERA_DASHBOARD_DEMO_MODEL},
    )

    await db.execute(
        text(
            """
            INSERT INTO camera_finding_event (
                detected_at,
                video_id,
                panel_key,
                model_code,
                finding_code,
                finding_group,
                finding_label,
                severity,
                coverage,
                zone,
                confidence,
                evidence,
                external_event_id,
                event_source,
                payload
            ) VALUES (
                :detected_at,
                :video_id,
                :panel_key,
                :model_code,
                :finding_code,
                :finding_group,
                :finding_label,
                :severity,
                :coverage,
                :zone,
                :confidence,
                :evidence,
                :external_event_id,
                'dashboard_demo',
                CAST(:payload AS JSONB)
            )
            """
        ),
        [
            {
                **row,
                "payload": json.dumps(row, default=str, ensure_ascii=True),
            }
            for row in demo_events
        ],
    )
    await db.execute(
        text(
            """
            INSERT INTO camera_finding_snapshot (
                video_id,
                panel_key,
                model_code,
                finding_code,
                finding_group,
                finding_label,
                severity,
                coverage,
                coverage_mode,
                active_count,
                total_count,
                last_seen_at,
                last_evidence,
                payload
            ) VALUES (
                :video_id,
                :panel_key,
                :model_code,
                :finding_code,
                :finding_group,
                :finding_label,
                :severity,
                :coverage,
                :coverage_mode,
                :active_count,
                :total_count,
                :last_seen_at,
                :last_evidence,
                CAST(:payload AS JSONB)
            )
            """
        ),
        [
            {
                **row,
                "payload": json.dumps(row, default=str, ensure_ascii=True),
            }
            for row in summary_rows
        ],
    )
    await db.execute(
        text(
            """
            INSERT INTO camera_live_snapshot (
                video_id,
                panel_key,
                model_code,
                active_persons,
                active_vehicles,
                active_findings,
                cumulative_findings,
                payload,
                updated_at
            ) VALUES (
                :video_id,
                :panel_key,
                :model_code,
                :active_persons,
                :active_vehicles,
                :active_findings,
                :cumulative_findings,
                CAST(:payload AS JSONB),
                NOW()
            )
            """
        ),
        [
            {
                **row,
                "payload": json.dumps(row, ensure_ascii=True),
            }
            for row in live_rows
        ],
    )
    await db.commit()


@router.get("/dashboard/{map_code}")
async def get_camera_dashboard(map_code: str, db: AsyncSession = Depends(get_db)):
    normalized_map_code = _normalize_map_code(map_code)
    if not normalized_map_code:
        raise HTTPException(status_code=404, detail="Mapa invalido")

    await _ensure_camera_source_schema(db)
    await _ensure_camera_dashboard_demo_seed(db, normalized_map_code)

    summary_result = await db.execute(
        text(
            """
            WITH ranked_live AS (
                SELECT
                    cls.video_id,
                    cls.active_persons,
                    cls.active_vehicles,
                    cls.active_findings,
                    cls.cumulative_findings,
                    cls.updated_at,
                    ROW_NUMBER() OVER (
                        PARTITION BY cls.video_id
                        ORDER BY cls.updated_at DESC, cls.id DESC
                    ) AS rn
                FROM camera_live_snapshot cls
                JOIN camera_video cv
                  ON cv.id = cls.video_id
                WHERE cv.map_code = :map_code
            )
            SELECT
                COALESCE(SUM(active_persons), 0)::int AS active_persons,
                COALESCE(SUM(active_vehicles), 0)::int AS active_vehicles,
                COALESCE(SUM(active_findings), 0)::int AS active_findings,
                COALESCE(SUM(cumulative_findings), 0)::int AS cumulative_findings,
                MAX(updated_at) AS updated_at
            FROM ranked_live
            WHERE rn = 1
            """
        ),
        {"map_code": normalized_map_code},
    )
    summary_row = summary_result.mappings().first() or {}

    findings_result = await db.execute(
        text(
            """
            SELECT
                cfe.id,
                cfe.detected_at,
                cfe.video_id,
                COALESCE(cv.name, CONCAT('Camara ', cfe.video_id::text)) AS camera_name,
                cfe.finding_code,
                COALESCE(NULLIF(cfe.finding_group, ''), 'General') AS finding_group,
                COALESCE(NULLIF(cfe.finding_label, ''), cfe.finding_code) AS finding_label,
                cfe.severity,
                COALESCE(NULLIF(cfe.coverage, ''), 'Tiempo real') AS coverage,
                COALESCE(NULLIF(cfe.zone, ''), '-') AS zone,
                COALESCE(NULLIF(cfe.evidence, ''), '-') AS evidence,
                cfe.evidence_video_name,
                COALESCE(cfe.confidence, 0)::float AS confidence
            FROM camera_finding_event cfe
            JOIN camera_video cv
              ON cv.id = cfe.video_id
            WHERE cv.map_code = :map_code
            ORDER BY cfe.detected_at DESC, cfe.id DESC
            LIMIT 32
            """
        ),
        {"map_code": normalized_map_code},
    )
    finding_rows = []
    for row in findings_result.mappings().all():
        row_data = dict(row)
        row_data["evidence_video_url"] = _build_finding_evidence_video_url(
            int(row_data["id"]),
            row_data.get("evidence_video_name"),
        )
        row_data.pop("evidence_video_name", None)
        finding_rows.append(row_data)

    return {
        "map_code": normalized_map_code,
        "summary": {
            "active_persons": int(summary_row.get("active_persons") or 0),
            "active_vehicles": int(summary_row.get("active_vehicles") or 0),
            "active_findings": int(summary_row.get("active_findings") or 0),
            "cumulative_findings": int(summary_row.get("cumulative_findings") or 0),
            "updated_at": summary_row.get("updated_at"),
        },
        "findings_grid": finding_rows,
        "latest_findings": finding_rows[:10],
    }


@router.post("/sources/bootstrap-defaults")
async def bootstrap_default_camera_sources(db: AsyncSession = Depends(get_db)):
    await _ensure_camera_source_schema(db)
    await _ensure_default_camera_sources(db)
    await _ensure_camera_map_adjustments(db)
    rows = await _fetch_camera_rows(db, active_only=False)
    return {
        "ok": True,
        "detail": "Sincronizacion manual de camaras y puntos aplicada desde la base de datos.",
        "total_cameras": len(rows),
    }


@router.post("/external/findings", response_model=CameraExternalFindingOut)
async def inject_external_camera_finding(
    payload: CameraExternalFindingIn,
    db: AsyncSession = Depends(get_db),
):
    camera_row = await _resolve_camera_reference(
        db,
        camera_id=payload.camera_id,
        camera_name=payload.camera_name,
        map_code=payload.map_code,
    )
    await _ensure_camera_analytics_snapshot_schema(db)

    detected_at = payload.detected_at or datetime.now(timezone.utc)
    event_source = _coalesce_str(payload.event_source) or "external_ai"
    panel_key = _coalesce_str(payload.panel_key) or "external_panel"
    model_code = _coalesce_str(payload.model_code) or "external_ai"

    finding_payload = {
        "camera_id": camera_row["id"],
        "camera_name": camera_row["name"],
        "camera_site": camera_row.get("site"),
        "camera_nivel": camera_row.get("nivel"),
        "camera_map_code": camera_row.get("map_code"),
        "external_payload": payload.payload,
    }
    insert_result = await db.execute(
        text(
            """
            INSERT INTO camera_finding_event (
                detected_at,
                video_id,
                panel_key,
                model_code,
                finding_code,
                finding_group,
                finding_label,
                severity,
                coverage,
                zone,
                confidence,
                evidence,
                external_event_id,
                event_source,
                payload
            ) VALUES (
                :detected_at,
                :video_id,
                :panel_key,
                :model_code,
                :finding_code,
                :finding_group,
                :finding_label,
                :severity,
                :coverage,
                :zone,
                :confidence,
                :evidence,
                :external_event_id,
                :event_source,
                CAST(:payload AS JSONB)
            )
            ON CONFLICT (external_event_id) DO UPDATE
            SET detected_at = EXCLUDED.detected_at,
                video_id = EXCLUDED.video_id,
                panel_key = EXCLUDED.panel_key,
                model_code = EXCLUDED.model_code,
                finding_code = EXCLUDED.finding_code,
                finding_group = EXCLUDED.finding_group,
                finding_label = EXCLUDED.finding_label,
                severity = EXCLUDED.severity,
                coverage = EXCLUDED.coverage,
                zone = EXCLUDED.zone,
                confidence = EXCLUDED.confidence,
                evidence = EXCLUDED.evidence,
                event_source = EXCLUDED.event_source,
                payload = EXCLUDED.payload
            RETURNING id, evidence_video_name
            """
        ),
        {
            "detected_at": detected_at,
            "video_id": camera_row["id"],
            "panel_key": panel_key,
            "model_code": model_code,
            "finding_code": str(payload.finding_code).strip().lstrip("#"),
            "finding_group": _coalesce_str(payload.finding_group) or "General",
            "finding_label": _coalesce_str(payload.finding_label) or str(payload.finding_code).strip().lstrip("#"),
            "severity": _coalesce_str(payload.severity) or "medium",
            "coverage": _coalesce_str(payload.coverage) or "Tiempo real",
            "zone": _coalesce_str(payload.zone) or "-",
            "confidence": max(0.0, float(payload.confidence or 0)),
            "evidence": _coalesce_str(payload.evidence) or "",
            "external_event_id": _coalesce_str(payload.external_event_id),
            "event_source": event_source,
            "payload": json.dumps(finding_payload, ensure_ascii=True),
        },
    )
    finding_row = insert_result.mappings().first()
    if not finding_row:
        raise HTTPException(status_code=500, detail="No se pudo persistir el hallazgo externo")

    snapshot_updated = False
    if payload.summary_rows:
        await _replace_camera_finding_snapshot_rows(
            db,
            video_id=int(camera_row["id"]),
            panel_key=panel_key,
            model_code=model_code,
            summary_rows=payload.summary_rows,
        )
        snapshot_updated = True

    if (
        payload.summary_rows
        or payload.active_persons is not None
        or payload.active_vehicles is not None
        or payload.active_findings is not None
        or payload.cumulative_findings is not None
    ):
        await _upsert_camera_live_snapshot_partial(
            db,
            video_id=int(camera_row["id"]),
            panel_key=panel_key,
            model_code=model_code,
            active_persons=payload.active_persons,
            active_vehicles=payload.active_vehicles,
            active_findings=payload.active_findings,
            cumulative_findings=payload.cumulative_findings,
            summary_rows=payload.summary_rows,
            source_tag=event_source,
        )
        snapshot_updated = True

    await db.commit()

    finding_event_id = int(finding_row["id"])
    return CameraExternalFindingOut(
        finding_event_id=finding_event_id,
        external_event_id=payload.external_event_id,
        video_id=int(camera_row["id"]),
        camera_name=camera_row["name"],
        map_code=camera_row.get("map_code"),
        evidence_video_url=_build_finding_evidence_video_url(
            finding_event_id,
            finding_row.get("evidence_video_name"),
        ),
        snapshot_updated=snapshot_updated,
        upload_evidence_url=f"{settings.api_prefix}/cameras/external/findings/{finding_event_id}/evidence-video",
    )


@router.post(
    "/external/findings/{finding_event_id}/evidence-video",
    response_model=CameraEvidenceVideoUploadOut,
)
async def upload_external_finding_evidence_video(
    finding_event_id: int = FastApiPath(..., ge=1),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_camera_finding_schema(db)
    result = await db.execute(
        text(
            """
            SELECT id, finding_code, external_event_id
            FROM camera_finding_event
            WHERE id = :finding_event_id
            """
        ),
        {"finding_event_id": finding_event_id},
    )
    finding_row = result.mappings().first()
    if not finding_row:
        raise HTTPException(status_code=404, detail="Hallazgo no encontrado")

    content_type = str(file.content_type or "").strip().lower() or "video/mp4"
    extension = _guess_evidence_extension(file.filename, content_type)
    if not content_type.startswith("video/") and extension not in EVIDENCE_ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=422, detail="El archivo debe ser un video corto")

    event_slug = _slugify_fragment(
        finding_row.get("external_event_id") or finding_row.get("finding_code"),
        f"finding-{finding_event_id}",
    )
    target_dir = EVIDENCE_ROOT / str(finding_event_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    for existing_file in target_dir.glob("*"):
        if existing_file.is_file():
            try:
                existing_file.unlink()
            except OSError:
                pass
    final_name = f"{event_slug}{extension}"
    final_path = target_dir / final_name

    try:
        with final_path.open("wb") as output_handle:
            shutil.copyfileobj(file.file, output_handle, length=1024 * 1024)
    finally:
        await file.close()

    size_bytes = int(final_path.stat().st_size)
    await db.execute(
        text(
            """
            UPDATE camera_finding_event
            SET evidence_video_path = :evidence_video_path,
                evidence_video_name = :evidence_video_name,
                evidence_video_mime = :evidence_video_mime,
                evidence_video_size = :evidence_video_size,
                evidence_video_uploaded_at = NOW()
            WHERE id = :finding_event_id
            """
        ),
        {
            "finding_event_id": finding_event_id,
            "evidence_video_path": str(final_path),
            "evidence_video_name": final_name,
            "evidence_video_mime": content_type,
            "evidence_video_size": size_bytes,
        },
    )
    await db.commit()

    return CameraEvidenceVideoUploadOut(
        finding_event_id=finding_event_id,
        evidence_video_url=_build_finding_evidence_video_url(finding_event_id, final_name) or "",
        file_name=final_name,
        content_type=content_type,
        size_bytes=size_bytes,
    )


@router.get("/external/findings/{finding_event_id}/evidence-video")
async def get_external_finding_evidence_video(
    finding_event_id: int = FastApiPath(..., ge=1),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_camera_finding_schema(db)
    result = await db.execute(
        text(
            """
            SELECT evidence_video_path, evidence_video_name, evidence_video_mime
            FROM camera_finding_event
            WHERE id = :finding_event_id
            """
        ),
        {"finding_event_id": finding_event_id},
    )
    row = result.mappings().first()
    if not row or not row.get("evidence_video_path"):
        raise HTTPException(status_code=404, detail="El hallazgo no tiene video de evidencia")

    file_path = Path(str(row["evidence_video_path"])).resolve()
    if not file_path.exists() or EVIDENCE_ROOT.resolve() not in file_path.parents:
        raise HTTPException(status_code=404, detail="No se encontro el video de evidencia")

    headers = {}
    video_name = str(row.get("evidence_video_name") or "").strip()
    if video_name:
        headers["Content-Disposition"] = f'inline; filename="{video_name}"'

    return FileResponse(
        file_path,
        media_type=str(row.get("evidence_video_mime") or "video/mp4"),
        headers=headers,
    )


def _ffmpeg_exists() -> bool:
    if os.path.isabs(FFMPEG_BIN):
        return Path(FFMPEG_BIN).exists()
    return shutil.which(FFMPEG_BIN) is not None


async def _stop_relay(runtime: CameraRelayRuntime) -> None:
    process = runtime.process
    if process.returncode is None:
        process.terminate()
        try:
            await asyncio.wait_for(process.wait(), timeout=4)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()


def _cleanup_output_dir(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for pattern in ("*.m3u8", "*.ts", "*.tmp", "*.log"):
        for file_path in output_dir.glob(pattern):
            try:
                file_path.unlink()
            except FileNotFoundError:
                pass


def _relay_signature(camera: dict[str, Any]) -> str:
    return f"{camera['id']}|{camera['source_type']}|{camera.get('relay_source') or camera['resolved_source']}"


async def _start_relay(camera: dict[str, Any]) -> CameraRelayRuntime:
    if not _ffmpeg_exists():
        raise HTTPException(
            status_code=503,
            detail="ffmpeg no esta disponible en el backend. Instala ffmpeg para reproducir RTSP/HTTP reales.",
        )

    output_dir = STREAM_ROOT / str(camera["id"])
    playlist_path = output_dir / "index.m3u8"
    _cleanup_output_dir(output_dir)

    source = camera.get("relay_source") or camera["resolved_source"]
    segment_pattern = str(output_dir / "segment_%03d.ts")
    common_args = [
        FFMPEG_BIN,
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
    ]

    if camera["source_type"] == "rtsp":
        input_args = ["-rtsp_transport", "tcp", "-fflags", "nobuffer", "-flags", "low_delay"]
    else:
        input_args = ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "2"]

    cmd = common_args + input_args + [
        "-i",
        source,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-tune",
        "zerolatency",
        "-pix_fmt",
        "yuv420p",
        "-g",
        "48",
        "-keyint_min",
        "48",
        "-sc_threshold",
        "0",
        "-c:a",
        "aac",
        "-ar",
        "44100",
        "-ac",
        "1",
        "-b:a",
        "96k",
        "-hls_time",
        str(STREAM_HLS_TIME),
        "-hls_list_size",
        str(STREAM_HLS_LIST_SIZE),
        "-hls_flags",
        "delete_segments+append_list+omit_endlist+independent_segments",
        "-hls_segment_filename",
        segment_pattern,
        "-f",
        "hls",
        str(playlist_path),
    ]

    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    return CameraRelayRuntime(
        camera_id=int(camera["id"]),
        source_signature=_relay_signature(camera),
        output_dir=output_dir,
        playlist_path=playlist_path,
        process=process,
        started_at=time.time(),
        last_touched=time.time(),
    )


async def _wait_for_playlist(runtime: CameraRelayRuntime) -> None:
    deadline = time.time() + STREAM_BOOT_TIMEOUT
    while time.time() < deadline:
        if runtime.playlist_path.exists() and runtime.playlist_path.stat().st_size > 0:
            return
        if runtime.process.returncode is not None:
            raise HTTPException(
                status_code=502,
                detail="ffmpeg termino antes de generar el playlist HLS para la camara",
            )
        await asyncio.sleep(0.35)

    raise HTTPException(
        status_code=504,
        detail="La camara no alcanzo a publicar el stream HLS dentro del tiempo esperado",
    )


async def _ensure_relay_ready(camera: dict[str, Any]) -> CameraRelayRuntime:
    camera_id = int(camera["id"])
    lock = _camera_lock(camera_id)
    async with lock:
        runtime = _relay_registry.get(camera_id)
        signature = _relay_signature(camera)
        now = time.time()

        if runtime and runtime.source_signature != signature:
            await _stop_relay(runtime)
            _relay_registry.pop(camera_id, None)
            runtime = None

        if runtime and runtime.process.returncode is None:
            runtime.last_touched = now
        else:
            if runtime:
                await _stop_relay(runtime)
            runtime = await _start_relay(camera)
            _relay_registry[camera_id] = runtime

        stale_runtime_ids = [
            runtime_id
            for runtime_id, item in _relay_registry.items()
            if runtime_id != camera_id
            and item.process.returncode is None
            and (now - item.last_touched) > STREAM_TOUCH_TTL
        ]
        for runtime_id in stale_runtime_ids:
            stale_runtime = _relay_registry.pop(runtime_id, None)
            if stale_runtime:
                await _stop_relay(stale_runtime)

    await _wait_for_playlist(runtime)
    return runtime


async def _probe_camera_stream(camera: dict[str, Any]) -> CameraSourceProbeOut:
    source_type = str(camera.get("source_type") or "")
    if source_type == "video_file":
        return CameraSourceProbeOut(
            ok=True,
            detail="Video local configurado en frontend. La validacion real ocurre al cargar la vista de camaras.",
            source_type=source_type,
            uses_relay=False,
            playback_url=camera.get("playback_url"),
        )

    if not _ffmpeg_exists():
        raise HTTPException(
            status_code=503,
            detail="ffmpeg no esta disponible en el backend. Instala ffmpeg para validar o relayar fuentes reales.",
        )

    source = str(camera.get("relay_source") or camera.get("resolved_source") or "").strip()
    if not source:
        raise HTTPException(status_code=422, detail="La camara no tiene una URL de origen valida")

    common_args = [
        FFMPEG_BIN,
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
    ]
    if source_type == "rtsp":
        input_args = ["-rtsp_transport", "tcp", "-fflags", "nobuffer", "-flags", "low_delay"]
    else:
        input_args = ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "2"]

    cmd = common_args + input_args + [
        "-i",
        source,
        "-frames:v",
        "1",
        "-f",
        "null",
        "-",
    ]

    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        _, stderr = await asyncio.wait_for(process.communicate(), timeout=STREAM_PROBE_TIMEOUT)
    except asyncio.TimeoutError:
        process.kill()
        await process.communicate()
        return CameraSourceProbeOut(
            ok=False,
            detail=f"Timeout al leer la fuente con ffmpeg despues de {STREAM_PROBE_TIMEOUT:.0f}s",
            source_type=source_type,
            uses_relay=bool(camera.get("uses_relay")),
            playback_url=camera.get("playback_url"),
        )

    stderr_text = (stderr or b"").decode("utf-8", errors="ignore").strip()
    if process.returncode == 0:
        detail = "ffmpeg pudo abrir la fuente y leer al menos un frame."
        if source_type == "rtsp":
            detail = "ffmpeg pudo abrir la fuente RTSP y leer al menos un frame."
        elif source_type == "http":
            detail = "ffmpeg pudo abrir la fuente HTTP y leer al menos un frame."
        return CameraSourceProbeOut(
            ok=True,
            detail=detail,
            source_type=source_type,
            uses_relay=bool(camera.get("uses_relay")),
            playback_url=camera.get("playback_url"),
        )

    compact_error = stderr_text.splitlines()[-1] if stderr_text else "ffmpeg no pudo abrir la fuente"
    return CameraSourceProbeOut(
        ok=False,
        detail=compact_error,
        source_type=source_type,
        uses_relay=bool(camera.get("uses_relay")),
        playback_url=camera.get("playback_url"),
    )


@router.get("/config", response_model=CamerasConfigOut)
async def get_cameras_config(db: AsyncSession = Depends(get_db)):
    await _ensure_default_ai_models(db)

    videos = [
        CameraVideoOut(**row)
        for row in await _fetch_camera_rows(db, active_only=True)
        if row.get("device_kind") == "camera"
    ]
    result_models = await db.execute(select(AiModel).order_by(AiModel.id))
    models = [AiModelOut.model_validate(model, from_attributes=True) for model in result_models.scalars().all()]
    return CamerasConfigOut(videos=videos, models=models)


@router.get("/sources", response_model=list[CameraVideoOut])
async def list_camera_sources(
    db: AsyncSession = Depends(get_db),
    current=Depends(get_current_user),
):
    await _require_camera_permission(db, current, ("configuracion", "camaras"))
    return [CameraVideoOut(**row) for row in await _fetch_camera_rows(db, active_only=False)]


@router.get("/sources/{camera_id}", response_model=CameraVideoOut)
async def get_camera_source(
    camera_id: int = FastApiPath(..., ge=1),
    db: AsyncSession = Depends(get_db),
    current=Depends(get_current_user),
):
    await _require_camera_permission(db, current, ("configuracion", "camaras"))
    row = await _fetch_camera_row(db, camera_id, active_only=False)
    if not row:
        raise HTTPException(status_code=404, detail="Camara no encontrada")
    return CameraVideoOut(**row)


@router.post("/sources/{camera_id}/probe", response_model=CameraSourceProbeOut)
async def probe_camera_source(
    camera_id: int = FastApiPath(..., ge=1),
    db: AsyncSession = Depends(get_db),
    current=Depends(get_current_user),
):
    await _require_camera_permission(db, current, ("configuracion", "camaras"))
    row = await _fetch_camera_row(db, camera_id, active_only=False)
    if not row:
        raise HTTPException(status_code=404, detail="Camara no encontrada")
    return await _probe_camera_stream(row)


@router.get("/map-devices/{map_code}")
async def list_camera_map_devices(
    map_code: str,
    db: AsyncSession = Depends(get_db),
):
    return await _fetch_camera_map_devices(db, map_code)


@router.get("/nok/overview")
async def get_nok_camera_overview(
    force: bool = False,
    db: AsyncSession = Depends(get_db),
    current=Depends(get_current_user),
):
    await _require_camera_permission(db, current, ("camaras", "nok_camaras"))
    return await _build_nok_camera_overview(db, force_refresh=force)


def _normalize_nok_visual_layout(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail="El layout NOC debe ser un objeto JSON")

    mode = str(payload.get("mode") or "responsive").strip().lower()
    if mode not in {"responsive", "manual", "manual_visual"}:
        raise HTTPException(status_code=422, detail="El modo debe ser responsive, manual o manual_visual")

    raw_maps = payload.get("maps")
    if not isinstance(raw_maps, list) or len(raw_maps) > 50:
        raise HTTPException(status_code=422, detail="El layout debe contener hasta 50 mapas")

    maps: list[dict[str, Any]] = []
    codes: set[str] = set()
    for raw_map in raw_maps:
        if not isinstance(raw_map, dict):
            raise HTTPException(status_code=422, detail="Cada mapa del layout debe ser un objeto")
        code = str(raw_map.get("code") or "").strip()[:80]
        label = str(raw_map.get("label") or "").strip()[:120]
        image_url = str(raw_map.get("image_url") or "").strip()[:2_000_000]
        if not code or not label or not image_url or code in codes:
            raise HTTPException(status_code=422, detail="Cada mapa requiere codigo, nombre e imagen unica")
        codes.add(code)

        raw_layout = raw_map.get("layout") if isinstance(raw_map.get("layout"), dict) else {}
        normalized_layout: dict[str, float] = {}
        for key, default in (("x", 0), ("y", 0), ("width", 50), ("height", 40)):
            try:
                number = float(raw_layout.get(key, default))
            except (TypeError, ValueError):
                raise HTTPException(status_code=422, detail=f"La posicion {key} no es valida") from None
            minimum = 1 if key in {"width", "height"} else 0
            if not 0 <= number <= 100 or number < minimum:
                raise HTTPException(status_code=422, detail=f"La posicion {key} debe estar entre 0 y 100")
            normalized_layout[key] = round(number, 3)

        maps.append({
            "code": code,
            "label": label,
            "image_url": image_url,
            "visible": bool(raw_map.get("visible", True)),
            "layout": normalized_layout,
        })

    return {"version": 1, "mode": mode, "maps": maps}


@router.get("/nok/layout")
async def get_nok_visual_layout_config(
    db: AsyncSession = Depends(get_db),
    current=Depends(get_current_user),
):
    await _require_camera_permission(db, current, ("camaras", "nok_camaras"))
    return (await get_nok_visual_layout(db)) or {"version": 1, "mode": "responsive", "maps": []}


@router.put("/nok/layout")
async def save_nok_visual_layout_config(
    payload: dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
    current=Depends(get_current_user),
):
    if not is_admin_role(getattr(current, "role", None)):
        raise HTTPException(status_code=403, detail="Solo un administrador puede configurar la visualizacion NOC")
    normalized = _normalize_nok_visual_layout(payload)
    return await upsert_nok_visual_layout(db, normalized)


@router.post("/sources", response_model=CameraVideoOut, status_code=201)
async def create_camera_source(
    payload: CameraSourceIn,
    db: AsyncSession = Depends(get_db),
    current=Depends(get_current_user),
):
    await _require_camera_permission(db, current, ("configuracion", "camaras"))
    await _ensure_camera_source_schema(db)
    data = _sanitize_camera_payload(payload)
    data["id"] = await _next_camera_id(db)
    await db.execute(
        text(
            """
            INSERT INTO camera_video (
                id,
                name,
                device_kind,
                source,
                source_type,
                camera_ip,
                camera_port,
                camera_path,
                camera_user,
                camera_password,
                site,
                nivel,
                map_code,
                x_pct,
                y_pct,
                nok_map_code,
                nok_x_pct,
                nok_y_pct,
                nok_alt_map_number,
                nok_alt_display_name,
                nok_enabled,
                nok_map_number,
                nok_display_name,
                notes,
                is_seed_overridden,
                is_active,
                updated_at
            ) VALUES (
                :id,
                :name,
                :device_kind,
                :source,
                :source_type,
                :camera_ip,
                :camera_port,
                :camera_path,
                :camera_user,
                :camera_password,
                :site,
                :nivel,
                :map_code,
                :x_pct,
                :y_pct,
                :nok_map_code,
                :nok_x_pct,
                :nok_y_pct,
                :nok_alt_map_number,
                :nok_alt_display_name,
                :nok_enabled,
                :nok_map_number,
                :nok_display_name,
                :notes,
                :is_seed_overridden,
                :is_active,
                NOW()
            )
            """
        ),
        data,
    )
    await db.commit()
    row = await _fetch_camera_row(db, int(data["id"]))
    if not row:
        raise HTTPException(status_code=500, detail="No se pudo recargar la camara creada")
    return CameraVideoOut(**row)


@router.put("/sources/{camera_id}", response_model=CameraVideoOut)
async def update_camera_source(
    payload: CameraSourceIn,
    camera_id: int = FastApiPath(..., ge=1),
    db: AsyncSession = Depends(get_db),
    current=Depends(get_current_user),
):
    await _require_camera_permission(db, current, ("configuracion", "camaras"))
    await _ensure_camera_source_schema(db)
    current = await _fetch_camera_row(db, camera_id, active_only=False)
    if not current:
        raise HTTPException(status_code=404, detail="Camara no encontrada")

    data = _sanitize_camera_payload(payload)
    data["id"] = camera_id
    await db.execute(
        text(
            """
            UPDATE camera_video
            SET
                name = :name,
                device_kind = :device_kind,
                source = :source,
                source_type = :source_type,
                camera_ip = :camera_ip,
                camera_port = :camera_port,
                camera_path = :camera_path,
                camera_user = :camera_user,
                camera_password = :camera_password,
                site = :site,
                nivel = :nivel,
                map_code = :map_code,
                x_pct = :x_pct,
                y_pct = :y_pct,
                nok_map_code = :nok_map_code,
                nok_x_pct = :nok_x_pct,
                nok_y_pct = :nok_y_pct,
                nok_alt_map_number = :nok_alt_map_number,
                nok_alt_display_name = :nok_alt_display_name,
                nok_enabled = :nok_enabled,
                nok_map_number = :nok_map_number,
                nok_display_name = :nok_display_name,
                notes = :notes,
                is_seed_overridden = :is_seed_overridden,
                is_active = :is_active,
                updated_at = NOW()
            WHERE id = :id
            """
        ),
        data,
    )
    await db.commit()

    runtime = _relay_registry.pop(camera_id, None)
    if runtime:
        await _stop_relay(runtime)

    row = await _fetch_camera_row(db, camera_id, active_only=False)
    if not row:
        raise HTTPException(status_code=500, detail="No se pudo recargar la camara actualizada")
    return CameraVideoOut(**row)


@router.delete("/sources/{camera_id}", response_model=CameraVideoOut)
async def deactivate_camera_source(
    camera_id: int = FastApiPath(..., ge=1),
    db: AsyncSession = Depends(get_db),
    current=Depends(get_current_user),
):
    await _require_camera_permission(db, current, ("configuracion", "camaras"))
    await _ensure_camera_source_schema(db)
    current = await _fetch_camera_row(db, camera_id, active_only=False)
    if not current:
        raise HTTPException(status_code=404, detail="Camara no encontrada")

    # Advance the persistent sequence before deletion so historic IDs are never reused.
    await _next_camera_id(db)
    await db.execute(text("DELETE FROM map_device WHERE kind IN ('camera', 'gate', 'fan') AND ref_id = :id"), {"id": camera_id})
    await db.execute(text("DELETE FROM camera_video WHERE id = :id"), {"id": camera_id})
    await db.commit()

    runtime = _relay_registry.pop(camera_id, None)
    if runtime:
        await _stop_relay(runtime)
    return CameraVideoOut(**{**current, "is_active": False, "nok_enabled": False})


@router.get("/stream/{camera_id}/index.m3u8")
async def stream_camera_playlist(
    camera_id: int = FastApiPath(..., ge=1),
    db: AsyncSession = Depends(get_db),
):
    camera = await _fetch_camera_row(db, camera_id, active_only=True)
    if not camera:
        raise HTTPException(status_code=404, detail="Camara no encontrada o inactiva")
    if not camera["uses_relay"]:
        raise HTTPException(status_code=400, detail="Esta fuente no necesita relay HLS")

    runtime = await _ensure_relay_ready(camera)
    return FileResponse(runtime.playlist_path, media_type="application/vnd.apple.mpegurl")


@router.get("/stream/{camera_id}/{filename}")
async def stream_camera_segment(
    camera_id: int = FastApiPath(..., ge=1),
    filename: str = FastApiPath(...),
    db: AsyncSession = Depends(get_db),
):
    clean_name = Path(filename).name
    if clean_name != filename:
        raise HTTPException(status_code=400, detail="Nombre de segmento invalido")

    camera = await _fetch_camera_row(db, camera_id, active_only=True)
    if not camera:
        raise HTTPException(status_code=404, detail="Camara no encontrada o inactiva")
    if not camera["uses_relay"]:
        raise HTTPException(status_code=400, detail="Esta fuente no necesita relay HLS")

    runtime = await _ensure_relay_ready(camera)
    file_path = runtime.output_dir / clean_name
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Segmento HLS no encontrado")

    media_type = "video/mp2t" if file_path.suffix == ".ts" else "application/octet-stream"
    return FileResponse(file_path, media_type=media_type)


@router.post("/analytics/snapshot")
async def sync_camera_analytics_snapshot(
    payload: CameraAnalyticsSnapshotIn,
    db: AsyncSession = Depends(get_db),
):
    return await _persist_camera_analytics_snapshot(db, payload)


@router.post("/analyze-ppe-frame", response_model=CameraAnalyzeFrameOut)
async def analyze_ppe_frame(payload: CameraAnalyzeFrameIn, db: AsyncSession = Depends(get_db)):
    if payload.model_code != "operational_safety_monitor":
        return CameraAnalyzeFrameOut(
            model_code=payload.model_code,
            persisted_count=0,
            operational_detections=[],
            detections=[],
            findings=[],
        )

    image = _decode_image(payload.image_base64)
    operational_detections: list[dict[str, Any]] = []

    if payload.include_operational:
        try:
            operational_detections = _run_operational_analysis(image)
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"No se pudo ejecutar analisis operacional: {exc}") from exc

    try:
        detections, findings = _run_ppe_analysis(image)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"No se pudo ejecutar analisis PPE: {exc}") from exc

    persisted_count = await _persist_camera_findings(db, payload, findings)

    return CameraAnalyzeFrameOut(
        model_code=payload.model_code,
        persisted_count=persisted_count,
        operational_detections=[CameraDetectionOut(**item) for item in operational_detections],
        detections=[CameraDetectionOut(**item) for item in detections],
        findings=[CameraFindingOut(**item) for item in findings],
    )
