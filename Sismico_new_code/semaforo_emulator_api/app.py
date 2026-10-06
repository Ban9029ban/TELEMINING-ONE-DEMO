
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Semáforo Emulator API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATE: dict[str, Any] = {
    "state": "off",
    "device_code": "virtual-semaforo",
    "site_code": "virtual",
    "requested_by": "system",
    "reason": "-",
    "updated_at": datetime.now(timezone.utc).isoformat(),
    "history": [],
}


class StatePayload(BaseModel):
    state: str
    device_code: str | None = None
    site_code: str | None = None
    requested_by: str | None = None
    reason: str | None = None


def normalize_state(value: str | None) -> str:
    raw = str(value or "off").strip().lower()
    return {
        "rojo": "red",
        "red": "red",
        "amarillo": "yellow",
        "yellow": "yellow",
        "verde": "green",
        "green": "green",
        "apagado": "off",
        "off": "off",
    }.get(raw, "off")


@app.get("/api/emulator/semaforo/state")
def get_state():
    return STATE


@app.post("/api/emulator/semaforo/state")
def set_state(payload: StatePayload):
    now = datetime.now(timezone.utc).isoformat()
    normalized = normalize_state(payload.state)

    STATE.update({
        "state": normalized,
        "device_code": payload.device_code or "virtual-semaforo",
        "site_code": payload.site_code or "virtual",
        "requested_by": payload.requested_by or "system",
        "reason": payload.reason or "-",
        "updated_at": now,
    })

    history = list(STATE.get("history") or [])
    history.insert(0, {
        "updated_at": now,
        "state": normalized,
        "device_code": STATE["device_code"],
        "site_code": STATE["site_code"],
        "requested_by": STATE["requested_by"],
        "reason": STATE["reason"],
    })
    STATE["history"] = history[:50]

    return STATE
