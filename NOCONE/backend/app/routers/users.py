# backend/app/routers/users.py
from typing import Any, Dict, List

from fastapi import APIRouter, Body, Depends, HTTPException, Path
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete, select, text

from app.db.session import get_session
from app.db.models import User
from app.schemas.user import UserCreate, UserRead, UserUpdate
from app.core.permissions import (
    PERMISSION_CATALOG,
    build_effective_permission_map,
    ensure_permission_schema,
    get_permission_pairs_for_role,
    get_user_permission_overrides,
    is_admin_role,
    replace_user_permissions,
    user_has_any_permission,
)
from app.core.security import get_password_hash
from app.deps.auth import get_current_user
from app.services.user_licenses import (
    build_user_read_payload,
    ensure_user_license_schema,
    resolve_user_license_expiration,
)

router = APIRouter(prefix="/users", tags=["users"])


async def _require_user_permissions_access(session: AsyncSession, current: User) -> None:
    if is_admin_role(getattr(current, "role", None)):
        return

    allowed = await user_has_any_permission(
        session,
        current.id,
        getattr(current, "role", None),
        {("configuracion", "usuarios_permisos")},
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="Usuario sin permisos para este recurso")


async def _read_user_permissions(session: AsyncSession, user_id: int, user_role: str | None = None) -> Dict[str, Any]:
    await ensure_permission_schema(session)
    overrides = await get_user_permission_overrides(session, user_id)
    effective = build_effective_permission_map(user_role, overrides)
    items = [
        {
            "module_key": item["module_key"],
            "submodule_key": item["submodule_key"],
            "label": item["label"],
            "sort_order": item["sort_order"],
            "allowed": bool(effective.get((item["module_key"], item["submodule_key"]))),
        }
        for item in sorted(
            PERMISSION_CATALOG,
            key=lambda value: (int(value.get("sort_order") or 0), str(value.get("label") or "")),
        )
    ]

    return {
        "items": items,
        "allowed": {
            f"{item['module_key']}:{item['submodule_key']}": bool(item["allowed"]) for item in items
        },
    }

# ---- Helpers ----
async def _get_user_by_username(session: AsyncSession, username: str) -> User | None:
    res = await session.execute(select(User).where(User.username == username))
    return res.scalars().first()

# ---- Endpoints ----
@router.get("/", response_model=List[UserRead])
async def list_users(
    session: AsyncSession = Depends(get_session),
    current=Depends(get_current_user),  # proteger si quieres
):
    await _require_user_permissions_access(session, current)
    await ensure_user_license_schema(session)
    res = await session.execute(select(User))
    return [build_user_read_payload(user) for user in res.scalars().all()]

@router.post("/", response_model=UserRead, status_code=201)
async def create_user(
    body: UserCreate,
    session: AsyncSession = Depends(get_session),
    current=Depends(get_current_user),
):
    await _require_user_permissions_access(session, current)
    await ensure_user_license_schema(session)
    exists = await _get_user_by_username(session, body.username)
    if exists:
        raise HTTPException(status_code=409, detail="username already exists")

    user = User(
        username=body.username,
        full_name=(body.full_name or "").strip(),
        hashed_password=get_password_hash(body.password),
        role=body.role or "user",
        is_active=True if body.is_active is None else body.is_active,
        license_expires_on=resolve_user_license_expiration(
            license_expires_on=body.license_expires_on,
            license_interval_days=body.license_interval_days,
        ),
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    await replace_user_permissions(session, user.id, get_permission_pairs_for_role(user.role))

    await session.refresh(user)
    return build_user_read_payload(user)

@router.get("/permission-catalog")
async def get_permission_catalog(
    session: AsyncSession = Depends(get_session),
    current=Depends(get_current_user),
):
    await _require_user_permissions_access(session, current)
    await ensure_permission_schema(session)
    return {"items": PERMISSION_CATALOG}


@router.get("/me/permissions")
async def get_my_permissions(
    session: AsyncSession = Depends(get_session),
    current=Depends(get_current_user),
):
    return await _read_user_permissions(session, current.id, getattr(current, "role", None))


@router.get("/{user_id}/permissions")
async def get_user_permissions(
    user_id: int = Path(..., ge=1),
    session: AsyncSession = Depends(get_session),
    current=Depends(get_current_user),
):
    await _require_user_permissions_access(session, current)
    await ensure_user_license_schema(session)
    res = await session.execute(select(User).where(User.id == user_id))
    user = res.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="user not found")
    return await _read_user_permissions(session, user.id, getattr(user, "role", None))


