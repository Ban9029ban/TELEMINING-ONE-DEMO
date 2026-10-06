from __future__ import annotations

from app.core.state_codes import CRITICAL, NORMAL, OFFLINE, UNKNOWN, WARNING


def normalize_state(raw_value: str | None) -> str:
    value = (raw_value or "").strip().lower()

    if not value:
        return OFFLINE

    if value in {"normal", "verde", "green", "ok", "centro", "center", "middle", "media"}:
        return NORMAL

    if value in {"warning", "warn", "amarillo", "yellow"}:
        return WARNING

    if value in {"alerta", "alta", "superior", "inferior", "critical", "critico", "rojo", "red", "baja"}:
        return CRITICAL

    if value in {"offline", "off", "sin datos", "sin_datos", "nodata"}:
        return OFFLINE

    return UNKNOWN


def display_label(raw_value: str | None, state_code: str) -> str:
    raw = (raw_value or "").strip()
    if raw:
        return raw.upper()
    if state_code == NORMAL:
        return "NORMAL"
    if state_code == WARNING:
        return "AMARILLO"
    if state_code == CRITICAL:
        return "ALERTA"
    if state_code == OFFLINE:
        return "SIN DATOS"
    return "DESCONOCIDO"
