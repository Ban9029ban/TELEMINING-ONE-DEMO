# app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.db.db import async_session, init_models
from app.db.seed import ensure_default_users
from app.services.app_settings import ensure_app_setting_schema, ensure_camera_monitoring_settings
from app.services.user_licenses import backfill_missing_user_licenses, ensure_user_license_schema

from app.routers import health, auth, users

# Rutas "core" del front
from app.routers import access, config, cameras, tag_listener

# Productividad / Control
from app.routers import (
    control_transfers,
    control_graphics,
    control_visual,
    zenit,
    control_climate,
    map_device,
    maps,
    control,
)

# Extras / compat
from app.routers import transfer_times, climate_anomalies, mcp


app = FastAPI(
    title=settings.project_name,
    debug=settings.debug,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

# ------------------------------
# CORS
# ------------------------------
origins = settings.cors_origins or [
    "http://localhost:8081",
    "http://127.0.0.1:8081",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost",
    "http://127.0.0.1",
    "http://tmone.denial.cl",
    "http://tmone.denial.cl:8081",
    "https://tmone.denial.cl",
    "https://tmone.denial.cl:8081",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------------------------------------------------------
# Rutas agrupadas bajo /api (OFICIAL)
# ------------------------------------------------------------------
app.include_router(health.router, prefix=settings.api_prefix)
app.include_router(auth.router, prefix=settings.api_prefix)
app.include_router(users.router, prefix=settings.api_prefix)

app.include_router(access.router, prefix=settings.api_prefix)
app.include_router(config.router, prefix=settings.api_prefix)
app.include_router(cameras.router, prefix=settings.api_prefix)
app.include_router(tag_listener.router, prefix=settings.api_prefix)

app.include_router(control_transfers.router, prefix=settings.api_prefix)
app.include_router(control_graphics.router, prefix=settings.api_prefix)
app.include_router(control_visual.router, prefix=settings.api_prefix)
app.include_router(zenit.router, prefix=settings.api_prefix)
app.include_router(control_climate.router, prefix=settings.api_prefix)
app.include_router(map_device.router, prefix=settings.api_prefix)

# Control (legacy)
app.include_router(control.router, prefix=settings.api_prefix)

# Mapa/Tracking (router "maps.py" tiene prefix="/maps")
app.include_router(maps.router, prefix=f"{settings.api_prefix}/control")

# MCP
app.include_router(mcp.router, prefix=settings.api_prefix)

# ------------------------------------------------------------------
# Compatibilidad (SIN /api) - sólo si algún cliente lo usa
# ------------------------------------------------------------------
app.include_router(transfer_times.router, prefix=settings.api_prefix)
app.include_router(climate_anomalies.router, prefix=settings.api_prefix)

# (Opcional) legacy SIN /api
app.include_router(transfer_times.router)
app.include_router(climate_anomalies.router)


@app.on_event("startup")
async def on_startup():
    await init_models()
    async with async_session() as db:
        await ensure_user_license_schema(db)
        await backfill_missing_user_licenses(db)
        await db.commit()
    await ensure_default_users()
    async with async_session() as db:
        await ensure_app_setting_schema(db)
        await ensure_camera_monitoring_settings(db)
        await db.commit()
    await access.start_presence_timeout_monitor()
    await cameras.start_camera_network_monitor()


@app.on_event("shutdown")
async def on_shutdown():
    await access.stop_presence_timeout_monitor()
    await cameras.stop_camera_network_monitor()


@app.get("/")
async def root():
    return {"name": settings.project_name, "docs": "/docs"}
