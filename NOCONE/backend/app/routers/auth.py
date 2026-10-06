# app/routers/auth.py
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.db import get_session
from app.db.models import User
from app.core.security import verify_password, create_access_token
from app.deps.auth import get_current_user
from app.services.user_licenses import (
    build_user_read_payload,
    ensure_user_access_is_enabled,
    ensure_user_license_schema,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _normalize_role_name(role: str | None) -> str:
    raw = (role or "").strip().lower()
    return "Admin" if raw == "admin" else (role or "User")

@router.post("/token")
async def login(form: OAuth2PasswordRequestForm = Depends(),
                db: AsyncSession = Depends(get_session)):
    await ensure_user_license_schema(db)
    q = await db.execute(select(User).where(User.username == form.username))
    user = q.scalars().first()
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect username or password")
    ensure_user_access_is_enabled(user)
    token = create_access_token(subject=user.username)
    user_payload = build_user_read_payload(user)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user_id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "role": user.role,
        "roles": [{"name": _normalize_role_name(user.role)}],
        "is_active": bool(user.is_active),
        "license_expires_on": user_payload["license_expires_on"],
        "license_is_expired": user_payload["license_is_expired"],
        "license_warning_due": user_payload["license_warning_due"],
        "license_days_remaining": user_payload["license_days_remaining"],
        "access_enabled": user_payload["access_enabled"],
        "access_status": user_payload["access_status"],
    }

@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    user_payload = build_user_read_payload(user)
    return {
        "user_id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "role": user.role,
        "roles": [{"name": _normalize_role_name(user.role)}],
        "is_active": bool(user.is_active),
        "license_expires_on": user_payload["license_expires_on"],
        "license_is_expired": user_payload["license_is_expired"],
        "license_warning_due": user_payload["license_warning_due"],
        "license_days_remaining": user_payload["license_days_remaining"],
        "access_enabled": user_payload["access_enabled"],
        "access_status": user_payload["access_status"],
    }
