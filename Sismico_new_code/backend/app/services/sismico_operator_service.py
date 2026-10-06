
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.control_orchestrator_service import ControlOrchestratorService
from app.services.legacy_sync_profiles import LEGACY_SITE_PROFILES, build_alias_map, normalize_text, is_manual_only_object
from app.services.semaforo_service import SemaforoService
from app.services.sismico_service import normalize_site_code
from app.core.settings import settings
from app.services.plc_relay_service import PlcRelayService


class SismicoOperatorService:
    DIAMANTE_OBJECT_ALIASES = {
        'diamante_pipa': 'diamante_pipa',
        'pipa': 'diamante_pipa',
        'diamante pipa': 'diamante_pipa',
        'diamante-pipa': 'diamante_pipa',
        'diamante_footprint_fw': 'footprint_fw',
        'footprint_fw': 'footprint_fw',
        'footprint fw': 'footprint_fw',
        'footprint-fw': 'footprint_fw',
        'fw': 'footprint_fw',
        'diamante_footprint_hw': 'footprint_hw',
        'footprint_hw': 'footprint_hw',
        'footprint hw': 'footprint_hw',
        'footprint-hw': 'footprint_hw',
        'hw': 'footprint_hw',
        'diamante_bajo_diamante_esmeralda': 'bde',
        'bajo_diamante_esmeralda': 'bde',
        'bajo diamante esmeralda': 'bde',
        'bajo-diamante-esmeralda': 'bde',
        'bajo_diamante': 'bde',
        'bajo diamante': 'bde',
        'bda': 'bde',
        'bde': 'bde',
        'esmeralda': 'bde',
        'adit7475': 'adit_74_75',
        'annortefwvp': 'an_norte_fw',
        'annortehwvp': 'an_norte_hw',
        'ansurhwvp': 'an_sur_hw',
        'bajoandesnorte': 'bajo_footprint_an',
        'cabfwnorte': 'cabecera_fw_norte',
        'cabhwvp': 'cabecera_hw',
        'aniniciocaving': 'inicio_caving',
        'monitoreopostevento': 'monitoreo_post_evento',
        'monitoreoposteventofw': 'monitoreo_post_evento_fw',
        'p4600fw': 'p_4600',
        'posteventofw': 'monitoreo_post_evento_fw',
        'tcoim': 'tc_oim',
    }

    def __init__(self, db: Session):
        self.db = db

    def _normalize(self, value: str | None) -> str:
        return str(value or '').strip().lower().replace('-', '_')

    def _get_site(self, site_code: str) -> dict[str, Any]:
        normalized_site_code = normalize_site_code(site_code)
        row = self.db.execute(
            text(
                '''
                SELECT id, code, name
                FROM site
                     WHERE is_active = TRUE
                        AND (LOWER(code) = :normalized_site_code
                         OR LOWER(REPLACE(code, '-', '_')) = :normalized_site_code)
                     ORDER BY CASE WHEN LOWER(code) = :normalized_site_code THEN 0 ELSE 1 END, id
                LIMIT 1
                '''
            ),
            {'normalized_site_code': normalized_site_code},
        ).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail=f'Sitio no encontrado: {site_code}')
        return dict(row)

    def _canonical_object_code(self, site_code: str, object_code: str) -> str:
        raw = self._normalize(object_code)
        normalized_raw = normalize_text(raw)
        normalized_site_code = normalize_site_code(site_code)
        alias_map_candidates = []
        if normalized_site_code:
            alias_map_candidates.append(build_alias_map(normalized_site_code))
        for profile_site_code in LEGACY_SITE_PROFILES:
            if profile_site_code == normalized_site_code:
                continue
            alias_map_candidates.append(build_alias_map(profile_site_code))
        for alias_map in alias_map_candidates:
            canonical = alias_map.get(normalized_raw)
            if canonical:
                raw = canonical.replace(' ', '_').lower()
                break
        return self.DIAMANTE_OBJECT_ALIASES.get(raw, raw)

    def _candidate_codes(self, site_code: str, object_code: str) -> list[str]:
        canonical = self._canonical_object_code(site_code, object_code)
        candidates: list[str] = []
        for candidate in [
            object_code,
            str(object_code or '').strip(),
            self._normalize(object_code),
            canonical,
            canonical.replace('_', '-'),
            canonical.replace('_', ' '),
        ]:
            val = str(candidate or '').strip()
            if not val:
                continue
            val_norm = self._normalize(val)
            for expanded in [val, val_norm, val_norm.replace('_', '-'), val_norm.replace('-', '_')]:
                if expanded and expanded not in candidates:
                    candidates.append(expanded)
        return candidates

    def _site_virtual_polygon_codes(self, site_code: str) -> set[str]:
        normalized_site_code = normalize_site_code(site_code)
        profile = LEGACY_SITE_PROFILES.get(normalized_site_code, {})
        codes: set[str] = set()
        for polygon in profile.get('polygons', []):
            canonical = normalize_text(polygon.canonical_name).replace(' ', '_').lower()
            if canonical:
                codes.add(canonical)
        return codes

    def _virtual_polygon_context(self, site_id: int, site_code: str, site_name: str, polygon_code: str) -> dict[str, Any]:
        map_row = self.db.execute(
            text(
                '''
                SELECT sm.id, sm.code, sm.name
                FROM site_map sm
                WHERE sm.site_id = :site_id
                ORDER BY CASE WHEN LOWER(sm.code) = 'diamante' THEN 0 ELSE 1 END, sm.id
                LIMIT 1
                '''
            ),
            {'site_id': site_id},
        ).mappings().first()
        map_code = str(map_row['code']) if map_row else 'diamante'
        map_name = str(map_row['name']) if map_row else 'Diamante'
        return {
            'id': None,
            'code': polygon_code,
            'name': polygon_code.replace('_', ' ').title(),
            'map_code': map_code,
            'site_id': site_id,
            'site_code': site_code,
            'site_name': site_name,
            'virtual': True,
        }

    def _get_map_object(self, site_id: int, site_code: str, site_name: str, object_code: str) -> dict[str, Any]:
        candidates = self._candidate_codes(site_code, object_code)
        exact_code = self._canonical_object_code(site_code, object_code)

        row = self.db.execute(
            text(
                '''
                SELECT mo.id, mo.code, mo.name, sm.code AS map_code
                FROM map_object mo
                INNER JOIN site_map sm ON sm.id = mo.site_map_id
                WHERE sm.site_id = :site_id
                                    AND sm.is_active = TRUE
                                    AND mo.is_active = TRUE
                  AND (
                    LOWER(mo.code) = ANY(:candidates)
                    OR LOWER(REPLACE(mo.code, '-', '_')) = ANY(:candidates)
                    OR LOWER(REPLACE(mo.code, '_', '-')) = ANY(:candidates)
                    OR LOWER(mo.name) = ANY(:candidates)
                  )
                ORDER BY CASE WHEN LOWER(REPLACE(mo.code, '-', '_')) = :exact_code THEN 0 ELSE 1 END, mo.id
                LIMIT 1
                '''
            ),
            {'site_id': site_id, 'candidates': candidates, 'exact_code': exact_code},
        ).mappings().first()
        if row:
            payload = dict(row)
            payload['virtual'] = False
            payload['site_id'] = site_id
            payload['site_code'] = site_code
            payload['site_name'] = site_name
            return payload

        cp = self.db.execute(
            text(
                '''
                SELECT cp.id, cp.polygon_code AS code, cp.polygon_name AS name, cp.plane_code AS map_code
                FROM control_polygon cp
                INNER JOIN site_map sm ON sm.id = cp.site_map_id
                WHERE sm.site_id = :site_id
                                    AND sm.is_active = TRUE
                  AND (
                    LOWER(cp.polygon_code) = ANY(:candidates)
                    OR LOWER(REPLACE(cp.polygon_code, '-', '_')) = ANY(:candidates)
                    OR LOWER(REPLACE(cp.polygon_code, '_', '-')) = ANY(:candidates)
                    OR LOWER(cp.polygon_name) = ANY(:candidates)
                  )
                ORDER BY CASE WHEN LOWER(REPLACE(cp.polygon_code, '-', '_')) = :exact_code THEN 0 ELSE 1 END, cp.id
                LIMIT 1
                '''
            ),
            {'site_id': site_id, 'candidates': candidates, 'exact_code': exact_code},
        ).mappings().first()
        if cp:
            payload = dict(cp)
            payload['id'] = None
            payload['virtual'] = True
            payload['site_id'] = site_id
            payload['site_code'] = site_code
            payload['site_name'] = site_name
            return payload

        if exact_code in self._site_virtual_polygon_codes(site_code):
            return self._virtual_polygon_context(site_id, site_code, site_name, exact_code)

        raise HTTPException(status_code=404, detail=f'Objeto no encontrado: {object_code}')

    def set_manual_object_state(
        self,
        site_code: str,
        object_code: str,
        state_code: str,
        requested_by: str = 'operador_local',
        map_code: str | None = None,
        action_type: str = 'state_change',
        dry_run: bool = False,
    ) -> dict[str, Any]:
        normalized_state = self._normalize(state_code)
        normalized_action = self._normalize(action_type)
        site = self._get_site(site_code)
        resolved_site_code = normalize_site_code(site['code'])
        canonical_object_code = self._canonical_object_code(resolved_site_code, object_code)
        if normalized_action == 'reset':
            allowed_states = {'reset'}
        elif normalized_action == 'emergency':
            allowed_states = {'emergency', 'emergencia', 'rojo', 'alerta'}
        else:
            allowed_states = {'normal', 'alerta', 'inferior', 'centro', 'superior', 'baja', 'alta', 'verde', 'amarillo', 'rojo'}
        if normalized_state not in allowed_states:
            raise HTTPException(status_code=400, detail='Estado inválido para la operación solicitada.')

        map_object = self._get_map_object(site['id'], resolved_site_code, site['name'], canonical_object_code)
        observed_at = datetime.now(timezone.utc)

        if map_object.get('id'):
            current = self.db.execute(
                text(
                    '''
                    SELECT source_status
                    FROM object_current_state
                    WHERE map_object_id = :map_object_id
                    '''
                ),
                {'map_object_id': map_object['id']},
            ).scalar_one_or_none()
            if str(current or '').lower() == 'online' and not is_manual_only_object(resolved_site_code, canonical_object_code):
                raise HTTPException(
                    status_code=409,
                    detail='El polígono tiene una lectura real vigente; el cambio manual no aplica.',
                )

        if normalized_action == 'emergency':
            effective_state = 'critical'
            semaforo_action = 'rojo'
        elif normalized_action == 'reset':
            effective_state = 'normal'
            semaforo_action = 'verde'
        elif normalized_state in {'alerta', 'superior', 'alta', 'rojo', 'inferior'}:
            effective_state = 'critical'
            semaforo_action = 'rojo'
        elif normalized_state in {'amarillo'}:
            effective_state = 'warning'
            semaforo_action = 'amarillo'
        else:
            effective_state = 'normal'
            semaforo_action = 'verde'

        if map_object.get('id'):
            self.db.execute(
                text(
                    '''
                    INSERT INTO object_current_state
                        (map_object_id, site_id, state_code, raw_value, source_name, source_status, observed_at, updated_at)
                    VALUES
                        (:map_object_id, :site_id, :state_code, :raw_value, :source_name, :source_status, :observed_at, NOW())
                    ON CONFLICT (map_object_id)
                    DO UPDATE SET
                        site_id = EXCLUDED.site_id,
                        state_code = EXCLUDED.state_code,
                        raw_value = EXCLUDED.raw_value,
                        source_name = EXCLUDED.source_name,
                        source_status = EXCLUDED.source_status,
                        observed_at = EXCLUDED.observed_at,
                        updated_at = NOW()
                    '''
                ),
                {
                    'map_object_id': map_object['id'],
                    'site_id': site['id'],
                    'state_code': effective_state,
                    'raw_value': normalized_state,
                    'source_name': requested_by,
                    'source_status': 'manual',
                    'observed_at': observed_at,
                },
            )
            self.db.execute(
                text('UPDATE map_object SET state_code = :state_code WHERE id = :id'),
                {'state_code': effective_state, 'id': map_object['id']},
            )
            self.db.commit()

        orchestrator = ControlOrchestratorService(self.db)
        polygon_code = str(map_object['code'])
        try:
            if normalized_action == 'emergency':
                semaforo_result = orchestrator.apply_emergency(
                    site_code=resolved_site_code,
                    polygon_code=polygon_code,
                    requested_by=requested_by,
                    dry_run=dry_run,
                )
            elif normalized_action == 'reset' or normalized_state == 'reset':
                semaforo_result = orchestrator.apply_reset(
                    site_code=resolved_site_code,
                    polygon_code=polygon_code,
                    requested_by=requested_by,
                    dry_run=dry_run,
                )
            else:
                semaforo_result = orchestrator.apply_polygon_state(
                    site_code=resolved_site_code,
                    polygon_code=polygon_code,
                    target_state=normalized_state,
                    requested_by=requested_by,
                    dry_run=dry_run,
                )
        except HTTPException:
            semaforo_result = SemaforoService(self.db).execute(
                site_code=resolved_site_code,
                action=semaforo_action,
                requested_by=requested_by,
                dry_run=dry_run,
                reason=f'fallback::{normalized_action}',
            )

        state_sync = None
        if settings.PLC_RELAY_ROLE == "receiver" and not dry_run and not str(requested_by or "").startswith("relay:"):
            state_sync = PlcRelayService().publish_polygon_state({
                "site_code": resolved_site_code,
                "map_code": map_code or map_object.get("map_code"),
                "polygon_code": polygon_code,
                "state_code": effective_state,
                "raw_value": normalized_state,
                "source_name": requested_by,
                "source_status": "manual",
                "observed_at": observed_at.isoformat(),
                "requested_by": requested_by,
            })

        return {
            'siteCode': resolved_site_code,
            'mapCode': map_code or map_object.get('map_code'),
            'objectCode': polygon_code,
            'polygonCode': polygon_code,
            'stateCode': normalized_state,
            'targetState': normalized_state,
            'effectiveStateCode': effective_state,
            'semaforoAction': semaforo_action,
            'semaforoResult': semaforo_result,
            'updatedAt': observed_at.isoformat(),
            'requestedBy': requested_by,
            'actionType': normalized_action,
            'virtualObject': bool(map_object.get('virtual')),
            'stateSync': state_sync,
        }
