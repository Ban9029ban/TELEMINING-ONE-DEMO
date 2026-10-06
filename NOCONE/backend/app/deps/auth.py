# app/deps/auth.py
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.security import decode_token
from app.db.db import get_session
from app.db.models import User
from app.services.user_licenses import ensure_user_access_is_enabled, ensure_user_license_schema

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.api_prefix}/auth/token")

async def get_current_user(token: str = Depends(oauth2_scheme),
                           db: AsyncSession = Depends(get_session)) -> User:
    cred_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_token(token)
        username: str = payload.get("sub")
        if not username:
            raise cred_exc
    except Exception:
        raise cred_exc

    await ensure_user_license_schema(db)
    q = await db.execute(select(User).where(User.username == username))
    user = q.scalars().first()
    if not user:
        raise cred_exc
    ensure_user_access_is_enabled(user)
    return user
