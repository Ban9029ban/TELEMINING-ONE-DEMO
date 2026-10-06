from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Iterable

import requests
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.settings import settings

try:
    from app.services.plc_script_runner import PlcScriptRunner
except Exception:  # pragma: no cover
    PlcScriptRunner = None

logger = logging.getLogger(__name__)

DEFAULT_SITE_SEEDS = [
    ("diamante", "Diamante"),
    ("andesita", "Andesita"),
    ("andes_norte", "Andes Norte"),
    ("tunel_correa", "Andes Norte Túnel Correa"),
    ("pilar_norte", "Pilar Norte"),
    ("esmeralda", "Esmeralda"),
]


class SemaforoService:
    def __init__(self, db: Session):
        self.db = db
        self.runner = PlcScriptRunner() if PlcScriptRunner else None
        self.emulator_url = getattr(settings, 'semaforo_emulator_url', None) or getattr(settings, 'SEMAFORO_EMULATOR_URL', None) or 'http://semaforo_emulator_api:8000/api/emulator/semaforo/state'
        self._log_columns_cache: list[str] | None = None

    def _table_exists(self, table_name: str) -> bool:
        value = self.db.execute(text("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = :table_name
            )
        """), {"table_name": table_name}).scalar()
        return bool(value)

    def _table_columns(self, table_name: str) -> list[str]:
        rows = self.db.execute(text("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = :table_name
            ORDER BY ordinal_position
        """), {'table_name': table_name}).fetchall()
        return [str(row[0]) for row in rows]

    def _semaforo_log_columns(self) -> list[str]:
        if self._log_columns_cache is None:
            self._log_columns_cache = self._table_columns('semaforo_action_log') if self._table_exists('semaforo_action_log') else []
        return self._log_columns_cache

    def _normalize_site_code(self, site_code: str | None) -> str | None:
        if not site_code:
            return None
        return str(site_code).strip().lower().replace('-', '_')

    def _normalize_action(self, action: str | None) -> str:
        raw = str(action or 'off').strip().lower()
        mapping = {
            'rojo': 'red', 'red': 'red', 'alerta': 'red', 'emergencia': 'red', 'inferior': 'red', 'superior': 'red',
            'amarillo': 'yellow', 'yellow': 'yellow', 'centro': 'yellow',
            'verde': 'green', 'green': 'green', 'normal': 'green',
            'off': 'off', 'apagado': 'off', 'clear': 'off',
        }
        return mapping.get(raw, raw)

    def _all_enabled_site_codes(self) -> list[str]:
        if not self._table_exists('site'):
            return [item[0] for item in DEFAULT_SITE_SEEDS]
        rows = self.db.execute(text('SELECT code FROM site WHERE COALESCE(is_active, TRUE)=TRUE ORDER BY id')).fetchall()
        return [self._normalize_site_code(row[0]) for row in rows if row[0]]

    def ensure_default_devices(self) -> None:
        if not self._table_exists('site') or not self._table_exists('semaforo_device'):
            return
        sites = self.db.execute(text('SELECT id, code, name FROM site WHERE COALESCE(is_active, TRUE)=TRUE ORDER BY id')).mappings().all()
        for site in sites:
            site_code = self._normalize_site_code(site['code'])
            site_name = site['name']
            device_specs = [
                {
                    'code': f'{site_code}_emulador',
                    'name': f'Semáforo emulador {site_name}',
                    'ip': 'semaforo_emulator_api',
                    'plc_type': 'http_emulator',
                    'profile': 'http_emulator',
                    'port': 8000,
                    'unit_id': 1,
                    'enabled': True,
                    'tags_json': json.dumps({'green_tag': 'M1', 'yellow_tag': 'M8', 'red_tag': 'M2'}),
                },
                {
                    'code': f'{site_code}_plc',
                    'name': f'Semáforo PLC {site_name}',
                    'ip': '192.168.1.10',
                    'plc_type': 'delta',
                    'profile': 'delta',
                    'port': 502,
                    'unit_id': 1,
                    'enabled': True,
                    'tags_json': json.dumps({'green_tag': 'M1', 'yellow_tag': 'M8', 'red_tag': 'M2'}),
                },
            ]
            for spec in device_specs:
                exists = self.db.execute(text('SELECT id FROM semaforo_device WHERE code=:code LIMIT 1'), {'code': spec['code']}).scalar()
                payload = {'site_id': site['id'], **spec}
                if exists:
                    self.db.execute(text('''
                        UPDATE semaforo_device
                        SET site_id=:site_id, name=:name, ip=:ip, plc_type=:plc_type, profile=:profile,
                            port=:port, unit_id=:unit_id, enabled=:enabled, tags_json=CAST(:tags_json AS jsonb)
                        WHERE code=:code
                    '''), payload)
                else:
                    self.db.execute(text('''
                        INSERT INTO semaforo_device (site_id, code, name, ip, plc_type, profile, port, unit_id, enabled, tags_json)
                        VALUES (:site_id, :code, :name, :ip, :plc_type, :profile, :port, :unit_id, :enabled, CAST(:tags_json AS jsonb))
                    '''), payload)
        self.db.commit()

    def list_devices(self, site_code: str | None = None) -> list[dict]:
        self.ensure_default_devices()
        if not self._table_exists('semaforo_device'):
            return []
        normalized = self._normalize_site_code(site_code)
        rows = self.db.execute(text('''
            SELECT s.id AS site_id, s.code AS site_code, s.name AS site_name,
                   d.id, d.code, d.name, d.ip, d.plc_type, d.profile, d.port, d.unit_id, d.enabled,
                   COALESCE(d.tags_json->>'red_tag', 'M2') AS red_tag,
                   COALESCE(d.tags_json->>'yellow_tag', 'M8') AS yellow_tag,
                   COALESCE(d.tags_json->>'green_tag', 'M1') AS green_tag
            FROM semaforo_device d
            JOIN site s ON s.id = d.site_id
            WHERE (:site_code IS NULL OR s.code = :site_code)
              AND COALESCE(d.enabled, TRUE)=TRUE
            ORDER BY s.name, d.name, d.id
        '''), {'site_code': normalized}).mappings().all()
        return [dict(row) for row in rows]

    def get_config(self) -> list[dict]:
        return self.list_devices()

    def _build_plc_expression(self, device: dict[str, Any], normalized_action: str) -> str:
        green_tag = str(device.get('green_tag') or 'M1').upper()
        yellow_tag = str(device.get('yellow_tag') or 'M8').upper()
        red_tag = str(device.get('red_tag') or 'M2').upper()
        if normalized_action == 'red':
            return f'{green_tag}=0,{yellow_tag}=0,{red_tag}=1'
        if normalized_action == 'yellow':
            return f'{green_tag}=0,{yellow_tag}=1,{red_tag}=0'
        if normalized_action == 'green':
            return f'{green_tag}=1,{yellow_tag}=0,{red_tag}=0'
        return f'{green_tag}=0,{yellow_tag}=0,{red_tag}=0'

    def _post_emulator(self, *, state: str, site_code: str | None, device_code: str | None, requested_by: str, reason: str | None) -> dict:
        payload = {
            'state': state,
            'device_code': device_code or 'virtual-semaforo',
            'site_code': site_code or 'virtual',
            'requested_by': requested_by or 'system',
            'reason': reason or '-',
        }
        logger.info('[SEMAFORO EMULADOR] POST %s payload=%s', self.emulator_url, payload)
        response = requests.post(self.emulator_url, json=payload, timeout=5)
        response.raise_for_status()
        data = response.json()
        logger.info('[SEMAFORO EMULADOR] OK status=%s response=%s', response.status_code, data)
        return data

    def _insert_action_log(self, device: dict[str, Any], normalized_action: str, requested_by: str, result: dict[str, Any], reason: str | None, payload_json: dict[str, Any] | None = None) -> None:
        columns = self._semaforo_log_columns()
        if not columns:
            return
        values: dict[str, Any] = {}
        if 'site_id' in columns:
            values['site_id'] = device.get('site_id') or 1
        if 'semaforo_device_id' in columns:
            values['semaforo_device_id'] = device.get('id')
        if 'action' in columns:
            values['action'] = normalized_action
        if 'requested_by' in columns:
            values['requested_by'] = requested_by or 'system'
        if 'execution_status' in columns:
            values['execution_status'] = 'completed' if result.get('ok') else 'error'
        if 'command_line' in columns:
            values['command_line'] = result.get('command')
        if 'stdout' in columns:
            values['stdout'] = result.get('stdout')
        if 'stderr' in columns:
            values['stderr'] = result.get('stderr')
        if 'executed_at' in columns:
            values['executed_at'] = datetime.now(timezone.utc)
        if 'site_code' in columns:
            values['site_code'] = device.get('site_code')
        if 'dry_run' in columns:
            values['dry_run'] = bool(getattr(settings, 'plc_dry_run', False)) if result.get('target') == 'delta' else False
        if 'reason' in columns:
            values['reason'] = reason
        if 'payload_json' in columns:
            values['payload_json'] = json.dumps(payload_json or {})
        cols = ', '.join(values.keys())
        binds = ', '.join(f':{key}' for key in values.keys())
        try:
            self.db.execute(text(f'INSERT INTO semaforo_action_log ({cols}) VALUES ({binds})'), values)
            self.db.commit()
        except Exception as exc:
            logger.warning('[SEMAFORO LOG] No fue posible insertar en semaforo_action_log: %s', exc)
            self.db.rollback()

    def _execute_device(self, device: dict[str, Any], normalized_action: str, requested_by: str, dry_run: bool, reason: str | None) -> dict:
        plc_type = str(device.get('plc_type') or '').strip().lower()
        site_code = self._normalize_site_code(device.get('site_code'))
        device_code = device.get('code')

        if plc_type == 'http_emulator':
            if dry_run:
                result = {'ok': True, 'device_code': device_code, 'site_code': site_code, 'mode': 'dry_run', 'target': 'http_emulator', 'state': normalized_action, 'command': self.emulator_url, 'stdout': 'Emulador dry-run.', 'stderr': ''}
                self._insert_action_log(device, normalized_action, requested_by, result, reason, {'state': normalized_action})
                return result
            try:
                data = self._post_emulator(state=normalized_action, site_code=site_code, device_code=device_code, requested_by=requested_by, reason=reason)
                result = {'ok': True, 'device_code': device_code, 'site_code': site_code, 'target': 'http_emulator', 'state': normalized_action, 'response': data, 'command': self.emulator_url, 'stdout': json.dumps(data), 'stderr': ''}
                self._insert_action_log(device, normalized_action, requested_by, result, reason, {'state': normalized_action, 'response': data})
                return result
            except Exception as exc:
                result = {'ok': False, 'device_code': device_code, 'site_code': site_code, 'target': 'http_emulator', 'state': normalized_action, 'command': self.emulator_url, 'stdout': '', 'stderr': str(exc), 'error': str(exc)}
                logger.exception('[SEMAFORO EMULADOR] ERROR site=%s device=%s', site_code, device_code)
                self._insert_action_log(device, normalized_action, requested_by, result, reason, {'state': normalized_action})
                return result

        if plc_type == 'delta':
            expression = self._build_plc_expression(device, normalized_action)
            logger.info('[SEMAFORO PLC] SEND ip=%s profile=%s expr=%s site=%s device=%s dry_run=%s', device.get('ip'), device.get('profile') or 'delta', expression, site_code, device_code, dry_run)
            if not self.runner:
                result = {'ok': False, 'device_code': device_code, 'site_code': site_code, 'target': 'delta', 'state': normalized_action, 'command': '', 'stdout': '', 'stderr': 'PlcScriptRunner no disponible en backend.', 'error': 'PlcScriptRunner no disponible en backend.'}
                self._insert_action_log(device, normalized_action, requested_by, result, reason, {'expression': expression})
                return result
            if dry_run:
                result = {'ok': True, 'device_code': device_code, 'site_code': site_code, 'mode': 'dry_run', 'target': 'delta', 'expression': expression, 'state': normalized_action, 'command': expression, 'stdout': 'PLC dry-run enabled.', 'stderr': ''}
                self._insert_action_log(device, normalized_action, requested_by, result, reason, {'expression': expression})
                return result
            result = self.runner.run_write(
                ip=device.get('ip') or '192.168.1.10',
                plc_type=device.get('profile') or 'delta',
                write_expression=expression,
                port=int(device.get('port') or 502),
                unit_id=int(device.get('unit_id') or 1),
            )
            payload = {'expression': expression, 'ip': device.get('ip'), 'port': int(device.get('port') or 502), 'unit_id': int(device.get('unit_id') or 1), 'results': result.get('results', [])}
            out = {
                'ok': bool(result.get('ok')),
                'device_code': device_code,
                'site_code': site_code,
                'target': 'delta',
                'state': normalized_action,
                'expression': expression,
                'command': result.get('command', ''),
                'stdout': result.get('stdout', ''),
                'stderr': result.get('stderr', ''),
                'error_kind': result.get('error_kind'),
                'response': result,
            }
            if out['ok']:
                logger.info('[SEMAFORO PLC] OK ip=%s command=%s stdout=%s', device.get('ip'), out['command'], out['stdout'])
            else:
                logger.error('[SEMAFORO PLC] ERROR ip=%s command=%s stderr=%s', device.get('ip'), out['command'], out['stderr'])
            self._insert_action_log(device, normalized_action, requested_by, out, reason, payload)
            return out

        result = {'ok': False, 'device_code': device_code, 'site_code': site_code, 'state': normalized_action, 'command': '', 'stdout': '', 'stderr': f'Tipo de dispositivo no soportado: {plc_type}', 'error': f'Tipo de dispositivo no soportado: {plc_type}'}
        self._insert_action_log(device, normalized_action, requested_by, result, reason, None)
        return result


    def post_emulator_state(self, *, state: str, site_code: str | None, device_code: str | None, requested_by: str, reason: str | None, dry_run: bool = False) -> dict:
        normalized_state = self._normalize_action(state)
        if dry_run:
            return {
                'ok': True,
                'target': 'http_emulator',
                'state': normalized_state,
                'command': self.emulator_url,
                'stdout': 'Emulador dry-run.',
                'stderr': '',
            }
        try:
            data = self._post_emulator(state=normalized_state, site_code=site_code, device_code=device_code, requested_by=requested_by, reason=reason)
            return {'ok': True, 'target': 'http_emulator', 'state': normalized_state, 'response': data, 'command': self.emulator_url, 'stdout': json.dumps(data), 'stderr': ''}
        except Exception as exc:
            logger.exception('[SEMAFORO EMULADOR] ERROR site=%s device=%s', site_code, device_code)
            return {'ok': False, 'target': 'http_emulator', 'state': normalized_state, 'command': self.emulator_url, 'stdout': '', 'stderr': str(exc), 'error': str(exc)}

    def execute_signal_expression(self, *, device: dict[str, Any], expression: str, requested_by: str = 'api', dry_run: bool = False, reason: str | None = None, action_label: str | None = None) -> dict:
        plc_type = str(device.get('plc_type') or '').strip().lower()
        site_code = self._normalize_site_code(device.get('site_code'))
        if plc_type == 'http_emulator':
            return self.post_emulator_state(state=action_label or 'off', site_code=site_code, device_code=device.get('code'), requested_by=requested_by, reason=reason, dry_run=dry_run)
        if plc_type != 'delta':
            result = {'ok': False, 'command': expression, 'stdout': '', 'stderr': f'Tipo de dispositivo no soportado: {plc_type}', 'error_kind': 'unsupported_type'}
            self._insert_action_log(device, action_label or 'custom', requested_by, result, reason, {'expression': expression})
            return result
        logger.info('[PLC] SEND ip=%s expr=%s', device.get('ip'), expression)
        if not self.runner:
            result = {'ok': False, 'command': expression, 'stdout': '', 'stderr': 'PlcScriptRunner no disponible en backend.', 'error_kind': 'runner_not_available'}
            self._insert_action_log(device, action_label or 'custom', requested_by, result, reason, {'expression': expression})
            return result
        if dry_run:
            result = {'ok': True, 'mode': 'dry_run', 'command': expression, 'stdout': 'PLC dry-run enabled.', 'stderr': ''}
            self._insert_action_log(device, action_label or 'custom', requested_by, result, reason, {'expression': expression})
            return result
        raw = self.runner.run_write(
            ip=device.get('ip') or '192.168.1.10',
            plc_type=device.get('profile') or 'delta',
            write_expression=expression,
            port=int(device.get('port') or 502),
            unit_id=int(device.get('unit_id') or 1),
        )
        result = {
            'ok': bool(raw.get('ok')),
            'command': raw.get('command', expression),
            'stdout': raw.get('stdout', ''),
            'stderr': raw.get('stderr', ''),
            'error_kind': raw.get('error_kind'),
            'response': raw,
        }
        self._insert_action_log(device, action_label or 'custom', requested_by, result, reason, {'expression': expression, 'results': raw.get('results', [])})
        return result

    def execute(self, site_code: str | None = None, action: str = 'rojo', requested_by: str = 'api', dry_run: bool = False, reason: str | None = None, device_code: str | None = None) -> dict:
        self.ensure_default_devices()
        normalized_action = self._normalize_action(action)
        normalized_site = self._normalize_site_code(site_code)
        logger.info('[SEMAFORO] execute site=%s action=%s requested_by=%s reason=%s', normalized_site, normalized_action, requested_by, reason)
        devices = self.list_devices(site_code=normalized_site)
        if device_code:
            devices = [item for item in devices if item.get('code') == device_code]
        if not devices:
            if normalized_action in {'red', 'yellow', 'green', 'off'}:
                try:
                    emulator_data = self._post_emulator(state=normalized_action, site_code=normalized_site, device_code=device_code, requested_by=requested_by, reason=reason)
                    return {'ok': True, 'site_code': normalized_site, 'action': normalized_action, 'results': [{'ok': True, 'target': 'http_emulator', 'response': emulator_data}]}
                except Exception as exc:
                    return {'ok': False, 'site_code': normalized_site, 'action': normalized_action, 'error': str(exc)}
            return {'ok': False, 'site_code': normalized_site, 'action': normalized_action, 'error': 'No hay dispositivos'}
        results = [self._execute_device(device=item, normalized_action=normalized_action, requested_by=requested_by, dry_run=dry_run, reason=reason) for item in devices]
        return {'ok': all(item.get('ok', False) for item in results), 'site_code': normalized_site, 'action': normalized_action, 'results': results}

    def execute_all_sites(self, site_codes: Iterable[str] | None = None, action: str = 'rojo', requested_by: str = 'api', dry_run: bool = False, reason: str | None = None) -> dict:
        codes = [self._normalize_site_code(code) for code in (site_codes or []) if self._normalize_site_code(code)]
        if not codes:
            codes = self._all_enabled_site_codes()
        results = [self.execute(site_code=code, action=action, requested_by=requested_by, dry_run=dry_run, reason=reason) for code in codes]
        return {'ok': all(item.get('ok', False) for item in results), 'site_codes': codes, 'action': self._normalize_action(action), 'results': results}

    def execute_global_emergency(self, requested_by: str = 'api', dry_run: bool = False) -> dict:
        return self.execute_all_sites(action='rojo', requested_by=requested_by, dry_run=dry_run, reason='global_emergency')

    def evaluate_from_rules(self, site=None, run=None) -> list[dict]:
        return []


__all__ = ['SemaforoService']
