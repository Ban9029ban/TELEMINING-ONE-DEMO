from fastapi import APIRouter
from app.legacy.control.routes import router as control_router
from app.legacy.api.endpoints import router as api_router
from app.legacy.zenit.endpoints import router as zenit_router
from app.legacy.users.auth import router as auth_router
from app.legacy.users.endpoints import router as user_router
from app.legacy.MCP.endpoints import router as mcp_router
from .sse import router as sse_router

router = APIRouter()

router.include_router(sse_router, prefix="/sse")
router.include_router(control_router, prefix="/control", tags=["Control"])
router.include_router(api_router, prefix="/api")
router.include_router(zenit_router, prefix="/zenit")
router.include_router(auth_router, prefix="/auth", tags=["Authentication"])
router.include_router(user_router, prefix="/users", tags=["Users"])
router.include_router(mcp_router, prefix="/mcp")