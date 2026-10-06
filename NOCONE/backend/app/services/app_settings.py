from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

CAMERA_MONITORING_SETTINGS_CATEGORY = "camera_monitoring"
CAMERA_MONITORING_INTERVAL_SECONDS_KEY = "camera_monitoring_interval_seconds"
CAMERA_MONITORING_DEFAULT_INTERVAL_SECONDS = 30
CAMERA_MONITORING_MIN_INTERVAL_SECONDS = 30
CAMERA_MONITORING_MAX_INTERVAL_SECONDS = 3600
CAMERA_MONITORING_DESCRIPTION = (
    "Intervalo en segundos para el monitoreo IP/TCP de dispositivos NOC (camaras, portones y ventiladores) y el auto-refresh del frontend."
)
NOK_VISUAL_LAYOUT_KEY = "nok_visual_layout"
NOK_VISUAL_LAYOUT_CATEGORY = "camera_monitoring"
NOK_VISUAL_LAYOUT_DESCRIPTION = "Configuracion visual compartida del dashboard NOC en pantalla completa."
_APP_SETTING_SCHEMA_LOCK = asyncio.Lock()
_APP_SETTING_SCHEMA_READY = False
_APP_SETTING_WRITE_LOCK_KEY = 834271


async def ensure_app_setting_schema(db: AsyncSession) -> None:
    global _APP_SETTING_SCHEMA_READY

    if _APP_SETTING_SCHEMA_READY:
        return

    async with _APP_SETTING_SCHEMA_LOCK:
        if _APP_SETTING_SCHEMA_READY:
            return

        await db.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS app_setting (
                    key TEXT PRIMARY KEY,
                    value TEXT,
                    description TEXT,
                    category TEXT NOT NULL DEFAULT 'general',
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
        )
        await db.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_app_setting_category
                ON app_setting(category)
                """
            )
        )
        await db.commit()
        _APP_SETTING_SCHEMA_READY = True


async def acquire_app_setting_write_lock(db: AsyncSession) -> None:
    await db.execute(
        text("SELECT pg_advisory_xact_lock(:lock_key)"),
        {"lock_key": _APP_SETTING_WRITE_LOCK_KEY},
    )


async def ensure_app_setting_value(
    db: AsyncSession,
    *,
    key: str,
    value: str,
    description: str,
    category: str,
) -> None:
    await ensure_app_setting_schema(db)
    await acquire_app_setting_write_lock(db)
    result = await db.execute(
        text(
            """
            SELECT 1
            FROM app_setting
            WHERE key = :key
            LIMIT 1
            """
        ),
        {"key": key},
    )
    if result.scalar_one_or_none() is not None:
        return

    await db.execute(
        text(
            """
            INSERT INTO app_setting (key, value, description, category, updated_at)
            VALUES (:key, :value, :description, :category, now())
            """
        ),
        {
            "key": key,
            "value": value,
            "description": description,
            "category": category,
        },
    )


async def upsert_app_setting(
    db: AsyncSession,
    *,
    key: str,
    value: str,
    description: str,
    category: str,
) -> None:
    await ensure_app_setting_schema(db)
    await acquire_app_setting_write_lock(db)
    await db.execute(
        text(
            """
            INSERT INTO app_setting (key, value, description, category, updated_at)
            VALUES (:key, :value, :description, :category, now())
            ON CONFLICT (key) DO UPDATE
            SET
                value = EXCLUDED.value,
                description = EXCLUDED.description,
                category = EXCLUDED.category,
                updated_at = now()
            """
        ),
        {
            "key": key,
            "value": value,
            "description": description,
            "category": category,
        },
    )


async def ensure_camera_monitoring_settings(db: AsyncSession) -> None:
    await ensure_app_setting_value(
        db,
        key=CAMERA_MONITORING_INTERVAL_SECONDS_KEY,
        value=str(CAMERA_MONITORING_DEFAULT_INTERVAL_SECONDS),
        description=CAMERA_MONITORING_DESCRIPTION,
        category=CAMERA_MONITORING_SETTINGS_CATEGORY,
    )


def normalize_camera_monitoring_interval_seconds(value: Any) -> int:
    try:
        interval_seconds = int(value)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=422,
            detail=(
                "El intervalo de monitoreo de camaras debe ser un entero en segundos "
                f"entre {CAMERA_MONITORING_MIN_INTERVAL_SECONDS} y {CAMERA_MONITORING_MAX_INTERVAL_SECONDS}."
            ),
        ) from None

    if not (
        CAMERA_MONITORING_MIN_INTERVAL_SECONDS
        <= interval_seconds
        <= CAMERA_MONITORING_MAX_INTERVAL_SECONDS
    ):
        raise HTTPException(
            status_code=422,
            detail=(
                "El intervalo de monitoreo de camaras debe estar entre "
                f"{CAMERA_MONITORING_MIN_INTERVAL_SECONDS} y {CAMERA_MONITORING_MAX_INTERVAL_SECONDS} segundos."
            ),
        )

    return interval_seconds


async def get_camera_monitoring_interval_seconds(
    db: AsyncSession,
    *,
    fallback: int = CAMERA_MONITORING_DEFAULT_INTERVAL_SECONDS,
) -> int:
    await ensure_app_setting_schema(db)
    result = await db.execute(
        text(
            """
            SELECT value
            FROM app_setting
            WHERE key = :key
            LIMIT 1
            """
        ),
        {"key": CAMERA_MONITORING_INTERVAL_SECONDS_KEY},
    )
    raw_value = result.scalar_one_or_none()

    if raw_value in (None, ""):
        return normalize_camera_monitoring_interval_seconds(fallback)

    return normalize_camera_monitoring_interval_seconds(raw_value)


async def get_camera_monitoring_settings_payload(db: AsyncSession) -> dict[str, Any]:
    await ensure_app_setting_schema(db)
    result = await db.execute(
        text(
            """
            SELECT key, value, description, category, updated_at
            FROM app_setting
            WHERE key = :key
            LIMIT 1
            """
        ),
        {"key": CAMERA_MONITORING_INTERVAL_SECONDS_KEY},
    )
    row = result.mappings().first() or {}
    raw_value = row.get("value", CAMERA_MONITORING_DEFAULT_INTERVAL_SECONDS)
    interval_seconds = normalize_camera_monitoring_interval_seconds(raw_value)

    return {
        "key": CAMERA_MONITORING_INTERVAL_SECONDS_KEY,
        "category": row.get("category") or CAMERA_MONITORING_SETTINGS_CATEGORY,
        "refresh_interval_seconds": interval_seconds,
        "min_seconds": CAMERA_MONITORING_MIN_INTERVAL_SECONDS,
        "max_seconds": CAMERA_MONITORING_MAX_INTERVAL_SECONDS,
        "description": row.get("description") or CAMERA_MONITORING_DESCRIPTION,
        "updated_at": row.get("updated_at"),
    }


async def upsert_camera_monitoring_interval_seconds(
    db: AsyncSession,
    interval_seconds: Any,
) -> dict[str, Any]:
    normalized_interval = normalize_camera_monitoring_interval_seconds(interval_seconds)
    await upsert_app_setting(
        db,
        key=CAMERA_MONITORING_INTERVAL_SECONDS_KEY,
        value=str(normalized_interval),
        description=CAMERA_MONITORING_DESCRIPTION,
        category=CAMERA_MONITORING_SETTINGS_CATEGORY,
    )
    return await get_camera_monitoring_settings_payload(db)


async def get_nok_visual_layout(db: AsyncSession) -> dict[str, Any] | None:
    await ensure_app_setting_schema(db)
    result = await db.execute(
        text(
            """
            SELECT value, updated_at
            FROM app_setting
            WHERE key = :key
            LIMIT 1
            """
        ),
        {"key": NOK_VISUAL_LAYOUT_KEY},
    )
    row = result.mappings().first()
    if not row or not row.get("value"):
        return None

    try:
        payload = json.loads(str(row["value"]))
    except (TypeError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    payload["updated_at"] = row.get("updated_at")
    return payload


async def upsert_nok_visual_layout(db: AsyncSession, layout: dict[str, Any]) -> dict[str, Any]:
    await upsert_app_setting(
        db,
        key=NOK_VISUAL_LAYOUT_KEY,
        value=json.dumps(layout, ensure_ascii=False),
        description=NOK_VISUAL_LAYOUT_DESCRIPTION,
        category=NOK_VISUAL_LAYOUT_CATEGORY,
    )
    await db.commit()
    return (await get_nok_visual_layout(db)) or layout
