from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.db.deps import get_db
from app.models.alert import AlertEvent

router = APIRouter()

@router.get("/")
def list_alerts(db: Session = Depends(get_db)):
    rows = db.query(AlertEvent).order_by(AlertEvent.id.desc()).all()
    return [{"id": r.id, "title": r.title, "message": r.message, "severity": r.severity, "status": r.status} for r in rows]

@router.post("/trigger")
def trigger_alert(payload: dict, db: Session = Depends(get_db)):
    alert = AlertEvent(
        site_id=payload.get("site_id", 1),
        source_object_id=payload.get("source_object_id"),
        title=payload.get("title", "Alerta manual"),
        message=payload.get("message", "Generada desde API"),
        severity=payload.get("severity", "high"),
        status="open",
        metadata_json=payload.get("metadata", {})
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)
    return {"ok": True, "alert_id": alert.id}
