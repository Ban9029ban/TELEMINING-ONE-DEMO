from __future__ import annotations

import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.control_matrix_service import ControlMatrixService
from app.services.semaforo_service import SemaforoService
from app.core.settings import settings
from app.services.plc_relay_service import PlcRelayService

logger = logging.getLogger(__name__)


class ControlOrchestratorService:
    def __init__(self, db: Session):
        self.db = db
        self.matrix = ControlMatrixService(db)
        self.semaforo = SemaforoService(db)

    def _insert_audit_log(
        self,
        *,
        request_id: str,
        site_id: int | None,
        site_code: str | None,
        plane_code: str | None,
        polygon_code: str | None,
        action_type: str,
        target_state: str | None,
        requested_by: str,
        resolved_payload: dict[str, Any],
    ) -> int:
        audit_id = self.db.execute(text("""
            INSERT INTO control_audit_log
                (request_id, site_id, site_code, plane_code, polygon_code, action_type, target_state,
                 requested_by, status, resolved_payload_json, execution_payload_json, started_at)
            VALUES
                (:request_id, :site_id, :site_code, :plane_code, :polygon_code, :action_type, :target_state,
                 :requested_by, 'pending', CAST(:resolved_payload_json AS jsonb), '{}'::jsonb, :started_at)
            RETURNING id
        """), {
            'request_id': request_id,
            'site_id': site_id,
            'site_code': site_code,
            'plane_code': plane_code,
            'polygon_code': polygon_code,
            'action_type': action_type,
            'target_state': target_state,
            'requested_by': requested_by,
            'resolved_payload_json': json.dumps(resolved_payload),
            'started_at': datetime.now(timezone.utc),
        }).scalar()
        self.db.commit()
        return int(audit_id)

    def _finish_audit(self, audit_id: int, *, status: str, execution_payload: dict[str, Any], error_message: str | None = None) -> None:
        self.db.execute(text("""
            UPDATE control_audit_log
            SET status=:status,
                execution_payload_json=CAST(:execution_payload_json AS jsonb),
                error_message=:error_message,
                finished_at=:finished_at
            WHERE id=:id
        """), {
            'id': audit_id,
            'status': status,
            'execution_payload_json': json.dumps(execution_payload),
            'error_message': error_message,
            'finished_at': datetime.now(timezone.utc),
        })
        self.db.commit()

    def _insert_detail(self, audit_id: int, action: dict[str, Any], result: dict[str, Any]) -> None:
        self.db.execute(text("""
            INSERT INTO control_audit_log_detail
                (audit_log_id, semaforo_device_id, device_ip, signal_code, signal_value, action_mode,
                 pulse_ms, execution_order, status, stdout, stderr)
            VALUES
                (:audit_log_id, :semaforo_device_id, :device_ip, :signal_code, :signal_value, :action_mode,
                 :pulse_ms, :execution_order, :status, :stdout, :stderr)
        """), {
            'audit_log_id': audit_id,
            'semaforo_device_id': action.get('device_id'),
            'device_ip': action.get('device_ip'),
            'signal_code': action.get('signal_code'),
            'signal_value': action.get('signal_value'),
            'action_mode': action.get('action_mode'),
            'pulse_ms': action.get('pulse_ms'),
            'execution_order': action.get('execution_order', 1),
            'status': 'ok' if result.get('ok') else 'error',
            'stdout': result.get('stdout'),
            'stderr': result.get('stderr'),
        })
        self.db.commit()

    def _run_single_action(self, action: dict[str, Any], requested_by: str, dry_run: bool, reason: str) -> dict[str, Any]:
        signal_code = str(action['signal_code']).upper()
        signal_value = int(action['signal_value'])
        expression = f'{signal_code}={signal_value}'
        logger.info('[PLC] SEND ip=%s signal=%s value=%s mode=%s order=%s', action.get('device_ip'), signal_code, signal_value, action.get('action_mode'), action.get('execution_order'))
        result = self.semaforo.execute_signal_expression(
            device={
                'id': action.get('device_id'),
                'site_id': None,
                'site_code': None,
                'code': action.get('device_code'),
                'name': action.get('device_name'),
                'ip': action.get('device_ip'),
                'port': action.get('port'),
                'unit_id': action.get('unit_id'),
                'profile': action.get('profile'),
                'plc_type': action.get('plc_type'),
            },
            expression=expression,
            requested_by=requested_by,
            dry_run=dry_run,
            reason=reason,
            action_label=signal_code,
        )
        if result.get('ok'):
            logger.info('[PLC] OK ip=%s signal=%s', action.get('device_ip'), signal_code)
        else:
            logger.error('[PLC] ERROR ip=%s signal=%s error=%s', action.get('device_ip'), signal_code, result.get('stderr') or result.get('error_kind'))
        if action.get('action_mode') == 'pulse' and signal_value != 0:
            pulse_ms = max(int(action.get('pulse_ms') or 500), 100)
            time.sleep(pulse_ms / 1000.0)
            off_result = self.semaforo.execute_signal_expression(
                device={
                    'id': action.get('device_id'),
                    'site_id': None,
                    'site_code': None,
                    'code': action.get('device_code'),
                    'name': action.get('device_name'),
                    'ip': action.get('device_ip'),
                    'port': action.get('port'),
                    'unit_id': action.get('unit_id'),
                    'profile': action.get('profile'),
                    'plc_type': action.get('plc_type'),
                },
                expression=f'{signal_code}=0',
                requested_by=requested_by,
                dry_run=dry_run,
                reason=f'{reason}_pulse_off',
                action_label=f'{signal_code}_off',
            )
            result = {
                'ok': bool(result.get('ok')) and bool(off_result.get('ok')),
                'stdout': '\n'.join(filter(None, [result.get('stdout'), off_result.get('stdout')])),
                'stderr': '\n'.join(filter(None, [result.get('stderr'), off_result.get('stderr')])),
                'command': ' && '.join(filter(None, [result.get('command'), off_result.get('command')])),
                'response': {'on': result, 'off': off_result},
            }
        return result

    def _execute_resolution(self, resolved: dict[str, Any], *, requested_by: str, dry_run: bool, action_type: str) -> dict[str, Any]:
        request_id = str(uuid.uuid4())
        audit_id = self._insert_audit_log(
            request_id=request_id,
            site_id=resolved.get('site', {}).get('id'),
            site_code=resolved.get('site', {}).get('code'),
            plane_code=resolved.get('map', {}).get('code'),
            polygon_code=resolved.get('polygon', {}).get('code'),
            action_type=action_type,
            target_state=resolved.get('target_state'),
            requested_by=requested_by,
            resolved_payload=resolved,
        )
        emulator_results = []
        if settings.PLC_RELAY_ROLE == "origin" and not dry_run and not str(requested_by or "").startswith("relay:"):
            relay_payload = {
                "request_id": request_id,
                "site_code": resolved.get("site", {}).get("code"),
                "map_code": resolved.get("map", {}).get("code"),
                "polygon_code": resolved.get("polygon", {}).get("code"),
                "action_type": action_type,
                "target_state": resolved.get("target_state"),
                "requested_by": requested_by,
                "resolved": resolved,
            }
            relay_result = PlcRelayService().publish_control_event(relay_payload)
            response = {
                "ok": bool(relay_result.get("ok")),
                "request_id": request_id,
                "site_code": resolved.get("site", {}).get("code"),
                "map_code": resolved.get("map", {}).get("code"),
                "polygon_code": resolved.get("polygon", {}).get("code"),
                "target_state": resolved.get("target_state"),
                "relayed": True,
                "relay_result": relay_result,
                "emulator_results": [],
                "resolved_actions": len(resolved.get("actions", [])),
                "results": [],
            }
            self._finish_audit(audit_id, status="completed" if response["ok"] else "error", execution_payload=response, error_message=None if response["ok"] else str(relay_result.get("error") or "relay_failed"))
            return response
        try:
            emulator_updates = resolved.get('emulator_updates') or []
            if not emulator_updates and resolved.get('emulator_state'):
                emulator_updates = [{
                    'polygon_code': resolved.get('polygon', {}).get('code'),
                    'map_code': resolved.get('map', {}).get('code'),
                    'state': resolved.get('emulator_state'),
                }]
            for update in emulator_updates:
                logger.info('[EMU] SEND polygon=%s state=%s', update.get('polygon_code'), update.get('state'))
                emu_result = self.semaforo.post_emulator_state(
                    state=update.get('state') or resolved.get('emulator_state') or 'off',
                    site_code=resolved.get('site', {}).get('code'),
                    device_code=f"matrix-emulator:{update.get('polygon_code') or 'all'}",
                    requested_by=requested_by,
                    reason=action_type,
                    dry_run=dry_run,
                )
                emulator_results.append({**update, **emu_result})
                if emu_result.get('ok'):
                    logger.info('[EMU] OK polygon=%s', update.get('polygon_code'))
                else:
                    logger.error('[EMU] ERROR polygon=%s error=%s', update.get('polygon_code'), emu_result.get('stderr'))

            action_results = []
            for action in resolved.get('actions', []):
                result = self._run_single_action(action, requested_by=requested_by, dry_run=dry_run, reason=action_type)
                self._insert_detail(audit_id, action, result)
                action_results.append({
                    'device_code': action.get('device_code'),
                    'device_ip': action.get('device_ip'),
                    'signal_code': action.get('signal_code'),
                    'signal_value': action.get('signal_value'),
                    'action_mode': action.get('action_mode'),
                    'pulse_ms': action.get('pulse_ms'),
                    'execution_order': action.get('execution_order'),
                    'ok': bool(result.get('ok')),
                    'stdout': result.get('stdout'),
                    'stderr': result.get('stderr'),
                })
            response = {
                'ok': all(item['ok'] for item in action_results) and all(item.get('ok', True) for item in emulator_results),
                'request_id': request_id,
                'site_code': resolved.get('site', {}).get('code'),
                'map_code': resolved.get('map', {}).get('code'),
                'polygon_code': resolved.get('polygon', {}).get('code'),
                'target_state': resolved.get('target_state'),
                'emulator_results': emulator_results,
                'resolved_actions': len(resolved.get('actions', [])),
                'results': action_results,
            }
            self._finish_audit(audit_id, status='completed' if response['ok'] else 'partial_error', execution_payload=response)
            return response
        except Exception as exc:
            self._finish_audit(audit_id, status='error', execution_payload={'request_id': request_id}, error_message=str(exc))
            raise

    def apply_polygon_state(self, *, site_code: str, polygon_code: str, target_state: str, requested_by: str = 'api', dry_run: bool = False) -> dict[str, Any]:
        resolved = self.matrix.resolve_polygon_state(site_code=site_code, polygon_code=polygon_code, target_state=target_state, requested_by=requested_by)
        return self._execute_resolution(resolved, requested_by=requested_by, dry_run=dry_run, action_type='state_change')

    def apply_reset(self, *, site_code: str, polygon_code: str, requested_by: str = 'api', dry_run: bool = False) -> dict[str, Any]:
        resolved = self.matrix.resolve_reset(site_code=site_code, polygon_code=polygon_code, requested_by=requested_by)
        return self._execute_resolution(resolved, requested_by=requested_by, dry_run=dry_run, action_type='reset')

    def apply_emergency(self, *, site_code: str, polygon_code: str | None = None, requested_by: str = 'api', dry_run: bool = False) -> dict[str, Any]:
        resolved = self.matrix.resolve_emergency(site_code=site_code, polygon_code=polygon_code, requested_by=requested_by)
        return self._execute_resolution(resolved, requested_by=requested_by, dry_run=dry_run, action_type='emergency')

    def apply_site_state(self, *, site_code: str, target_state: str, requested_by: str = 'api', dry_run: bool = False) -> dict[str, Any]:
        resolved = self.matrix.resolve_site_state(site_code=site_code, target_state=target_state, requested_by=requested_by)
        return self._execute_resolution(resolved, requested_by=requested_by, dry_run=dry_run, action_type='site_state')

    def apply_site_clear(self, *, site_code: str, requested_by: str = 'api', dry_run: bool = False) -> dict[str, Any]:
        resolved = self.matrix.resolve_site_clear(site_code=site_code, requested_by=requested_by)
        return self._execute_resolution(resolved, requested_by=requested_by, dry_run=dry_run, action_type='site_clear')

    def apply_global_emergency(self, *, requested_by: str = 'api', dry_run: bool = False) -> dict[str, Any]:
        resolved = self.matrix.resolve_global_emergency(requested_by=requested_by)
        return self._execute_resolution(resolved, requested_by=requested_by, dry_run=dry_run, action_type='global_emergency')
