from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import json
import os
import re
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.external_source_capture import ExternalSourceCapture
from app.models.map_object import MapObject
from app.models.remote_endpoint import RemoteEndpoint
from app.models.site import Site
from app.models.site_map import SiteMap
from app.models.sismico_runtime import ObjectCurrentState, ObjectStateEvent, SismicoSyncRun
from app.schemas.sismico_contract import (
    EndpointDiagnosticsItem,
    MissingPolygonItem,
    ObjectMappingTraceItem,
    ParserRowItem,
    SismicoDiagnosticsResponse,
    SismicoPollingRunRequest,
    SismicoPollingRunResponse,
)
from app.services.alert_evaluator import AlertEvaluator
from app.services.http_fetcher import HttpFetcher
from app.services.legacy_sync_profiles import LEGACY_SITE_PROFILES, build_alias_map, normalize_text, is_manual_only_object
from app.services.semaforo_service import SemaforoService
from app.services.sismico_service import SismicoService, normalize_site_code
from app.services.source_parsers import parse_payload_detail
from app.services.state_normalizer import normalize_state
from app.core.settings import settings
from app.services.plc_relay_service import PlcRelayService


class PollingService:
    def __init__(self, db: Session):
        self.db = db
        self.fetcher = HttpFetcher()
        self._relay_pending = []

    def run_site_polling(self, request: SismicoPollingRunRequest) -> SismicoPollingRunResponse:
        diagnostics = self.collect_site_diagnostics(
            request.site_code,
            force_endpoint_code=request.force_endpoint_code,
            live_fetch=True,
            persist=True,
            trigger_type="manual",
        )
        return SismicoPollingRunResponse(
            ok=diagnostics.ok,
            site_code=diagnostics.site_code,
            run_id=diagnostics.run_id,
            status=diagnostics.status,
            source_status=diagnostics.source_status,
            external_sources_online=diagnostics.external_sources_online,
            processed_objects=diagnostics.mapped_objects_count,
            started_at=diagnostics.started_at,
            finished_at=diagnostics.finished_at,
            error_message=diagnostics.error_message,
        )

    def collect_site_diagnostics(
        self,
        site_code: str,
        *,
        force_endpoint_code: Optional[str] = None,
        live_fetch: bool = True,
        persist: bool = False,
        trigger_type: str = "diagnostic",
    ) -> SismicoDiagnosticsResponse:
        SismicoService(self.db).ensure_seeded_sites()
        site_code = normalize_site_code(site_code)
        site = self.db.query(Site).filter(Site.code == site_code).first()
        started_at = datetime.now(timezone.utc)
        if not site:
            return SismicoDiagnosticsResponse(
                ok=False,
                site_code=site_code,
                site_name=site_code,
                status="failed",
                source_status="offline",
                external_sources_online=False,
                error_message=f"Site {site_code} no encontrado",
                started_at=started_at,
                finished_at=datetime.now(timezone.utc),
            )

        endpoints = self._select_endpoints(site.id, site.code, force_endpoint_code)
        run = None
        if persist:
            run = SismicoSyncRun(
                site_id=site.id,
                remote_endpoint_id=(endpoints[0].id if len(endpoints) == 1 else None),
                trigger_type=trigger_type,
                status="running",
                source_status="offline",
                records_found=0,
                records_mapped=0,
                started_at=started_at,
            )
            self.db.add(run)
            self.db.flush()

        endpoint_items: List[EndpointDiagnosticsItem] = []
        merged_states: Dict[str, Dict[str, Any]] = {}
        source_status = "offline"
        error_message = None

        for endpoint in endpoints:
            item = self._diagnose_endpoint(site, endpoint, live_fetch=live_fetch)
            endpoint_items.append(item)
            if item.ok:
                if source_status != "online":
                    source_status = item.source_status or "online"
                if item.source_status == "online":
                    source_status = "online"
            elif not error_message and item.error_message:
                error_message = item.error_message
            priority = self._endpoint_priority(site.code, endpoint.code)
            for mapping in item.matches:
                if not mapping.operational_state:
                    continue
                key = normalize_text(mapping.expected_polygon)
                current = merged_states.get(key)
                candidate = {
                    "polygon": mapping.expected_polygon,
                    "operational_state": mapping.operational_state,
                    "endpoint_code": endpoint.code,
                    "endpoint_name": endpoint.name,
                    "priority": priority,
                    "match": mapping,
                }
                if current is None or candidate["priority"] >= current["priority"]:
                    merged_states[key] = candidate

        mapped_objects, missing_polygons, missing_aliases = self._build_mapping_trace(site, merged_states)
        mapped_count = sum(1 for m in mapped_objects if m.mapped)

        if persist and run:
            applied = self._apply_merged_states(site, merged_states, run.id, source_status=source_status)
            alerts_generated = AlertEvaluator(self.db).evaluate_site(site, sync_run_id=run.id)
            semaforo_results = SemaforoService(self.db).evaluate_from_rules(site, run)
            run.status = "completed" if source_status in {"online", "cached"} else "failed"
            run.source_status = source_status
            run.records_found = sum(item.rows_captured for item in endpoint_items)
            run.records_mapped = applied
            run.alerts_generated = alerts_generated + len(semaforo_results)
            run.raw_payload_excerpt = self._build_run_excerpt(endpoint_items)
            run.error_message = None if source_status in {"online", "cached"} else (error_message or "Sin lectura exitosa de endpoints")
            run.finished_at = datetime.now(timezone.utc)
            self.db.commit()
            if settings.PLC_RELAY_ROLE == "receiver":
                for payload in self._relay_pending:
                    PlcRelayService().publish_polygon_state(payload)
            self._relay_pending = []
        finished_at = datetime.now(timezone.utc)

        return SismicoDiagnosticsResponse(
            ok=source_status in {"online", "cached"},
            site_code=site.code,
            site_name=site.name,
            run_id=(run.id if run else None),
            status=("completed" if source_status in {"online", "cached"} else "failed"),
            source_status=source_status,
            external_sources_online=source_status == "online",
            legacy_page=(LEGACY_SITE_PROFILES.get(site.code, {}) or {}).get("legacy_page"),
            legacy_description=(LEGACY_SITE_PROFILES.get(site.code, {}) or {}).get("description", ""),
            started_at=started_at,
            finished_at=(run.finished_at if run else finished_at),
            endpoints=endpoint_items,
            object_mappings=mapped_objects,
            missing_polygons=missing_polygons,
            missing_aliases=missing_aliases,
            rows_total=sum(item.rows_captured for item in endpoint_items),
            mapped_objects_count=mapped_count,
            error_message=(None if source_status in {"online", "cached"} else error_message),
        )

    def _select_endpoints(self, site_id: int, site_code: str, force_endpoint_code: Optional[str] = None) -> List[RemoteEndpoint]:
        query = self.db.query(RemoteEndpoint).filter(RemoteEndpoint.site_id == site_id, RemoteEndpoint.is_enabled == True)
        endpoints = query.order_by(RemoteEndpoint.id.asc()).all()
        if force_endpoint_code:
            return [ep for ep in endpoints if ep.code == force_endpoint_code]
        if not endpoints:
            return []
        priorities = {item["endpoint_code"]: item["priority"] for item in LEGACY_SITE_PROFILES.get(site_code, {}).get("source_strategy", [])}
        return sorted(endpoints, key=lambda ep: (-(priorities.get(ep.code, 0)), ep.id or 0))

    def _endpoint_priority(self, site_code: str, endpoint_code: str) -> int:
        for item in LEGACY_SITE_PROFILES.get(site_code, {}).get("source_strategy", []):
            if item["endpoint_code"] == endpoint_code:
                return int(item.get("priority", 0))
        return 0

    def _diagnose_endpoint(self, site: Site, endpoint: RemoteEndpoint, *, live_fetch: bool) -> EndpointDiagnosticsItem:
        if not live_fetch:
            fallback_result, fallback_error = self._load_fallback_result(site, endpoint)
            if fallback_result:
                return self._build_endpoint_item(site, endpoint, fallback_result, source_status="cached")
            return EndpointDiagnosticsItem(
                endpoint_code=endpoint.code,
                endpoint_name=endpoint.name,
                endpoint_url=endpoint.endpoint_url,
                parser_type=endpoint.parser_type,
                ok=False,
                status="skipped",
                source_status="unknown",
                rows_captured=0,
                matches=[],
                rows=[],
                error_message=fallback_error or "Modo diagnóstico sin fetch habilitado.",
            )

        fetch_result = self.fetcher.fetch(
            endpoint.endpoint_url,
            method="GET",
            timeout_seconds=max(5, endpoint.polling_seconds or 8),
            verify_ssl=False,
        )
        if fetch_result.ok:
            return self._build_endpoint_item(site, endpoint, fetch_result, source_status="online")

        fallback_result, fallback_error = self._load_fallback_result(site, endpoint)
        if fallback_result:
            item = self._build_endpoint_item(site, endpoint, fallback_result, source_status="cached")
            item.error_message = fetch_result.error_message
            return item

        return EndpointDiagnosticsItem(
            endpoint_code=endpoint.code,
            endpoint_name=endpoint.name,
            endpoint_url=endpoint.endpoint_url,
            parser_type=endpoint.parser_type,
            ok=False,
            status="failed",
            source_status="offline",
            rows_captured=0,
            matches=[],
            rows=[],
            error_message=fetch_result.error_message or fallback_error or "fetch_failed",
            payload_excerpt=(fetch_result.body_text or "")[:1000],
        )

    def _build_endpoint_item(self, site: Site, endpoint: RemoteEndpoint, fetch_result, *, source_status: str) -> EndpointDiagnosticsItem:
        body_text = fetch_result.body_text or ""
        if source_status == "cached":
            body_text = self._rewrite_cached_html_assets(endpoint, body_text)
        try:
            parsed = parse_payload_detail(
                endpoint.parser_type,
                body_text,
                fetch_result.content_type,
                endpoint_url=endpoint.endpoint_url,
                endpoint_code=endpoint.code,
                site_code=site.code,
            )
        except Exception as exc:
            return EndpointDiagnosticsItem(
                endpoint_code=endpoint.code,
                endpoint_name=endpoint.name,
                endpoint_url=endpoint.endpoint_url,
                parser_type=endpoint.parser_type,
                ok=False,
                status="failed",
                source_status=source_status,
                rows_captured=0,
                matches=[],
                rows=[],
                payload_excerpt=body_text[:1200],
                error_message=f"parser_error: {exc}",
            )
        return EndpointDiagnosticsItem(
            endpoint_code=endpoint.code,
            endpoint_name=endpoint.name,
            endpoint_url=endpoint.endpoint_url,
            parser_type=endpoint.parser_type,
            ok=True,
            status="completed",
            source_status=source_status,
            rows_captured=parsed.raw_items_count,
            matches=[match.__dict__ for match in parsed.matches],
            rows=[
                ParserRowItem(
                    name=row.name,
                    raw_text=row.raw_text,
                    image_url=row.image_url,
                    detected_state=row.detected_state,
                    source_mode=row.source_mode,
                )
                for row in parsed.rows[:120]
            ],
            payload_excerpt=body_text[:1200],
            error_message=None,
        )

    def _load_fallback_result(self, site: Site, endpoint: RemoteEndpoint):
        fixture_result = self._load_fixture_result(site, endpoint)
        if fixture_result:
            return fixture_result, None

        capture = (
            self.db.query(ExternalSourceCapture)
            .filter(
                ExternalSourceCapture.endpoint_code == endpoint.code,
                ExternalSourceCapture.ok.is_(True),
            )
            .order_by(ExternalSourceCapture.observed_at.desc(), ExternalSourceCapture.id.desc())
            .first()
        )
        if not capture:
            return None, "Sin acceso a red y sin fixture/captura previa para el endpoint."

        body_text = capture.body_text or ""
        if capture.is_binary and capture.body_base64:
            return None, "La última captura disponible es binaria y no es parseable como HTML/JSON."

        class _FallbackResult:
            ok = True
            status_code = capture.http_status or 200
            content_type = capture.content_type or "text/html; charset=utf-8"
            body_text = body_text
            source_origin = "cached_capture"

        return _FallbackResult(), None

    def _load_fixture_result(self, site: Site, endpoint: RemoteEndpoint):
        fixture_root = Path("/app/fixtures/legacy")
        candidates = [
            fixture_root / site.code / f"{endpoint.code}.html",
            fixture_root / site.code / f"{endpoint.code}.json",
            fixture_root / f"{endpoint.code}.html",
            fixture_root / f"{endpoint.code}.json",
        ]
        for candidate in candidates:
            if candidate.exists():
                return self.fetcher.fetch_file(candidate)
        return None

    def _rewrite_cached_html_assets(self, endpoint: RemoteEndpoint, html: str) -> str:
        if not html or "<img" not in html.lower():
            return html
        asset_rows = (
            self.db.query(ExternalSourceCapture)
            .filter(
                ExternalSourceCapture.endpoint_code.like(f"{endpoint.code}__asset_%"),
                ExternalSourceCapture.source_origin == "linked_asset",
            )
            .order_by(ExternalSourceCapture.observed_at.desc(), ExternalSourceCapture.id.desc())
            .all()
        )
        if not asset_rows:
            return html

        backend_base = os.getenv('BACKEND_INTERNAL_BASE_URL', 'http://backend:8000').rstrip('/')
        replacements = [
            f"{backend_base}/api/sismico/capture/emulator/{row.endpoint_code}?source_origin=linked_asset"
            for row in asset_rows
            if row.endpoint_code
        ]
        if not replacements:
            return html

        index = {"value": 0}

        def repl(match):
            pos = index["value"]
            replacement = replacements[pos] if pos < len(replacements) else replacements[-1]
            index["value"] += 1
            return f'src="{replacement}"'

        return re.sub(r"src=['\"]([^'\"]+)['\"]", repl, html, flags=re.IGNORECASE)

    def _build_mapping_trace(self, site: Site, merged_states: Dict[str, Dict[str, Any]]) -> Tuple[List[ObjectMappingTraceItem], List[MissingPolygonItem], List[str]]:
        site_map = self.db.query(SiteMap).filter(SiteMap.site_id == site.id, SiteMap.is_active == True).first()
        objects = (
            self.db.query(MapObject)
            .filter(MapObject.site_map_id == site_map.id if site_map else None, MapObject.is_active == True)
            .order_by(MapObject.name.asc())
            .all()
            if site_map else []
        )
        alias_map = build_alias_map(site.code)
        object_items: List[ObjectMappingTraceItem] = []
        used_keys = set()
        missing_aliases: List[str] = []

        for obj in objects:
            candidates = [normalize_text(obj.name), normalize_text(obj.code)]
            matched = None
            for key in candidates:
                canonical = alias_map.get(key, key)
                if canonical in merged_states:
                    matched = merged_states[canonical]
                    used_keys.add(canonical)
                    break
            if matched is None:
                missing_aliases.append(f"{obj.code} -> {obj.name}")
                object_items.append(
                    ObjectMappingTraceItem(
                        object_code=obj.code,
                        object_name=obj.name,
                        mapped=False,
                        expected_polygon=None,
                        endpoint_code=None,
                        endpoint_name=None,
                        operational_state=None,
                        notes="Sin alias o patrón coincidente con estados legacy capturados.",
                    )
                )
                continue
            match = matched["match"]
            object_items.append(
                ObjectMappingTraceItem(
                    object_code=obj.code,
                    object_name=obj.name,
                    mapped=True,
                    expected_polygon=match.expected_polygon,
                    endpoint_code=matched["endpoint_code"],
                    endpoint_name=matched["endpoint_name"],
                    operational_state=match.operational_state,
                    notes=f"Fila legacy: {match.matched_row_name or 'n/a'} / score={match.score}",
                )
            )

        missing_polygons: List[MissingPolygonItem] = []
        for canonical, info in merged_states.items():
            if canonical in used_keys:
                continue
            match = info["match"]
            missing_polygons.append(
                MissingPolygonItem(
                    polygon_name=match.expected_polygon,
                    endpoint_code=info["endpoint_code"],
                    endpoint_name=info["endpoint_name"],
                    operational_state=match.operational_state,
                    matched_row_name=match.matched_row_name,
                    reason="Parser capturó estado legacy pero no existe alias/mapeo hacia objeto del mapa nuevo.",
                )
            )
        return object_items, missing_polygons, sorted(set(missing_aliases))

    def _apply_merged_states(self, site: Site, merged_states: Dict[str, Dict[str, Any]], sync_run_id: int, *, source_status: str = "online") -> int:
        site_map = self.db.query(SiteMap).filter(SiteMap.site_id == site.id, SiteMap.is_active == True).first()
        if not site_map:
            return 0
        objects = self.db.query(MapObject).filter(MapObject.site_map_id == site_map.id, MapObject.is_active == True).all()
        alias_map = build_alias_map(site.code)
        processed = 0
        matched_object_ids = set()
        for obj in objects:
            if is_manual_only_object(site.code, obj.code):
                continue
            matched = None
            for key in [normalize_text(obj.name), normalize_text(obj.code)]:
                canonical = alias_map.get(key, key)
                if canonical in merged_states:
                    matched = merged_states[canonical]
                    break
            if not matched:
                continue
            matched_object_ids.add(obj.id)
            operational_state = matched["operational_state"]
            state_code = normalize_state(operational_state)
            current = self.db.query(ObjectCurrentState).filter(ObjectCurrentState.map_object_id == obj.id).first()
            if settings.PLC_RELAY_ROLE == "origin" and current and (
                str(current.source_status or "").lower() in {"manual", "mirror"}
                or str(current.source_name or "").startswith("mirror:")
            ):
                continue
            changed = False
            if not current:
                current = ObjectCurrentState(map_object_id=obj.id, site_id=site.id)
                self.db.add(current)
                changed = True
            if current.state_code != state_code or (current.raw_value or "") != (operational_state or ""):
                changed = True
            current.state_code = state_code
            current.raw_value = operational_state
            current.source_name = matched["endpoint_name"]
            current.source_status = source_status
            current.observed_at = datetime.now(timezone.utc)
            obj.state_code = state_code
            if changed and settings.PLC_RELAY_ROLE == "receiver":
                self._relay_pending.append({
                    "site_code": site.code,
                    "map_code": site_map.code,
                    "polygon_code": obj.code,
                    "state_code": state_code,
                    "raw_value": operational_state,
                    "source_name": matched["endpoint_name"],
                    "source_status": source_status,
                    "observed_at": datetime.now(timezone.utc).isoformat(),
                    "requested_by": "polling",
                })
            if changed:
                self.db.add(
                    ObjectStateEvent(
                        map_object_id=obj.id,
                        site_id=site.id,
                        sync_run_id=sync_run_id,
                        state_code=state_code,
                        raw_value=operational_state,
                        source_name=matched["endpoint_name"],
                        observed_at=datetime.now(timezone.utc),
                        metadata_json={
                            "object_code": obj.code,
                            "object_name": obj.name,
                            "expected_polygon": matched["polygon"],
                            "endpoint_code": matched["endpoint_code"],
                            "endpoint_name": matched["endpoint_name"],
                            "score": matched["match"].score,
                            "matched_row_name": matched["match"].matched_row_name,
                            "source_mode": matched["match"].source_mode,
                            "source_status": source_status,
                        },
                    )
                )
            processed += 1

            self.db.execute(
                text(
                    '''
                    UPDATE polygon_control_mode
                    SET mode = 'auto', automatic_data = CAST(:data AS JSONB), updated_at = NOW()
                    WHERE map_object_id = :map_object_id
                    '''
                ),
                {
                    'map_object_id': obj.id,
                    'data': json.dumps({
                        'site_id': site.id,
                        'state_code': state_code,
                        'raw_value': operational_state,
                        'source_name': matched['endpoint_name'],
                        'source_status': source_status,
                        'observed_at': datetime.now(timezone.utc),
                    }, default=str),
                },
            )

        for obj in objects:
            if is_manual_only_object(site.code, obj.code) or obj.id in matched_object_ids:
                continue
            current = self.db.query(ObjectCurrentState).filter(ObjectCurrentState.map_object_id == obj.id).first()
            if current and str(current.source_status or '').lower() not in {'manual', 'mirror'}:
                current.source_status = 'offline'
        return processed

    def _build_run_excerpt(self, endpoint_items: List[EndpointDiagnosticsItem]) -> str:
        lines = []
        for item in endpoint_items:
            lines.append(
                f"[{item.endpoint_code}] status={item.status} rows={item.rows_captured} error={item.error_message or '-'}"
            )
            for match in item.matches[:25]:
                lines.append(
                    f"  - {match.expected_polygon} <= {match.matched_row_name or 'SIN_FILA'} => {match.operational_state or 'NULL'} ({match.source_mode})"
                )
        return "\n".join(lines)[:3000]
