from datetime import datetime, timedelta, timezone
from fastapi import APIRouter

router = APIRouter(prefix="/dashboard-sismico", tags=["dashboard-sismico"])

DEMO_SITES = [
    {"id": 1, "company_code": "codelco", "site_code": "andes_norte", "name": "Andes Norte"},
    {"id": 2, "company_code": "codelco", "site_code": "diamante", "name": "Diamante"},
]

DEMO_OBJECTS = [
    {"id": 1, "site_id": 1, "code": "MONITOREO_POST_EVENTO", "name": "Monitoreo Post Evento", "severity": "critical", "x": 22, "y": 18, "w": 18, "h": 14},
    {"id": 2, "site_id": 1, "code": "ADIT_74_75", "name": "Adit 74 - 75", "severity": "warning", "x": 46, "y": 20, "w": 14, "h": 12},
    {"id": 3, "site_id": 1, "code": "P_4600", "name": "P 4600", "severity": "normal", "x": 63, "y": 35, "w": 15, "h": 15},
    {"id": 4, "site_id": 1, "code": "POLIGONO_PILAR_2", "name": "Polígono Pilar 2", "severity": "critical", "x": 35, "y": 52, "w": 18, "h": 13},
    {"id": 5, "site_id": 1, "code": "INICIO_CAVING", "name": "Inicio Caving", "severity": "normal", "x": 58, "y": 60, "w": 18, "h": 13},
]

def utc_now():
    return datetime.now(timezone.utc)

@router.get("/overview")
def overview():
    now = utc_now()
    return {
        "generated_at": now.isoformat(),
        "summary": {
            "companies": 2,
            "sites": 4,
            "screens_online": 9,
            "screens_offline": 2,
            "active_alerts": 3,
            "endpoints_error": 1,
        },
        "sites": DEMO_SITES,
        "alerts": [
            {
                "id": 101,
                "site_code": "andes_norte",
                "severity": "critical",
                "title": "Polígono Pilar 2 en estado crítico",
                "opened_at": (now - timedelta(minutes=8)).isoformat(),
                "action": "ipsemaforo 10.10.20.11 rojo",
            },
            {
                "id": 102,
                "site_code": "andes_norte",
                "severity": "warning",
                "title": "Adit 74 - 75 con advertencia",
                "opened_at": (now - timedelta(minutes=18)).isoformat(),
                "action": None,
            },
            {
                "id": 103,
                "site_code": "diamante",
                "severity": "critical",
                "title": "BDE con condición de alerta",
                "opened_at": (now - timedelta(minutes=35)).isoformat(),
                "action": "ipsemaforo 10.10.20.14 rojo",
            },
        ],
        "screens": [
            {"screen_code": "an_wall_01", "site_code": "andes_norte", "status": "online", "last_seen_seconds": 11, "current_url": "/sismico?site=andes_norte"},
            {"screen_code": "an_wall_02", "site_code": "andes_norte", "status": "online", "last_seen_seconds": 22, "current_url": "/sismico?site=andes_norte"},
            {"screen_code": "dia_wall_01", "site_code": "diamante", "status": "offline", "last_seen_seconds": 366, "current_url": "/sismico?site=diamante"},
        ],
        "endpoints": [
            {"endpoint_code": "andes_8001", "site_code": "andes_norte", "status": "ok", "latency_ms": 212},
            {"endpoint_code": "andes_8008", "site_code": "andes_norte", "status": "ok", "latency_ms": 188},
            {"endpoint_code": "diamante_8001", "site_code": "diamante", "status": "error", "latency_ms": None},
        ],
    }

@router.get("/site/{site_code}")
def site_detail(site_code: str):
    now = utc_now()
    site = next((s for s in DEMO_SITES if s["site_code"] == site_code), None)
    if not site:
        return {"generated_at": now.isoformat(), "site": None, "objects": [], "timeline": []}
    return {
        "generated_at": now.isoformat(),
        "site": site,
        "map": {
            "name": f"Plano {site['name']}",
            "background_url": "/sismico/img/MAP-AN.jpg" if site_code == "andes_norte" else "/sismico/img/d.jpg",
        },
        "objects": [o for o in DEMO_OBJECTS if o["site_id"] == site["id"]],
        "timeline": [
            {"time": (now - timedelta(minutes=40)).isoformat(), "label": "Monitoreo Post Evento cambió a warning"},
            {"time": (now - timedelta(minutes=25)).isoformat(), "label": "Polígono Pilar 2 cambió a critical"},
            {"time": (now - timedelta(minutes=10)).isoformat(), "label": "Comando semáforo rojo ejecutado"},
        ],
    }

@router.get("/traffic-history")
def traffic_history():
    now = utc_now()
    return {
        "items": [
            {
                "requested_at": (now - timedelta(minutes=8)).isoformat(),
                "device": "SEM_AN_01",
                "ip": "10.10.20.11",
                "action": "rojo",
                "status": "success",
                "command": "ipsemaforo 10.10.20.11 rojo",
            },
            {
                "requested_at": (now - timedelta(minutes=35)).isoformat(),
                "device": "SEM_DIA_01",
                "ip": "10.10.20.14",
                "action": "rojo",
                "status": "success",
                "command": "ipsemaforo 10.10.20.14 rojo",
            },
        ]
    }
