# app/routers/control.py
from fastapi import APIRouter, Query, Depends
from app.deps.auth import get_current_user
from typing import List
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.db.db import get_db

router = APIRouter(
    # NO incluir settings.api_prefix aquí.
    # El prefijo /api se aplica en app/main.py con include_router(..., prefix=settings.api_prefix)
    # Si lo ponemos acá, queda /api/api/control/... (duplicado).
    prefix="/control",
    tags=["control / Search"],
)

# ----- VISUAL -----
@router.get("/visual/buscar-nodo")
async def buscar_nodo(q: str = Query(default="")):
    # Respuesta mockeada
    data = [
        {"nodo_id": 101, "nombre": "UCL-A1", "lat": -30.123, "lng": -71.234},
        {"nodo_id": 102, "nombre": "UCL-B2", "lat": -30.124, "lng": -71.236},
    ]
    if q:
        data = [d for d in data if q.lower() in d["nombre"].lower()]
    return {"items": data, "count": len(data)}

@router.get("/visual/actualizar-variables-ur")
async def actualizar_variables_ur():
    # Punto de compatibilidad para el front
    return {"ok": True, "updated": ["UR-01", "UR-02", "UR-03"]}

# ----- GRAPHICS -----
@router.get("/graphics/vehicle-stats")
async def graphics_vehicle_stats():
    return {
        "series": [
            {"name": "Ingresos", "values": [10, 12, 9, 15, 18]},
            {"name": "Salidas",  "values": [8, 11, 7, 13, 16]},
        ],
        "labels": ["08:00","10:00","12:00","14:00","16:00"]
    }

@router.get("/graphics/people-stats")
async def graphics_people_stats():
    return {
        "current": 57,
        "threshold": 120,
        "areas": [
            {"area": "Planta", "personas": 21},
            {"area": "Patio",  "personas": 14},
            {"area": "Túnel",  "personas": 22},
        ]
    }

@router.get("/graphics/zenit-summary")
async def graphics_zenit_summary():
    return {
        "urs_totales": 14,
        "urs_online": 12,
        "urs_offline": 2,
        "alertas_hoy": 3,
        "ult_act": "2025-11-08T12:00:00Z"
    }

# ----- TRANSFERS -----
@router.get("/transfers/new-transfers")
async def transfers_new():
    return {
        "items": [
            {"id": "TR-9001", "desde": "UCL-A1", "hacia": "UCL-B2", "estado": "OK", "ts": "2025-11-08T11:30:00Z"},
            {"id": "TR-9002", "desde": "UCL-B2", "hacia": "UCL-C3", "estado": "OK", "ts": "2025-11-08T11:40:00Z"}
        ],
        "count": 2
    }

# ============================================================
# SEARCH UNIVERSAL PARA HOME TRACKING (ASYNC)
# ============================================================

@router.get("/search")
def search_node(q: str, db = Depends(get_db)):
    """
    Busca persona / vehículo / equipo y devuelve el pórtico donde está actualmente.
    """
    q_like = f"%{q}%"

    # 1) Buscar PERSONAS
    persons = db.execute("""
        SELECT 
            p.id AS person_id,
            p.full_name AS name,
            ta.tag_id,
            ae.extra->>'portico' AS portico_id,
            ap.name AS portico_name
        FROM person p
        JOIN tag_assignment ta ON ta.entity_type='person' AND ta.entity_id = p.id
        LEFT JOIN LATERAL (
            SELECT * FROM access_event ev
            WHERE ev.tag_id = ta.tag_id
            ORDER BY ev.ts_ingested DESC
            LIMIT 1
        ) ae ON TRUE
        LEFT JOIN access_portico ap ON ap.id = (ae.extra->>'portico')::INT
        WHERE p.full_name ILIKE :pattern
        LIMIT 20
    """, {"pattern": q_like}).mappings().all()

    # 2) Buscar VEHÍCULOS
    vehicles = db.execute("""
        SELECT
            v.id AS vehicle_id,
            v.patente AS name,
            ta.tag_id,
            ae.extra->>'portico' AS portico_id,
            ap.name AS portico_name
        FROM vehicles v
        JOIN tag_assignment ta ON ta.entity_type='vehicle' AND ta.entity_id = v.id
        LEFT JOIN LATERAL (
            SELECT * FROM access_event ev
            WHERE ev.tag_id = ta.tag_id
            ORDER BY ev.ts_ingested DESC
            LIMIT 1
        ) ae ON TRUE
        LEFT JOIN access_portico ap ON ap.id = (ae.extra->>'portico')::INT
        WHERE v.patente ILIKE :pattern
        LIMIT 20
    """, {"pattern": q_like}).mappings().all()

    # 3) Unificamos resultados en un solo array:
    result = []

    for r in persons:
        if r["portico_id"]:
            result.append({
                "type": "person",
                "id": r["person_id"],
                "name": r["name"],
                "portico_id": int(r["portico_id"]),
                "portico_name": r["portico_name"]
            })

    for r in vehicles:
        if r["portico_id"]:
            result.append({
                "type": "vehicle",
                "id": r["vehicle_id"],
                "name": r["name"],
                "portico_id": int(r["portico_id"]),
                "portico_name": r["portico_name"]
            })

    return result