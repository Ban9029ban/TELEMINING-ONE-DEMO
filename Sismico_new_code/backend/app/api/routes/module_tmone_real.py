from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.db.deps import get_db
from app.schemas.agent import AgentAskRequest, AgentAskResponse, AgentFaqsResponse
from app.services.agent_service import AgentService

router = APIRouter()

def _slug_zone(name: str) -> str:
    value = (name or "").strip().lower()
    repl = {"á":"a","é":"e","í":"i","ó":"o","ú":"u","ñ":"n"," ":"_","-":"_","/":"_"}
    for s, d in repl.items():
        value = value.replace(s, d)
    while "__" in value:
        value = value.replace("__", "_")
    mapping = {
        "andes_norte":"andes","andesita":"andesita","diamante":"diamante","esmeralda":"esmeralda",
        "dacita":"dacita","diablo_regimiento":"diablo","recursos_norte":"recursos","pacifico_superior":"pacifico",
        "tte4_sur":"tte4","reservas_norte":"reservas","pilar_norte":"pilar_N","corbata":"corbata","pipa_norte":"pipa_N",
    }
    return mapping.get(value, value)

@router.get("/agents/faqs", response_model=AgentFaqsResponse)
def get_faqs(db: Session = Depends(get_db)):
    return AgentService(db).list_faqs()

@router.post("/agents/consult", response_model=AgentAskResponse)
def consult(payload: AgentAskRequest, db: Session = Depends(get_db)):
    return AgentService(db).ask(payload)

@router.get("/productivity/summary")
def productivity_summary(db: Session = Depends(get_db)):
    row = db.execute(text("SELECT COALESCE(SUM(event_count),0) events_total, COALESCE(SUM(energy_value),0) energy_total FROM module_productivity_event")).mappings().first()
    return {"events_total": int(row["events_total"] or 0), "energy_total": f'{row["energy_total"]} x10^4 J'}

@router.get("/productivity/seismic-chart")
def seismic_chart(db: Session = Depends(get_db)):
    rows = db.execute(text("SELECT sector_name AS label, event_count AS events, energy_value AS energy FROM module_productivity_event ORDER BY id")).mappings().all()
    return [dict(r) for r in rows]

@router.get("/zones-det/list")
def zones_list(db: Session = Depends(get_db)):
    has_zone_key = db.execute(text("""
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'module_zones_det' AND column_name = 'zone_key'
        )
    """)).scalar()
    if has_zone_key:
        rows = db.execute(text("SELECT id, zone_name, zone_key, sort_order FROM module_zones_det ORDER BY sort_order, id")).mappings().all()
        out = []
        for r in rows:
            item = dict(r)
            item["zone_key"] = item.get("zone_key") or _slug_zone(item.get("zone_name"))
            out.append(item)
        return {"zones": out}
    rows = db.execute(text("SELECT id, zone_name, sort_order FROM module_zones_det ORDER BY sort_order, id")).mappings().all()
    out = []
    for r in rows:
        item = dict(r)
        item["zone_key"] = _slug_zone(item.get("zone_name"))
        out.append(item)
    return {"zones": out}
