from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.alert import AlertEvent
from app.models.sismico_runtime import ObjectCurrentState, SemaforoRule
from app.models.map_object import MapObject
from app.models.site import Site


class AlertEvaluator:
    def __init__(self, db: Session):
        self.db = db

    def evaluate_site(self, site: Site, sync_run_id: int | None = None) -> int:
        rules = self.db.query(SemaforoRule).filter(SemaforoRule.site_id == site.id, SemaforoRule.enabled == True).all()
        generated = 0

        for rule in rules:
            states = (
                self.db.query(ObjectCurrentState, MapObject)
                .join(MapObject, MapObject.id == ObjectCurrentState.map_object_id)
                .filter(ObjectCurrentState.site_id == site.id)
                .all()
            )
            hits = []
            for current, obj in states:
                if current.state_code == rule.target_state_code:
                    hits.append((current, obj))

            if hits:
                existing = (
                    self.db.query(AlertEvent)
                    .filter(AlertEvent.site_id == site.id, AlertEvent.status == "open", AlertEvent.title == rule.name)
                    .first()
                )
                if not existing:
                    alert = AlertEvent(
                        site_id=site.id,
                        source_object_id=hits[0][1].id,
                        title=rule.name,
                        message=f"Regla {rule.code} activada por estado {rule.target_state_code}",
                        severity="high" if rule.target_state_code == "critical" else "medium",
                        status="open",
                        metadata_json={"sync_run_id": sync_run_id, "rule_code": rule.code},
                    )
                    self.db.add(alert)
                    generated += 1
            else:
                open_alerts = (
                    self.db.query(AlertEvent)
                    .filter(AlertEvent.site_id == site.id, AlertEvent.status == "open", AlertEvent.title == rule.name)
                    .all()
                )
                for alert in open_alerts:
                    alert.status = "closed"

        return generated
