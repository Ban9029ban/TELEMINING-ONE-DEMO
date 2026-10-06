from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from starlette.routing import Mount
from app.core.deps import get_current_user
from app.core import settings

# This router remaps legacy routes to start with /api/* so the frontend can call /api/... uniformly.
router = APIRouter(prefix=f"{settings.API_PREFIX}", tags=["compat"])

@router.get("/auth/me")
async def auth_me(current=Depends(get_current_user)):
    # Minimal payload for SPAs
    return {"email": current.email, "role": current.role, "is_active": current.is_active}

# OAuth2-style token endpoint alias to our login
from pydantic import BaseModel
from app.core.security import create_token
from app.db.session import get_session
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.user import User
from app.core.security import verify_password

class OAuthLogin(BaseModel):
    username: str
    password: str

@router.post("/auth/token")
async def auth_token(body: OAuthLogin, session: AsyncSession = Depends(get_session)):
    # Accept username/password and return access token only (compat)
    res = await session.execute(select(User).where(User.email == body.username))
    user = res.scalars().first()
    if not user or not verify_password(body.password, user.hashed_password):
        return JSONResponse(status_code=401, content={"detail":"Invalid credentials"})
    access = create_token(subject=user.email, expires_minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    refresh = create_token(subject=user.email, expires_minutes=settings.REFRESH_TOKEN_EXPIRE_MINUTES)
    return {"access_token": access, "refresh_token": refresh, "token_type":"bearer"}

# Generic forwarders: /api/control/* -> /control/*, /api/zenit/* -> /zenit/*, /api/users/* -> /users/*
from fastapi import Response
from starlette.requests import ClientDisconnect
from starlette.responses import StreamingResponse
from starlette.background import BackgroundTask
import httpx

async def _proxy(request: Request, prefix_src: str, prefix_dst: str):
    # reconstruct URL against same backend (loopback)
    path = request.url.path
    new_path = path.replace(prefix_src, prefix_dst, 1)
    query = request.url.query
    url = f"http://127.0.0.1:8000{new_path}"
    if query:
        url += f"?{query}"
    method = request.method
    headers = dict(request.headers)
    headers.pop("host", None)
    # Pass auth header through
    async with httpx.AsyncClient(timeout=30.0) as client:
        content = await request.body()
        r = await client.request(method, url, headers=headers, content=content)
    return Response(content=r.content, status_code=r.status_code, headers=dict(r.headers))

@router.api_route("/control/{path:path}", methods=["GET","POST","PUT","PATCH","DELETE"])
async def proxy_control(path: str, request: Request):
    return await _proxy(request, f"{settings.API_PREFIX}/control", "/control")

@router.api_route("/zenit/{path:path}", methods=["GET","POST","PUT","PATCH","DELETE"])
async def proxy_zenit(path: str, request: Request):
    return await _proxy(request, f"{settings.API_PREFIX}/zenit", "/zenit")

@router.api_route("/users/{path:path}", methods=["GET","POST","PUT","PATCH","DELETE"])
async def proxy_users(path: str, request: Request):
    return await _proxy(request, f"{settings.API_PREFIX}/users", "/users")

@router.api_route("/mcp/{path:path}", methods=["GET","POST","PUT","PATCH","DELETE"])
async def proxy_mcp(path: str, request: Request):
    return await _proxy(request, f"{settings.API_PREFIX}/mcp", "/mcp")