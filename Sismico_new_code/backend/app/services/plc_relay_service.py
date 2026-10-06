from __future__ import annotations

import logging
import secrets
from datetime import datetime, timezone
from typing import Any

import requests

from app.core.settings import settings

logger = logging.getLogger(__name__)


class PlcRelayService:
    def _targets(self) -> list[str]:
        return [item.strip().rstrip("/") for item in settings.PLC_RELAY_TARGET_URL.split(",") if item.strip()]

    def _post(self, endpoint: str, payload: dict[str, Any]) -> dict[str, Any]:
        if not settings.PLC_RELAY_SHARED_TOKEN:
            return {"ok": False, "error": "relay_token_not_configured"}
        targets = self._targets()
        if not targets:
            return {"ok": False, "error": "relay_target_not_configured"}
        last_error = "relay_unreachable"
        for base_url in targets:
            try:
                response = requests.post(
                    f"{base_url}/api/sismico/relay/{endpoint}",
                    json=payload,
                    headers={"X-PLC-Relay-Token": settings.PLC_RELAY_SHARED_TOKEN},
                    timeout=max(1.0, settings.PLC_RELAY_TIMEOUT_SECONDS),
                )
                response.raise_for_status()
                result = response.json() if response.content else {}
                if isinstance(result, dict) and result.get("ok") is False:
                    return {"ok": False, "target": base_url, "response": result, "error": "remote_control_failed"}
                return {"ok": True, "target": base_url, "response": result}
            except Exception as exc:
                last_error = str(exc)
                logger.warning("PLC relay failed for %s: %s", base_url, exc)
        return {"ok": False, "error": last_error}

    def publish_control_event(self, payload: dict[str, Any]) -> dict[str, Any]:
        if settings.PLC_RELAY_ROLE != "origin":
            return {"ok": False, "error": "relay_role_not_origin"}
        return self._post("control-event", payload)

    def publish_polygon_state(self, payload: dict[str, Any]) -> dict[str, Any]:
        if settings.PLC_RELAY_ROLE != "receiver":
            return {"ok": False, "error": "relay_role_not_receiver"}
        if str(payload.get("requested_by") or "").startswith("relay:"):
            return {"ok": True, "skipped": "relayed_state"}
        return self._post("polygon-state", payload)

    @staticmethod
    def verify_token(token: str | None) -> bool:
        expected = settings.PLC_RELAY_SHARED_TOKEN
        return bool(expected and token and secrets.compare_digest(token, expected))

    def apply_mirrored_state(self, db, payload: dict[str, Any]) -> dict[str, Any]:
        from sqlalchemy import text

        site_code = str(payload.get("site_code") or "").strip().lower()
        polygon_code = str(payload.get("polygon_code") or "").strip()
        if not site_code or not polygon_code:
            return {"ok": False, "error": "site_code_and_polygon_code_required"}
        row = db.execute(text("""
            SELECT s.id AS site_id, mo.id AS object_id, mo.code
            FROM site s
            JOIN site_map sm ON sm.site_id=s.id AND sm.is_active=TRUE
            JOIN map_object mo ON mo.site_map_id=sm.id AND mo.is_active=TRUE
            WHERE LOWER(s.code)=:site_code
              AND (LOWER(mo.code)=LOWER(:polygon_code)
                   OR LOWER(REPLACE(mo.code, '-', '_'))=LOWER(REPLACE(:polygon_code, '-', '_')))
            ORDER BY sm.id, mo.id
            LIMIT 1
        """), {"site_code": site_code, "polygon_code": polygon_code}).mappings().first()
        if not row:
            return {"ok": False, "error": "polygon_not_found"}
        try:
            observed = datetime.fromisoformat(str(payload.get("observed_at")).replace("Z", "+00:00"))
            if observed.tzinfo is None:
                observed = observed.replace(tzinfo=timezone.utc)
        except (TypeError, ValueError):
            observed = datetime.now(timezone.utc)
        state_code = str(payload.get("state_code") or "normal").strip().lower()
        source_name = "mirror:" + str(payload.get("source_name") or payload.get("requested_by") or "relay")
        db.execute(text("""
            INSERT INTO object_current_state
                (map_object_id, site_id, state_code, raw_value, source_name, source_status, observed_at, updated_at)
            VALUES
                (:object_id, :site_id, :state_code, :raw_value, :source_name, 'mirror', :observed_at, NOW())
            ON CONFLICT (map_object_id) DO UPDATE SET
                site_id=EXCLUDED.site_id,
                state_code=EXCLUDED.state_code,
                raw_value=EXCLUDED.raw_value,
                source_name=EXCLUDED.source_name,
                source_status='mirror',
                observed_at=EXCLUDED.observed_at,
                updated_at=NOW()
            WHERE object_current_state.observed_at IS NULL
               OR object_current_state.observed_at <= EXCLUDED.observed_at
        """), {
            "object_id": row["object_id"], "site_id": row["site_id"],
            "state_code": state_code, "raw_value": payload.get("raw_value"),
            "source_name": source_name, "observed_at": observed,
        })
        db.execute(text("UPDATE map_object SET state_code=:state_code WHERE id=:id"), {
            "state_code": state_code, "id": row["object_id"],
        })
        db.commit()
        return {"ok": True, "site_code": site_code, "polygon_code": row["code"], "state_code": state_code}
