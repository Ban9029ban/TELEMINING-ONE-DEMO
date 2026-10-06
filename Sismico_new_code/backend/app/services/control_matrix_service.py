from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


class ControlMatrixService:
    DEVICE_SPECS = [
        {
            'code': 'diamante_cd1_tablero_1',
            'name': 'PLC CD1 Tablero 1',
            'ip': '192.168.1.10',
            'port': 502,
            'unit_id': 1,
            'plc_type': 'delta',
            'profile': 'delta',
            'tags_json': {
                'hmi_ip': '192.168.1.20',
                'field_ip': '192.168.1.10',
                'test_ip': '192.168.1.11',
                'mirror_group': 'diamante_cd1_mirror',
            },
        },
        {
            'code': 'diamante_cd1_tablero_2',
            'name': 'PLC CD1 Tablero 2',
            'ip': '192.168.1.30',
            'port': 502,
            'unit_id': 1,
            'plc_type': 'delta',
            'profile': 'delta',
            'tags_json': {
                'hmi_ip': '192.168.1.40',
                'field_ip': '192.168.1.30',
                'test_ip': '192.168.1.12',
                'mirror_group': 'diamante_cd1_mirror',
            },
        },
    ]

    POLYGON_ALIASES = {
        'diamante_pipa': 'diamante_pipa',
        'pipa': 'diamante_pipa',
        'diamante pipa': 'diamante_pipa',
        'diamante_footprint_hw': 'diamante_footprint_hw',
        'footprint_hw': 'diamante_footprint_hw',
        'footprint hw': 'diamante_footprint_hw',
        'hw': 'diamante_footprint_hw',
        'diamante_footprint_fw': 'diamante_footprint_fw',
        'footprint_fw': 'diamante_footprint_fw',
        'footprint fw': 'diamante_footprint_fw',
        'fw': 'diamante_footprint_fw',
        'diamante_bajo_diamante_esmeralda': 'diamante_bajo_diamante_esmeralda',
        'bajo_diamante_esmeralda': 'diamante_bajo_diamante_esmeralda',
        'bajo diamante esmeralda': 'diamante_bajo_diamante_esmeralda',
        'bde': 'diamante_bajo_diamante_esmeralda',
        'bda': 'diamante_bajo_diamante_esmeralda',
    }

    POLYGON_STATES = {
        'diamante_pipa': {
            'normal': {'on': ['M1'], 'off': ['M2'], 'emu': 'green'},
            'alerta': {'on': ['M2'], 'off': ['M1'], 'emu': 'red'},
        },
        'diamante_footprint_fw': {
            'normal': {'on': ['M3'], 'off': ['M4'], 'emu': 'green'},
            'alerta': {'on': ['M4'], 'off': ['M3'], 'emu': 'red'},
        },
        'diamante_footprint_hw': {
            'normal': {'on': ['M5'], 'off': ['M6'], 'emu': 'green'},
            'alerta': {'on': ['M6'], 'off': ['M5'], 'emu': 'red'},
        },
        'diamante_bajo_diamante_esmeralda': {
            'inferior': {'on': ['M7'], 'off': ['M8', 'M9'], 'emu': 'red'},
            'centro': {'on': ['M8'], 'off': ['M7', 'M9'], 'emu': 'green'},
            'superior': {'on': ['M9'], 'off': ['M7', 'M8'], 'emu': 'red'},
        },
    }

    SITE_POLYGONS = [
        'diamante_pipa',
        'diamante_footprint_fw',
        'diamante_footprint_hw',
        'diamante_bajo_diamante_esmeralda',
    ]

    def __init__(self, db: Session):
        self.db = db

    def _normalize(self, value: str | None) -> str:
        return str(value or '').strip().lower().replace('-', '_')

    def _site(self, site_code: str) -> dict[str, Any] | None:
        row = self.db.execute(text('SELECT id, code, name FROM site WHERE LOWER(code)=:code LIMIT 1'), {'code': self._normalize(site_code)}).mappings().first()
        return dict(row) if row else None

    def _canonical_polygon_code(self, polygon_code: str | None) -> str:
        normalized = self._normalize(polygon_code)
        return self.POLYGON_ALIASES.get(normalized, normalized)

    def _device_ids(self) -> dict[str, int]:
        rows = self.db.execute(text("SELECT id, code FROM semaforo_device WHERE code IN ('diamante_cd1_tablero_1','diamante_cd1_tablero_2')")).mappings().all()
        return {str(r['code']): int(r['id']) for r in rows}

    def ensure_default_configuration(self) -> None:
        site = self._site('diamante')
        if not site:
            return
        for spec in self.DEVICE_SPECS:
            row = self.db.execute(text('SELECT id FROM semaforo_device WHERE code=:code LIMIT 1'), {'code': spec['code']}).scalar()
            payload = {
                'site_id': site['id'],
                'code': spec['code'],
                'name': spec['name'],
                'ip': spec['ip'],
                'plc_type': spec['plc_type'],
                'profile': spec['profile'],
                'port': spec['port'],
                'unit_id': spec['unit_id'],
                'enabled': True,
                'tags_json': json.dumps(spec['tags_json']),
            }
            if row:
                self.db.execute(text("""
                    UPDATE semaforo_device
                    SET site_id=:site_id, name=:name, ip=:ip, plc_type=:plc_type, profile=:profile,
                        port=:port, unit_id=:unit_id, enabled=:enabled, tags_json=CAST(:tags_json AS jsonb)
                    WHERE id=:id
                """), {**payload, 'id': row})
            else:
                self.db.execute(text("""
                    INSERT INTO semaforo_device (site_id, code, name, ip, plc_type, profile, port, unit_id, enabled, tags_json)
                    VALUES (:site_id, :code, :name, :ip, :plc_type, :profile, :port, :unit_id, :enabled, CAST(:tags_json AS jsonb))
                """), payload)
        self.db.commit()
        logger.info('[CONTROL] Configuración matricial base asegurada para sitio diamante.')

    def get_polygon_context(self, site_code: str, polygon_code: str) -> dict[str, Any]:
        site = self._site(site_code)
        if not site:
            raise HTTPException(status_code=404, detail=f'Sitio no encontrado: {site_code}')
        canonical = self._canonical_polygon_code(polygon_code)
        row = self.db.execute(text("""
            SELECT s.id AS site_id,
                   s.code AS site_code,
                   s.name AS site_name,
                   sm.id AS site_map_id,
                   sm.code AS map_code,
                   sm.name AS map_name,
                   mo.id AS map_object_id,
                   mo.code AS polygon_code,
                   mo.name AS polygon_name
            FROM site s
            JOIN site_map sm ON sm.site_id = s.id
            JOIN map_object mo ON mo.site_map_id = sm.id
            WHERE s.id = :site_id AND LOWER(mo.code) = :polygon_code
            LIMIT 1
        """), {'site_id': site['id'], 'polygon_code': canonical}).mappings().first()
        if row:
            return dict(row)
        # fallback synthetic context if map_object missing but config exists
        if canonical in self.POLYGON_STATES:
            return {
                'site_id': site['id'], 'site_code': site['code'], 'site_name': site['name'],
                'site_map_id': None, 'map_code': 'diamante', 'map_name': 'Diamante',
                'map_object_id': None, 'polygon_code': canonical, 'polygon_name': canonical.replace('_', ' ').title(),
            }
        raise HTTPException(status_code=404, detail=f'Polígono no encontrado: {polygon_code}')

    def _actions_for(self, polygon_code: str, target_state: str) -> tuple[list[dict[str, Any]], str]:
        device_ids = self._device_ids()
        if len(device_ids) < 2:
            self.ensure_default_configuration()
            device_ids = self._device_ids()
        canonical = self._canonical_polygon_code(polygon_code)
        state_key = self._normalize(target_state)
        state_map = self.POLYGON_STATES.get(canonical, {})
        if state_key not in state_map:
            raise HTTPException(status_code=404, detail=f'Estado no configurado para {canonical}: {target_state}')
        cfg = state_map[state_key]
        device_rows = self.db.execute(text("""
            SELECT id, code, name, ip, port, unit_id, profile, plc_type
            FROM semaforo_device
            WHERE code IN ('diamante_cd1_tablero_1','diamante_cd1_tablero_2') AND COALESCE(enabled, TRUE)=TRUE
            ORDER BY code
        """)).mappings().all()
        actions: list[dict[str, Any]] = []
        order = 1
        for dev in device_rows:
            for sig in cfg['on']:
                actions.append({
                    'device_id': int(dev['id']), 'device_code': dev['code'], 'device_name': dev['name'],
                    'device_ip': dev['ip'], 'port': int(dev['port'] or 502), 'unit_id': int(dev['unit_id'] or 1),
                    'profile': dev['profile'] or 'delta', 'plc_type': dev['plc_type'] or 'delta',
                    'signal_code': sig, 'signal_value': 1, 'action_mode': 'write', 'pulse_ms': None,
                    'execution_order': order, 'exclusive_group': canonical, 'source': 'matrix',
                })
                order += 1
            for sig in cfg['off']:
                actions.append({
                    'device_id': int(dev['id']), 'device_code': dev['code'], 'device_name': dev['name'],
                    'device_ip': dev['ip'], 'port': int(dev['port'] or 502), 'unit_id': int(dev['unit_id'] or 1),
                    'profile': dev['profile'] or 'delta', 'plc_type': dev['plc_type'] or 'delta',
                    'signal_code': sig, 'signal_value': 0, 'action_mode': 'write', 'pulse_ms': None,
                    'execution_order': order, 'exclusive_group': canonical, 'source': 'exclusive_off',
                })
                order += 1
        return actions, cfg['emu']

    def resolve_polygon_state(self, *, site_code: str, polygon_code: str, target_state: str, requested_by: str = 'system') -> dict[str, Any]:
        self.ensure_default_configuration()
        context = self.get_polygon_context(site_code, polygon_code)
        actions, emulator_state = self._actions_for(context['polygon_code'], target_state)
        return {
            'site': {'id': context['site_id'], 'code': context['site_code'], 'name': context['site_name']},
            'map': {'id': context['site_map_id'], 'code': context['map_code'], 'name': context['map_name']},
            'polygon': {'id': context['map_object_id'], 'code': context['polygon_code'], 'name': context['polygon_name'], 'control_polygon_id': None},
            'target_state': self._normalize(target_state),
            'requested_by': requested_by,
            'emulator_state': emulator_state,
            'actions': actions,
        }

    def list_site_polygons(self, site_code: str) -> list[dict[str, Any]]:
        site = self._site(site_code)
        if not site:
            return []
        rows = []
        for code in self.SITE_POLYGONS:
            try:
                ctx = self.get_polygon_context(site_code, code)
                rows.append({'polygon_code': ctx['polygon_code'], 'control_polygon_id': 1})
            except HTTPException:
                rows.append({'polygon_code': code, 'control_polygon_id': 1})
        return rows

    def list_all_sites(self) -> list[dict[str, Any]]:
        rows = self.db.execute(text('SELECT id, code, name FROM site WHERE COALESCE(is_active, TRUE)=TRUE ORDER BY id')).mappings().all()
        return [dict(r) for r in rows]

    def _dedupe_actions(self, actions: list[dict[str, Any]]) -> list[dict[str, Any]]:
        deduped: dict[tuple[int, str, int], dict[str, Any]] = {}
        for action in sorted(actions, key=lambda item: (item['execution_order'], item['device_id'], item['signal_code'], item['signal_value'])):
            deduped[(action['device_id'], action['signal_code'], action['signal_value'])] = action
        return list(sorted(deduped.values(), key=lambda item: (item['execution_order'], item['device_id'], item['signal_code'])))

    def resolve_site_state(self, *, site_code: str, target_state: str, requested_by: str = 'system') -> dict[str, Any]:
        normalized_target = self._normalize(target_state)
        state_by_polygon = {
            'diamante_pipa': 'alerta' if normalized_target in {'alerta','rojo','red','emergency'} else 'normal',
            'diamante_footprint_fw': 'alerta' if normalized_target in {'alerta','rojo','red','emergency'} else 'normal',
            'diamante_footprint_hw': 'alerta' if normalized_target in {'alerta','rojo','red','emergency'} else 'normal',
            'diamante_bajo_diamante_esmeralda': 'superior' if normalized_target in {'alerta','rojo','red','emergency'} else 'centro',
        }
        all_actions=[]
        emulator_updates=[]
        for polygon_code, state in state_by_polygon.items():
            resolved=self.resolve_polygon_state(site_code=site_code, polygon_code=polygon_code, target_state=state, requested_by=requested_by)
            all_actions.extend(resolved['actions'])
            emulator_updates.append({'polygon_code': polygon_code, 'map_code': 'diamante', 'state': resolved['emulator_state']})
        # site red/green also toggles emergency coil
        dev_rows=self.db.execute(text("SELECT id, code, name, ip, port, unit_id, profile, plc_type FROM semaforo_device WHERE code IN ('diamante_cd1_tablero_1','diamante_cd1_tablero_2') ORDER BY code")).mappings().all()
        m0_value = 1 if normalized_target in {'alerta','rojo','red','emergency'} else 0
        order = 1000
        for dev in dev_rows:
            all_actions.append({'device_id': int(dev['id']), 'device_code': dev['code'], 'device_name': dev['name'], 'device_ip': dev['ip'], 'port': int(dev['port'] or 502), 'unit_id': int(dev['unit_id'] or 1), 'profile': dev['profile'] or 'delta', 'plc_type': dev['plc_type'] or 'delta', 'signal_code': 'M0', 'signal_value': m0_value, 'action_mode': 'write', 'pulse_ms': None, 'execution_order': order, 'exclusive_group': 'emergency', 'source': 'site_state'})
            order += 1
        site=self._site(site_code)
        return {'site': site, 'map': {'id': None, 'code': 'diamante', 'name': 'Diamante'}, 'polygon': {'id': None, 'code': None, 'name': None, 'control_polygon_id': None}, 'target_state': normalized_target, 'requested_by': requested_by, 'emulator_state': 'red' if m0_value else 'green', 'emulator_updates': emulator_updates, 'actions': self._dedupe_actions(all_actions)}

    def resolve_site_clear(self, *, site_code: str, requested_by: str='system') -> dict[str, Any]:
        return self.resolve_site_state(site_code=site_code, target_state='normal', requested_by=requested_by)

    def resolve_emergency(self, *, site_code: str, polygon_code: str | None = None, requested_by: str='system') -> dict[str, Any]:
        site=self._site(site_code)
        if not site:
            raise HTTPException(status_code=404, detail=f'Sitio no encontrado: {site_code}')
        dev_rows=self.db.execute(text("SELECT id, code, name, ip, port, unit_id, profile, plc_type FROM semaforo_device WHERE code IN ('diamante_cd1_tablero_1','diamante_cd1_tablero_2') ORDER BY code")).mappings().all()
        actions=[]
        order=1
        for dev in dev_rows:
            actions.append({'device_id': int(dev['id']), 'device_code': dev['code'], 'device_name': dev['name'], 'device_ip': dev['ip'], 'port': int(dev['port'] or 502), 'unit_id': int(dev['unit_id'] or 1), 'profile': dev['profile'] or 'delta', 'plc_type': dev['plc_type'] or 'delta', 'signal_code': 'M0', 'signal_value': 1, 'action_mode': 'write', 'pulse_ms': None, 'execution_order': order, 'exclusive_group': 'emergency', 'source': 'emergency'})
            order += 1
        return {'site': site, 'map': {'id': None, 'code': 'diamante', 'name': 'Diamante'}, 'polygon': {'id': None, 'code': polygon_code, 'name': None, 'control_polygon_id': None}, 'target_state': 'emergency', 'requested_by': requested_by, 'emulator_state': 'red', 'actions': actions}

    def resolve_global_emergency(self, *, requested_by: str='system') -> dict[str, Any]:
        return self.resolve_emergency(site_code='diamante', requested_by=requested_by)

    def resolve_reset(self, *, site_code: str, polygon_code: str, requested_by: str='system') -> dict[str, Any]:
        canonical = self._canonical_polygon_code(polygon_code)
        reset_state = 'normal' if canonical != 'diamante_bajo_diamante_esmeralda' else 'centro'
        return self.resolve_polygon_state(site_code=site_code, polygon_code=canonical, target_state=reset_state, requested_by=requested_by)
