# app/db/seed.py
import asyncio
from sqlalchemy import select, insert
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.db import init_models, SessionLocal
from app.db.models import User, MapPoint
from app.core.security import get_password_hash
from app.core.permissions import (
    DEFAULT_USERS,
    get_permission_pairs_for_role,
    replace_user_permissions,
)
from app.services.user_licenses import (
    DEFAULT_USER_LICENSE_INTERVAL_DAYS,
    backfill_missing_user_licenses,
    ensure_user_license_schema,
    resolve_user_license_expiration,
)

DEFAULT_POINTS = [
    ("NP",  "Portal Norte 1",  -29.953, -71.343, "GATE", "NORTE"),
    ("NP",  "Nodo 12",         -29.951, -71.347, "NODE", "NORTE"),
    ("UCL", "Portal Central",  -29.941, -71.331, "GATE", "CENTRO"),
    ("NTI", "Nodo 3",          -29.962, -71.355, "NODE", "INTERIOR"),
]

async def seed():
    await init_models()
    async with SessionLocal() as db:  # type: AsyncSession
        await ensure_default_users(db)
        # Puntos
        cur = await db.execute(select(MapPoint))
        if cur.scalars().first() is None:
            rows = [dict(site_code=a, name=b, lat=c, lng=d, point_type=e, zone=f)
                    for a, b, c, d, e, f in DEFAULT_POINTS]
            await db.execute(insert(MapPoint), rows)
        await db.commit()


async def ensure_default_users(db: AsyncSession | None = None) -> None:
    owns_session = db is None
    if owns_session:
        await init_models()
        session_manager = SessionLocal()
        db = await session_manager.__aenter__()

    try:
        assert db is not None
        await ensure_user_license_schema(db)
        await backfill_missing_user_licenses(db)
        for item in DEFAULT_USERS:
            q = await db.execute(select(User).where(User.username == item["username"]))
            user = q.scalars().first()
            hashed_password = get_password_hash(item["password"])

            if user:
                continue  # USB migration: preserve existing account settings.
                user.full_name = item["full_name"]
                user.role = item["role"]
                user.is_active = True
                if user.license_expires_on is None:
                    user.license_expires_on = resolve_user_license_expiration(
                        license_interval_days=DEFAULT_USER_LICENSE_INTERVAL_DAYS
                    )
                if item["username"] in {"admin_produccion", "tracking", "produccion", "acceso", "camaras", "productividad", "sismico", "control_vial", "agente_ia"}:
                    user.hashed_password = hashed_password
            else:
                await db.execute(
                    insert(User).values(
                        username=item["username"],
                        full_name=item["full_name"],
                        hashed_password=hashed_password,
                        role=item["role"],
                        is_active=True,
                        license_expires_on=resolve_user_license_expiration(
                            license_interval_days=DEFAULT_USER_LICENSE_INTERVAL_DAYS
                        ),
                    )
                )
                q = await db.execute(select(User).where(User.username == item["username"]))
                user = q.scalars().first()

            if user is not None:
                await db.commit()
                await replace_user_permissions(db, user.id, get_permission_pairs_for_role(user.role))

        if owns_session:
            await db.commit()
    finally:
        if owns_session:
            await session_manager.__aexit__(None, None, None)

if __name__ == "__main__":
    asyncio.run(seed())
