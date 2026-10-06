from __future__ import annotations

import asyncio
from calendar import monthrange
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

DEFAULT_USER_LICENSE_INTERVAL_DAYS = 360
USER_LICENSE_INTERVAL_OPTIONS = (5, 10, 30, 60, 360)
_SANTIAGO_TZ = ZoneInfo("America/Santiago")
_USER_LICENSE_SCHEMA_LOCK = asyncio.Lock()
_USER_LICENSE_SCHEMA_READY = False


def current_license_reference_date() -> date:
    return datetime.now(_SANTIAGO_TZ).date()


def normalize_user_license_interval_days(value: Any) -> int:
    try:
        normalized = int(value)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=422,
            detail="El intervalo de licencia debe ser uno de estos valores: 5, 10, 30, 60 o 360 dias.",
        ) from None

    if normalized not in USER_LICENSE_INTERVAL_OPTIONS:
        raise HTTPException(
            status_code=422,
            detail="El intervalo de licencia debe ser uno de estos valores: 5, 10, 30, 60 o 360 dias.",
        )

    return normalized


def coerce_license_expiration_date(value: Any) -> date | None:
    if value in (None, ""):
        return None

    if isinstance(value, date) and not isinstance(value, datetime):
        return value

    if isinstance(value, datetime):
        return value.date()

    text_value = str(value).strip()
    if not text_value:
        return None

    try:
        return date.fromisoformat(text_value[:10])
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail="La fecha de licencia debe tener formato YYYY-MM-DD.",
        ) from None


def resolve_user_license_expiration(
    *,
    license_expires_on: Any = None,
    license_interval_days: Any = None,
    fallback_date: date | None = None,
) -> date:
    if license_interval_days not in (None, ""):
        interval_days = normalize_user_license_interval_days(license_interval_days)
        return current_license_reference_date() + timedelta(days=interval_days)

    explicit_date = coerce_license_expiration_date(license_expires_on)
    if explicit_date is not None:
        return explicit_date

    if fallback_date is not None:
        return fallback_date

    return current_license_reference_date() + timedelta(days=DEFAULT_USER_LICENSE_INTERVAL_DAYS)


def is_user_license_expired_value(
    license_expires_on: Any,
    *,
    reference_date: date | None = None,
) -> bool:
    expires_on = coerce_license_expiration_date(license_expires_on)
    if expires_on is None:
        return False

    current_date = reference_date or current_license_reference_date()
    return expires_on < current_date


def get_user_license_days_remaining(
    license_expires_on: Any,
    *,
    reference_date: date | None = None,
) -> int | None:
    expires_on = coerce_license_expiration_date(license_expires_on)
    if expires_on is None:
        return None

    current_date = reference_date or current_license_reference_date()
    return (expires_on - current_date).days


def get_user_access_status(
    is_active: bool,
    license_expires_on: Any,
    *,
    reference_date: date | None = None,
) -> str:
    if not bool(is_active):
        return "inactive"
    if is_user_license_expired_value(license_expires_on, reference_date=reference_date):
        return "expired"
    return "active"


def license_warning_due(expires_on: date | None, reference_date: date | None = None) -> bool:
    if expires_on is None:
        return False
    month_index = expires_on.year * 12 + expires_on.month - 1 - 2
    year, month = divmod(month_index, 12)
    month += 1
    warning_start = date(year, month, min(expires_on.day, monthrange(year, month)[1]))
    return warning_start <= (reference_date or current_license_reference_date())


def build_user_read_payload(user: Any) -> dict[str, Any]:
    expires_on = coerce_license_expiration_date(getattr(user, "license_expires_on", None))
    is_expired = is_user_license_expired_value(expires_on)
    days_remaining = get_user_license_days_remaining(expires_on)
    access_status = get_user_access_status(
        bool(getattr(user, "is_active", False)),
        expires_on,
    )

    return {
        "id": int(user.id),
        "username": str(user.username or ""),
        "full_name": getattr(user, "full_name", "") or "",
        "role": getattr(user, "role", None),
        "is_active": bool(getattr(user, "is_active", False)),
        "license_expires_on": expires_on,
        "license_is_expired": is_expired,
        "license_warning_due": license_warning_due(expires_on),
        "license_days_remaining": days_remaining,
        "access_enabled": access_status == "active",
        "access_status": access_status,
    }


def ensure_user_access_is_enabled(user: Any) -> None:
    if not bool(getattr(user, "is_active", False)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuario deshabilitado. Solicita habilitacion a un administrador.",
        )

    expires_on = coerce_license_expiration_date(getattr(user, "license_expires_on", None))
    if expires_on is None:
        return

    if is_user_license_expired_value(expires_on):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Licencia de usuario vencida el {expires_on.isoformat()}.",
        )


async def ensure_user_license_schema(session: AsyncSession) -> None:
    global _USER_LICENSE_SCHEMA_READY

    if _USER_LICENSE_SCHEMA_READY:
        return

    async with _USER_LICENSE_SCHEMA_LOCK:
        if _USER_LICENSE_SCHEMA_READY:
            return

        await session.execute(
            text(
                """
                ALTER TABLE users
                ADD COLUMN IF NOT EXISTS license_expires_on DATE
                """
            )
        )
        await session.commit()
        _USER_LICENSE_SCHEMA_READY = True

async def backfill_missing_user_licenses(session: AsyncSession) -> None:
    await ensure_user_license_schema(session)
    await session.execute(
        text(
            """
            UPDATE users
            SET license_expires_on = CURRENT_DATE + CAST(:default_days AS INTEGER)
            WHERE license_expires_on IS NULL
            """
        ),
        {"default_days": DEFAULT_USER_LICENSE_INTERVAL_DAYS},
    )
