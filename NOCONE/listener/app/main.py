# listener/app/main.py
import asyncio
import contextlib
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .ingest_http import router as http_router
from .ingest_gao import start_gao_readers
from .unified_ingest import start_unified_ingest_server

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

logger = logging.getLogger("zenit.listener")

app = FastAPI(title="ZENIT Listener", version="1.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rutas HTTP
app.include_router(http_router, tags=["listener"])


@app.on_event("startup")
async def on_startup():
    logger.info("Arrancando TMOne Listener (web monitor + ingest 7070 + GAO opcional)")
    app.state.ingest_task = asyncio.create_task(start_unified_ingest_server())
    app.state.gao_tasks = await start_gao_readers()


@app.on_event("shutdown")
async def on_shutdown():
    logger.info("Deteniendo TMOne Listener")
    tasks = []
    ingest_task = getattr(app.state, "ingest_task", None)
    if ingest_task:
        tasks.append(ingest_task)
    tasks.extend(getattr(app.state, "gao_tasks", []) or [])

    for task in tasks:
        task.cancel()

    for task in tasks:
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task