@router.put("/{user_id}/permissions")
async def update_user_permissions(
    user_id: int = Path(..., ge=1),
    body: Dict[str, Any] = Body(...),
    session: AsyncSession = Depends(get_session),
    current=Depends(get_current_user),
):
    await _require_user_permissions_access(session, current)
    await ensure_user_license_schema(session)
    res = await session.execute(select(User).where(User.id == user_id))
    user = res.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="user not found")

    await ensure_permission_schema(session)
    items = body.get("items")
    if not isinstance(items, list):
        raise HTTPException(status_code=422, detail="items is required")

    valid_keys = {
        (item["module_key"], item["submodule_key"])
        for item in PERMISSION_CATALOG
    }

    for item in items:
        module_key = str(item.get("module_key") or "").strip()
        submodule_key = str(item.get("submodule_key") or "").strip()
        allowed = bool(item.get("allowed"))
        if (module_key, submodule_key) not in valid_keys:
            continue

        await session.execute(
            text(
                """
                INSERT INTO user_permission_assignment (user_id, module_key, submodule_key, allowed, updated_at)
                VALUES (:user_id, :module_key, :submodule_key, :allowed, now())
                ON CONFLICT (user_id, module_key, submodule_key) DO UPDATE
                SET allowed = EXCLUDED.allowed,
                    updated_at = now()
                """
            ),
            {
                "user_id": user_id,
                "module_key": module_key,
                "submodule_key": submodule_key,
                "allowed": allowed,
            },
        )

    await session.commit()
    return await _read_user_permissions(session, user_id, getattr(user, "role", None))


@router.get("/{user_id}", response_model=UserRead)
async def get_user(
    user_id: int = Path(..., ge=1),
    session: AsyncSession = Depends(get_session),
    current=Depends(get_current_user),
):
    await _require_user_permissions_access(session, current)
    await ensure_user_license_schema(session)
    res = await session.execute(select(User).where(User.id == user_id))
    user = res.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="user not found")
    return build_user_read_payload(user)

@router.patch("/{user_id}", response_model=UserRead)
async def update_user(
    user_id: int,
    body: UserUpdate,
    session: AsyncSession = Depends(get_session),
    current=Depends(get_current_user),
):
    await _require_user_permissions_access(session, current)
    await ensure_user_license_schema(session)
    res = await session.execute(select(User).where(User.id == user_id))
    user = res.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="user not found")

    if body.username is not None and body.username != user.username:
        if await _get_user_by_username(session, body.username):
            raise HTTPException(status_code=409, detail="username already exists")
        user.username = body.username

    if body.password:
        user.hashed_password = get_password_hash(body.password)

    if body.full_name is not None:
        user.full_name = body.full_name.strip()

    if body.role is not None:
        previous_role = user.role
        user.role = body.role
    else:
        previous_role = user.role

    if body.is_active is not None:
        user.is_active = body.is_active

    user.license_expires_on = resolve_user_license_expiration(
        license_expires_on=body.license_expires_on,
        license_interval_days=body.license_interval_days,
        fallback_date=user.license_expires_on,
    )

    await session.commit()
    await session.refresh(user)

    if body.role is not None and body.role != previous_role:
        await replace_user_permissions(session, user.id, get_permission_pairs_for_role(user.role))
        await session.refresh(user)

    return build_user_read_payload(user)

@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: int,
    session: AsyncSession = Depends(get_session),
    current=Depends(get_current_user),
):
    await _require_user_permissions_access(session, current)
    await ensure_user_license_schema(session)
    res = await session.execute(select(User).where(User.id == user_id))
    user = res.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="user not found")

    await session.execute(delete(User).where(User.id == user_id))
    await session.commit()
    return None
