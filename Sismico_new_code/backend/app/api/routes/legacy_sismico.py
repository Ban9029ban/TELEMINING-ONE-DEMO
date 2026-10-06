from fastapi import APIRouter

router = APIRouter()

LEGACY_PROJECTS = [
    {"code": "diamante", "name": "Diamante", "logo": "/legacy/DIAMANTE.png"},
    {"code": "andesita", "name": "Andesita", "logo": "/legacy/ANDESITA.png"},
    {"code": "andes-norte", "name": "Andes Norte", "logo": "/legacy/ANDES NORTE.png"},
]

LEGACY_STATE = {
    "diamante": {
        "title": "Proyecto Diamante",
        "logo": "/legacy/DIAMANTE.png",
        "map": "/legacy/diamante/map.png",
        "projectImage": "/legacy/diamante/d.jpg",
        "objects": [
            {"name": "Diamante PIPA", "mode": "normal_alerta", "value": "ALERTA"},
            {"name": "FootPrint HW", "mode": "normal_alerta", "value": "ALERTA"},
            {"name": "FootPrint Fw", "mode": "normal_alerta", "value": "ALERTA"},
            {"name": "Bajo Diamante Esmeralda", "mode": "triestado", "value": "CENTRO"},
        ],
    },
    "andesita": {
        "title": "ANDESITA",
        "logo": "/legacy/ANDESITA.png",
        "map": "/legacy/andesita/ANDESITAMAP.jpg",
        "objects": [
            {"name": "Andesita Norte HW", "mode": "triestado_baja_alta", "value": "CENTRO"},
            {"name": "Andesita Norte FW", "mode": "triestado_baja_alta", "value": "CENTRO"},
            {"name": "Andesita Sur HW", "mode": "triestado_baja_alta", "value": "CENTRO"},
            {"name": "Andesita Sur FW", "mode": "triestado_baja_alta", "value": "CENTRO"},
        ],
        "connection_log": "[12:34:02 PM] Falló JSON, probando HTML...",
    },
    "andes-norte": {
        "title": "Proyecto Andes Norte",
        "logo": "/legacy/andesnorte/ANLOGO.png",
        "map": "/legacy/andesnorte/ANNI/ANNI.jpg",
        "groups": [
            {
                "title": "POLÍGONO PROFUNDO",
                "items": [
                    {"name": "MONITOREO POST EVENTO 2025", "mode": "triestado", "value": "CENTRO"},
                    {"name": "ADIT 74 - 75", "mode": "triestado", "value": "CENTRO"},
                    {"name": "POLIGONO PILAR 2", "mode": "triestado", "value": "CENTRO"},
                ],
            },
            {
                "title": "POLÍGONO PRODUCCIÓN",
                "items": [
                    {"name": "INICIO CAVING", "mode": "triestado", "value": "CENTRO"},
                ],
            },
            {
                "title": "POLÍGONOS LOCALES",
                "items": [
                    {"name": "P 4600", "mode": "normal_alerta", "value": "NORMAL"},
                    {"name": "TC OIM", "mode": "normal_alerta", "value": "NORMAL"},
                    {"name": "PACÍFICO", "mode": "normal_alerta", "value": "NORMAL"},
                    {"name": "CABECERA HW", "mode": "normal_alerta", "value": "NORMAL"},
                    {"name": "AN NORTE HW", "mode": "normal_alerta", "value": "NORMAL"},
                    {"name": "AN NORTE FW", "mode": "normal_alerta", "value": "NORMAL"},
                    {"name": "AN SUR HW", "mode": "normal_alerta", "value": "NORMAL"},
                    {"name": "CABECERA FW NORTE", "mode": "normal_alerta", "value": "NORMAL"},
                    {"name": "MONITOREO POST EVENTO FW", "mode": "normal_alerta", "value": "NORMAL"},
                ],
            },
        ],
    },
}

@router.get("/projects")
def projects():
    return LEGACY_PROJECTS

@router.get("/state/{site_code}")
def site_state(site_code: str):
    return LEGACY_STATE.get(site_code, {"error": "site_not_found"})

@router.post("/poll/run")
def poll_run(payload: dict | None = None):
    return {
        "ok": True,
        "message": "Polling legado ejecutado (scaffold preparado para HDIS)",
        "source": payload or {},
    }
