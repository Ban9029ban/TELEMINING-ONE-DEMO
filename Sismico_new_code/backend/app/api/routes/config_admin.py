from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.deps import get_db
from app.api.routes.auth import require_admin

router = APIRouter()


def _table_exists(db: Session, table_name: str) -> bool:
    return bool(
        db.execute(
            text(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = :table_name
                )
                """
            ),
            {"table_name": table_name},
        ).scalar()
    )


def _column_exists(db: Session, table_name: str, column_name: str) -> bool:
    return bool(
        db.execute(
            text(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = :table_name
                      AND column_name = :column_name
                )
                """
            ),
            {"table_name": table_name, "column_name": column_name},
        ).scalar()
    )


def _columns(db: Session, table_name: str) -> set[str]:
    if not _table_exists(db, table_name):
        return set()
    rows = db.execute(
        text(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = :table_name
            """
        ),
        {'table_name': table_name},
    ).fetchall()
    return {row[0] for row in rows}


def _next_id(db: Session, table_name: str) -> int:
    sequence_name = db.execute(
        text("SELECT pg_get_serial_sequence(:table_name, 'id')"),
        {'table_name': table_name},
    ).scalar()
    if sequence_name:
        safe_sequence = str(sequence_name).replace("'", "")
        return int(db.execute(text(f"SELECT nextval('{safe_sequence}')")).scalar())
    return int(db.execute(text(f"SELECT COALESCE(MAX(id), 0) + 1 FROM {table_name}" )).scalar() or 1)


def _safe_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {'1', 'true', 'yes', 'on', 'si'}


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _normalize_mac(value: Any) -> str | None:
    raw = str(value or '').strip().lower().replace('-', ':')
    if not raw:
        return None
    parts = [part.zfill(2) for part in raw.split(':') if part.strip()]
    if len(parts) != 6:
        return raw
    return ':'.join(parts)


def _site_slug(value: str | None) -> str:
    return str(value or '').replace('_', '-').strip()

def _json_obj(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not value:
        return {}
    try:
        return json.loads(value) if isinstance(value, str) else dict(value)
    except Exception:
        return {}


def _signal_or_none(value: Any) -> str | None:
    raw = str(value or '').strip()
    if not raw or raw.lower() in {'none', 'sin señal', 'sin_senal', 'sin-senal', 'null', '-'}:
        return None
    return raw.upper()


def _semaforo_tags_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    base = _json_obj(payload.get('tags_json'))
    site_code = str(payload.get('site_code') or '').replace('-', '_') or base.get('site_code')
    plane_code = str(payload.get('plane_code') or payload.get('map_code') or '').strip() or base.get('plane_code')
    polygon_code = str(payload.get('polygon_code') or '').strip() or base.get('polygon_code')
    tags = {
        **base,
        'site_code': site_code,
        'plane_code': plane_code,
        'polygon_code': polygon_code,
        'hmi_ip': str(payload.get('hmi_ip') or base.get('hmi_ip') or '').strip() or None,
        'field_ip': str(payload.get('field_ip') or base.get('field_ip') or '').strip() or None,
        'test_ip': str(payload.get('test_ip') or base.get('test_ip') or '').strip() or None,
        'normal_tag': _signal_or_none(payload.get('normal_tag') or base.get('normal_tag') or base.get('verde_tag')),
        'alert_tag': _signal_or_none(payload.get('alert_tag') or base.get('alert_tag') or base.get('rojo_tag')),
        'inferior_tag': _signal_or_none(payload.get('inferior_tag') or base.get('inferior_tag')),
        'centro_tag': _signal_or_none(payload.get('centro_tag') or base.get('centro_tag')),
        'superior_tag': _signal_or_none(payload.get('superior_tag') or base.get('superior_tag')),
        'emergency_tag': _signal_or_none(payload.get('emergency_tag') or base.get('emergency_tag')),
        'baliza_tag': _signal_or_none(payload.get('baliza_tag') or base.get('baliza_tag')),
    }
    tags['verde_tag'] = tags.get('normal_tag')
    tags['rojo_tag'] = tags.get('alert_tag')
    return tags


def _semaforo_payload(row: dict[str, Any]) -> dict[str, Any]:
    item = dict(row)
    tags = _json_obj(item.get('tags_json'))
    polygon_codes = tags.get('polygon_codes') or []
    if isinstance(polygon_codes, str):
        polygon_codes = [polygon_codes]
    plane_codes = tags.get('plane_codes') or []
    if isinstance(plane_codes, str):
        plane_codes = [plane_codes]
    item.update({
        'site_code': item.get('site_code') or tags.get('site_code') or '',
        'plane_code': tags.get('plane_code') or (', '.join(plane_codes) if plane_codes else item.get('site_code') or ''),
        'polygon_code': tags.get('polygon_code') or (', '.join(polygon_codes) if polygon_codes else item.get('code') or ''),
        'polygon_codes': polygon_codes,
        'plane_codes': plane_codes,
        'mirror_mode': bool(tags.get('mirror_mode')),
        'mirror_group': tags.get('mirror_group'),
        'hmi_ip': tags.get('hmi_ip'),
        'field_ip': tags.get('field_ip'),
        'test_ip': tags.get('test_ip'),
        'normal_tag': tags.get('normal_tag') or tags.get('verde_tag'),
        'alert_tag': tags.get('alert_tag') or tags.get('rojo_tag'),
        'inferior_tag': tags.get('inferior_tag'),
        'centro_tag': tags.get('centro_tag'),
        'superior_tag': tags.get('superior_tag'),
        'emergency_tag': tags.get('emergency_tag'),
        'baliza_tag': tags.get('baliza_tag'),
    })
    lines = [
        f"N:{item.get('normal_tag') or '-'}",
        f"A:{item.get('alert_tag') or '-'}",
        f"I:{item.get('inferior_tag') or '-'}",
        f"C:{item.get('centro_tag') or '-'}",
        f"S:{item.get('superior_tag') or '-'}",
        f"E:{item.get('emergency_tag') or '-'}",
        f"B:{item.get('baliza_tag') or '-'}",
    ]
    signals = tags.get('signals') if isinstance(tags.get('signals'), dict) else {}
    if signals:
        ordered = sorted(signals.keys(), key=lambda value: (len(str(value)), str(value)))
        lines.append('Mapa señales: ' + ', '.join(f"{code}" for code in ordered))
    if item.get('mirror_mode'):
        lines.append('Espejo PLC: sí')
    item['signals_summary'] = '\n'.join(lines)
    return item


def _infer_state_set(state_code: str | None, polygon_name: str | None) -> str:
    text_value = f"{state_code or ''} {polygon_name or ''}".lower()
    if any(token in text_value for token in ['inferior', 'centro', 'superior', 'bajo', 'medio', 'alto']):
        return 'three_level'
    return 'binary_alert'


def _default_options_for(state_set_code: str) -> list[dict[str, Any]]:
    if state_set_code == 'three_level':
        return [
            {'state_code': 'inferior', 'button_label': 'INFERIOR', 'color_hex': '#d68a60', 'sort_order': 1},
            {'state_code': 'centro', 'button_label': 'CENTRO', 'color_hex': '#67c46f', 'sort_order': 2},
            {'state_code': 'superior', 'button_label': 'SUPERIOR', 'color_hex': '#d68a60', 'sort_order': 3},
        ]
    return [
        {'state_code': 'normal', 'button_label': 'NORMAL', 'color_hex': '#67c46f', 'sort_order': 1},
        {'state_code': 'alerta', 'button_label': 'ALERTA', 'color_hex': '#d68a60', 'sort_order': 2},
    ]


def _ensure_system_config_table(db: Session) -> None:
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS system_config (
            id BIGSERIAL PRIMARY KEY,
            key VARCHAR(120) NOT NULL UNIQUE,
            value_text TEXT NULL,
            scope VARCHAR(40) NOT NULL DEFAULT 'global',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))


def _get_system_value(db: Session, key: str, default: Any = None) -> Any:
    if not _table_exists(db, 'system_config'):
        return default
    row = db.execute(text('SELECT value_text FROM system_config WHERE key = :key LIMIT 1'), {'key': key}).mappings().first()
    if not row:
        return default
    return row.get('value_text', default)


def _upsert_system_value(db: Session, key: str, value: Any) -> None:
    _ensure_system_config_table(db)
    db.execute(text("""
        INSERT INTO system_config (key, value_text, scope, updated_at)
        VALUES (:key, :value_text, 'global', NOW())
        ON CONFLICT (key)
        DO UPDATE SET value_text = EXCLUDED.value_text, updated_at = NOW()
    """), {'key': key, 'value_text': None if value is None else str(value)})


def ensure_polygon_configs(db: Session) -> None:
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS polygon_ui_config (
            id BIGSERIAL PRIMARY KEY,
            map_object_id BIGINT NOT NULL UNIQUE REFERENCES map_object(id) ON DELETE CASCADE,
            control_mode VARCHAR(40) NOT NULL DEFAULT 'manual',
            manual_enabled BOOLEAN NOT NULL DEFAULT TRUE,
            automatic_enabled BOOLEAN NOT NULL DEFAULT TRUE,
            state_set_code VARCHAR(40) NOT NULL DEFAULT 'binary_alert',
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))

    db.execute(text("""
        CREATE TABLE IF NOT EXISTS polygon_ui_state_option (
            id BIGSERIAL PRIMARY KEY,
            polygon_ui_config_id BIGINT NOT NULL REFERENCES polygon_ui_config(id) ON DELETE CASCADE,
            state_code VARCHAR(50) NOT NULL,
            button_label VARCHAR(100) NOT NULL,
            button_color VARCHAR(20),
            overlay_color VARCHAR(20),
            overlay_opacity NUMERIC(5,4) NOT NULL DEFAULT 0.35,
            sort_order INTEGER NOT NULL DEFAULT 0,
            is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
            UNIQUE(polygon_ui_config_id, state_code)
        )
    """))

    compat_columns = {
        'color_hex': 'ALTER TABLE polygon_ui_state_option ADD COLUMN color_hex VARCHAR(20) NULL',
        'is_visible': 'ALTER TABLE polygon_ui_state_option ADD COLUMN is_visible BOOLEAN NOT NULL DEFAULT TRUE',
        'config_id': 'ALTER TABLE polygon_ui_state_option ADD COLUMN config_id BIGINT NULL',
        'map_object_id': 'ALTER TABLE polygon_ui_state_option ADD COLUMN map_object_id BIGINT NULL',
    }
    for col, sql in compat_columns.items():
        if not _column_exists(db, 'polygon_ui_state_option', col):
            db.execute(text(sql))

    db.execute(text('UPDATE polygon_ui_state_option SET config_id = polygon_ui_config_id WHERE config_id IS NULL'))
    db.execute(text("""
        UPDATE polygon_ui_state_option pso
        SET map_object_id = cfg.map_object_id
        FROM polygon_ui_config cfg
        WHERE cfg.id = COALESCE(pso.polygon_ui_config_id, pso.config_id)
          AND pso.map_object_id IS NULL
    """))
    db.execute(text("""
        UPDATE polygon_ui_state_option
        SET color_hex = COALESCE(color_hex, button_color, overlay_color)
        WHERE color_hex IS NULL
    """))

    rows = db.execute(text("""
        SELECT mo.id, mo.name, mo.state_code
        FROM map_object mo
        WHERE COALESCE(mo.is_active, TRUE) = TRUE
        ORDER BY mo.id
    """)).mappings().all()

    for row in rows:
        state_set_code = _infer_state_set(row.get('state_code'), row.get('name'))
        cfg = db.execute(text('SELECT id, state_set_code FROM polygon_ui_config WHERE map_object_id = :map_object_id'), {'map_object_id': row['id']}).mappings().first()
        if not cfg:
            db.execute(text("""
                INSERT INTO polygon_ui_config (
                    id, map_object_id, control_mode, manual_enabled, automatic_enabled, state_set_code, is_active, created_at, updated_at
                ) VALUES (
                    :id, :map_object_id, 'manual', TRUE, TRUE, :state_set_code, TRUE, NOW(), NOW()
                )
            """), {'id': _next_id(db, 'polygon_ui_config'), 'map_object_id': row['id'], 'state_set_code': state_set_code})
            cfg = db.execute(text('SELECT id, state_set_code FROM polygon_ui_config WHERE map_object_id = :map_object_id'), {'map_object_id': row['id']}).mappings().first()
        elif (cfg.get('state_set_code') or '') != state_set_code:
            db.execute(text('UPDATE polygon_ui_config SET state_set_code = :state_set_code, updated_at = NOW() WHERE map_object_id = :map_object_id'), {'map_object_id': row['id'], 'state_set_code': state_set_code})

        has_options = db.execute(text('SELECT EXISTS(SELECT 1 FROM polygon_ui_state_option WHERE COALESCE(map_object_id, -1) = :map_object_id OR COALESCE(polygon_ui_config_id, config_id) = :config_id)'), {'map_object_id': row['id'], 'config_id': cfg['id']}).scalar()
        if not has_options:
            for option in _default_options_for(state_set_code):
                db.execute(text("""
                    INSERT INTO polygon_ui_state_option (
                        id, polygon_ui_config_id, config_id, map_object_id,
                        state_code, button_label, button_color, color_hex, sort_order, is_visible, is_enabled
                    ) VALUES (
                        :id, :config_id, :config_id, :map_object_id,
                        :state_code, :button_label, :color_hex, :color_hex, :sort_order, TRUE, TRUE
                    )
                """), {'id': _next_id(db, 'polygon_ui_state_option'), 'config_id': cfg['id'], 'map_object_id': row['id'], **option})
    db.commit()


@router.get('/users')
def list_users(db: Session = Depends(get_db)):
    if _table_exists(db, 'app_user'):
        rows = db.execute(text('SELECT id, username, full_name AS name, email, role_code AS role, is_active FROM app_user ORDER BY id')).mappings().all()
        return [dict(r) for r in rows]
    return []


@router.post('/users', dependencies=[Depends(require_admin)])
def create_user(payload: dict[str, Any], db: Session = Depends(get_db)):
    new_id = _next_id(db, 'app_user')
    db.execute(text("""
        INSERT INTO app_user (id, username, full_name, email, password_hash, role_code, is_active, created_at)
        VALUES (:id, :username, :full_name, :email, :password_hash, :role_code, :is_active, NOW())
    """), {
        'id': new_id,
        'username': payload.get('username'),
        'full_name': payload.get('name') or payload.get('full_name') or payload.get('username'),
        'email': payload.get('email'),
        'password_hash': payload.get('password_hash') or 'admin',
        'role_code': payload.get('role') or payload.get('role_code') or 'viewer',
        'is_active': _safe_bool(payload.get('is_active'), True),
    })
    db.commit()
    return {'ok': True}


@router.put('/users/{item_id}', dependencies=[Depends(require_admin)])
def update_user(item_id: int, payload: dict[str, Any], db: Session = Depends(get_db)):
    db.execute(text("""
        UPDATE app_user
        SET username = :username,
            full_name = :full_name,
            email = :email,
            role_code = :role_code,
            is_active = :is_active
        WHERE id = :id
    """), {
        'id': item_id,
        'username': payload.get('username'),
        'full_name': payload.get('name') or payload.get('full_name') or payload.get('username'),
        'email': payload.get('email'),
        'role_code': payload.get('role') or payload.get('role_code') or 'viewer',
        'is_active': _safe_bool(payload.get('is_active'), True),
    })
    db.commit()
    return {'ok': True}


@router.get('/companies')
def list_companies(db: Session = Depends(get_db)):
    if _table_exists(db, 'organization'):
        rows = db.execute(text('SELECT id, name, code, is_active FROM organization ORDER BY id')).mappings().all()
        return [dict(r) for r in rows]
    return []


@router.post('/companies')
def create_company(payload: dict[str, Any], db: Session = Depends(get_db)):
    db.execute(text("""
        INSERT INTO organization (id, code, name, is_active, created_at)
        VALUES (:id, :code, :name, :is_active, NOW())
    """), {
        'id': _next_id(db, 'organization'),
        'code': payload.get('code'),
        'name': payload.get('name'),
        'is_active': _safe_bool(payload.get('is_active'), True),
    })
    db.commit()
    return {'ok': True}


@router.put('/companies/{item_id}')
def update_company(item_id: int, payload: dict[str, Any], db: Session = Depends(get_db)):
    db.execute(text('UPDATE organization SET code = :code, name = :name, is_active = :is_active WHERE id = :id'), {
        'id': item_id,
        'code': payload.get('code'),
        'name': payload.get('name'),
        'is_active': _safe_bool(payload.get('is_active'), True),
    })
    db.commit()
    return {'ok': True}


@router.get('/semaforos')
def list_semaforos(db: Session = Depends(get_db)):
    if _table_exists(db, 'semaforo_device'):
        rows = db.execute(text("""
            SELECT sd.id, sd.code, sd.name, sd.ip, sd.enabled,
                   sd.port, sd.plc_type, sd.profile, sd.unit_id, sd.tags_json,
                   COALESCE(s.name, sd.code) AS site_name,
                   COALESCE(s.code, '') AS site_code,
                   COALESCE(s.name, '') AS map_name,
                   sd.code AS polygon_button,
                   CASE WHEN sd.enabled THEN 'online' ELSE 'offline' END AS status,
                   30 AS activation_seconds
            FROM semaforo_device sd
            LEFT JOIN site s ON s.id = sd.site_id
            ORDER BY sd.name, sd.id
        """)).mappings().all()
        return [_semaforo_payload(dict(r)) for r in rows]
    return []


@router.post('/semaforos')
def create_semaforo(payload: dict[str, Any], db: Session = Depends(get_db)):
    site_code = (payload.get('site_code') or '').replace('-', '_')
    site_id = db.execute(text('SELECT id FROM site WHERE code = :code LIMIT 1'), {'code': site_code}).scalar()
    if not site_id:
        raise HTTPException(status_code=400, detail='Sitio inválido para semáforo.')
    tags = _semaforo_tags_from_payload(payload)
    db.execute(text("""
        INSERT INTO semaforo_device (site_id, code, name, ip, plc_type, profile, port, unit_id, enabled, tags_json, created_at)
        VALUES (:site_id, :code, :name, :ip, :plc_type, :profile, :port, :unit_id, :enabled,
                CAST(:tags_json AS jsonb), NOW())
    """), {
        'site_id': site_id,
        'code': payload.get('code'),
        'name': payload.get('name'),
        'ip': payload.get('ip'),
        'plc_type': payload.get('plc_type') or 'delta',
        'profile': payload.get('profile') or 'delta',
        'port': _safe_int(payload.get('port'), 502),
        'unit_id': _safe_int(payload.get('unit_id'), 1),
        'enabled': _safe_bool(payload.get('enabled'), True),
        'tags_json': json.dumps(tags),
    })
    db.commit()
    return {'ok': True}


@router.put('/semaforos/{item_id}')
def update_semaforo(item_id: int, payload: dict[str, Any], db: Session = Depends(get_db)):
    current = db.execute(text('SELECT tags_json FROM semaforo_device WHERE id = :id LIMIT 1'), {'id': item_id}).mappings().first()
    merged = dict(payload)
    merged['tags_json'] = current.get('tags_json') if current else {}
    tags = _semaforo_tags_from_payload(merged)
    db.execute(text("""
        UPDATE semaforo_device
        SET code = :code,
            name = :name,
            ip = :ip,
            plc_type = :plc_type,
            profile = :profile,
            port = :port,
            unit_id = :unit_id,
            enabled = :enabled,
            tags_json = CAST(:tags_json AS jsonb)
        WHERE id = :id
    """), {
        'id': item_id,
        'code': payload.get('code'),
        'name': payload.get('name'),
        'ip': payload.get('ip'),
        'plc_type': payload.get('plc_type') or 'delta',
        'profile': payload.get('profile') or 'delta',
        'port': _safe_int(payload.get('port'), 502),
        'unit_id': _safe_int(payload.get('unit_id'), 1),
        'enabled': _safe_bool(payload.get('enabled'), True),
        'tags_json': json.dumps(tags),
    })
    db.commit()
    return {'ok': True}


@router.get('/external-sources')
def list_external_sources(db: Session = Depends(get_db)):
    if _table_exists(db, 'remote_source'):
        rows = db.execute(text("""
            SELECT rs.id, rs.name, rs.code, rs.source_type AS type,
                   CASE WHEN rs.is_active THEN 'online' ELSE 'offline' END AS status,
                   NULL::timestamptz AS last_sync,
                   rs.base_url AS endpoint,
                   rs.is_active
            FROM remote_source rs
            ORDER BY rs.name, rs.id
        """)).mappings().all()
        return [dict(r) for r in rows]
    return []


@router.post('/external-sources')
def create_external_source(payload: dict[str, Any], db: Session = Depends(get_db)):
    site_id = db.execute(text('SELECT id FROM site ORDER BY id LIMIT 1')).scalar()
    db.execute(text("""
        INSERT INTO remote_source (id, site_id, code, name, source_type, base_url, is_active, created_at)
        VALUES (:id, :site_id, :code, :name, :source_type, :base_url, :is_active, NOW())
    """), {
        'id': _next_id(db, 'remote_source'),
        'site_id': site_id,
        'code': payload.get('code'),
        'name': payload.get('name'),
        'source_type': payload.get('type') or 'api_rest',
        'base_url': payload.get('endpoint'),
        'is_active': _safe_bool(payload.get('is_active', True), True),
    })
    db.commit()
    return {'ok': True}


@router.put('/external-sources/{item_id}')
def update_external_source(item_id: int, payload: dict[str, Any], db: Session = Depends(get_db)):
    db.execute(text("""
        UPDATE remote_source
        SET code = :code,
            name = :name,
            source_type = :source_type,
            base_url = :base_url,
            is_active = :is_active
        WHERE id = :id
    """), {
        'id': item_id,
        'code': payload.get('code'),
        'name': payload.get('name'),
        'source_type': payload.get('type') or 'api_rest',
        'base_url': payload.get('endpoint'),
        'is_active': _safe_bool(payload.get('is_active'), True),
    })
    db.commit()
    return {'ok': True}


@router.get('/system')
def get_system_config(db: Session = Depends(get_db)):
    _ensure_system_config_table(db)
    automatic_activation_seconds = _safe_int(_get_system_value(db, 'automatic_activation_seconds', '30'), 30)
    traffic_lights_enabled = _safe_bool(_get_system_value(db, 'traffic_lights_enabled', 'true'), True)
    semaforo_automation_enabled = _safe_bool(_get_system_value(db, 'semaforo_automation_enabled', 'false'), False)
    external_sources_enabled = _safe_bool(_get_system_value(db, 'external_sources_enabled', 'false'), False)
    db.commit()
    return {
        'automatic_activation_seconds': automatic_activation_seconds,
        'traffic_lights_enabled': traffic_lights_enabled,
        'semaforo_automation_enabled': semaforo_automation_enabled,
        'external_sources_enabled': external_sources_enabled,
    }


@router.put('/system')
def update_system_config(payload: dict[str, Any], db: Session = Depends(get_db)):
    _upsert_system_value(db, 'automatic_activation_seconds', _safe_int(payload.get('automatic_activation_seconds'), 30))
    _upsert_system_value(db, 'traffic_lights_enabled', _safe_bool(payload.get('traffic_lights_enabled'), True))
    _upsert_system_value(db, 'semaforo_automation_enabled', _safe_bool(payload.get('semaforo_automation_enabled'), False))
    _upsert_system_value(db, 'external_sources_enabled', _safe_bool(payload.get('external_sources_enabled'), False))
    db.commit()
    return get_system_config(db)


@router.get('/polygon-sites')
def list_polygon_sites(db: Session = Depends(get_db)):
    ensure_polygon_configs(db)
    rows = db.execute(text("""
        SELECT s.id AS site_id,
               s.code AS site_code,
               s.name AS site_name,
               sm.id AS map_id,
               sm.code AS map_code,
               sm.name AS map_name,
               sm.image_url,
               COUNT(mo.id) AS polygon_count
        FROM site s
        JOIN site_map sm ON sm.site_id = s.id
        LEFT JOIN map_object mo ON mo.site_map_id = sm.id AND COALESCE(mo.is_active, TRUE) = TRUE
        WHERE COALESCE(s.is_active, TRUE) = TRUE
          AND COALESCE(sm.is_active, TRUE) = TRUE
        GROUP BY s.id, s.code, s.name, sm.id, sm.code, sm.name, sm.image_url
        ORDER BY s.name, sm.name, sm.id
    """)).mappings().all()

    grouped: dict[str, dict[str, Any]] = {}
    for row in rows:
        site_code = _site_slug(row['site_code'])
        bucket = grouped.setdefault(site_code, {'site_id': row['site_id'], 'site_code': site_code, 'site_name': row['site_name'], 'maps': []})
        bucket['maps'].append({
            'map_id': row['map_id'],
            'map_code': _site_slug(row['map_code']),
            'map_name': row['map_name'],
            'image_url': row['image_url'],
            'polygon_count': _safe_int(row.get('polygon_count'), 0),
        })
    return list(grouped.values())


@router.get('/polygon-maps/{site_code}/{map_code}/polygons')
def get_map_polygons(site_code: str, map_code: str, db: Session = Depends(get_db)):
    ensure_polygon_configs(db)
    normalized_site_code = site_code.replace('-', '_')
    normalized_map_code = map_code.replace('-', '_')

    rows = db.execute(text("""
        SELECT mo.id AS map_object_id,
               mo.code AS polygon_code,
               mo.name AS polygon_name,
               mo.geometry_json,
               mo.state_code AS current_state_code,
               cfg.control_mode,
               cfg.manual_enabled,
               cfg.automatic_enabled,
               cfg.state_set_code,
               cfg.is_active,
               cfg.id AS polygon_ui_config_id,
               ocs.state_code AS runtime_state_code
        FROM map_object mo
        JOIN site_map sm ON sm.id = mo.site_map_id
        JOIN site s ON s.id = sm.site_id
        LEFT JOIN polygon_ui_config cfg ON cfg.map_object_id = mo.id
        LEFT JOIN object_current_state ocs ON ocs.map_object_id = mo.id
        WHERE s.code = :site_code
          AND sm.code = :map_code
          AND COALESCE(mo.is_active, TRUE) = TRUE
        ORDER BY mo.name, mo.id
    """), {'site_code': normalized_site_code, 'map_code': normalized_map_code}).mappings().all()

    result = []
    for row in rows:
        options = db.execute(text("""
            SELECT state_code,
                   COALESCE(button_label, state_code) AS button_label,
                   COALESCE(color_hex, button_color, overlay_color) AS color_hex,
                   sort_order,
                   COALESCE(is_visible, TRUE) AS is_visible,
                   COALESCE(is_enabled, TRUE) AS is_enabled
            FROM polygon_ui_state_option
            WHERE COALESCE(map_object_id, -1) = :map_object_id
               OR COALESCE(polygon_ui_config_id, config_id) = :config_id
            ORDER BY sort_order, id
        """), {'map_object_id': row['map_object_id'], 'config_id': row.get('polygon_ui_config_id')}).mappings().all()
        result.append({
            'map_object_id': row['map_object_id'],
            'polygon_code': row['polygon_code'],
            'polygon_name': row['polygon_name'],
            'geometry_json': row['geometry_json'],
            'current_state_code': row['current_state_code'],
            'runtime_state_code': row['runtime_state_code'],
            'control_mode': row['control_mode'] or 'manual',
            'manual_enabled': _safe_bool(row['manual_enabled'], True),
            'automatic_enabled': _safe_bool(row['automatic_enabled'], True),
            'state_set_code': row['state_set_code'] or _infer_state_set(row['current_state_code'], row['polygon_name']),
            'is_active': _safe_bool(row['is_active'], True),
            'options': [dict(opt) for opt in options],
        })
    return result


@router.put('/polygon-maps/{site_code}/{map_code}/polygons/{map_object_id}')
def update_map_polygon(site_code: str, map_code: str, map_object_id: int, payload: dict[str, Any], db: Session = Depends(get_db)):
    ensure_polygon_configs(db)
    cfg = db.execute(text('SELECT id FROM polygon_ui_config WHERE map_object_id = :map_object_id'), {'map_object_id': map_object_id}).mappings().first()
    if not cfg:
        raise HTTPException(status_code=404, detail='Polígono no encontrado.')

    db.execute(text("""
        UPDATE polygon_ui_config
        SET control_mode = :control_mode,
            manual_enabled = :manual_enabled,
            automatic_enabled = :automatic_enabled,
            state_set_code = :state_set_code,
            is_active = :is_active,
            updated_at = NOW()
        WHERE map_object_id = :map_object_id
    """), {
        'map_object_id': map_object_id,
        'control_mode': str(payload.get('control_mode') or 'manual')[:40],
        'manual_enabled': _safe_bool(payload.get('manual_enabled'), True),
        'automatic_enabled': _safe_bool(payload.get('automatic_enabled'), True),
        'state_set_code': str(payload.get('state_set_code') or 'binary_alert')[:40],
        'is_active': _safe_bool(payload.get('is_active'), True),
    })

    if 'options' in payload and isinstance(payload['options'], list):
        db.execute(text('DELETE FROM polygon_ui_state_option WHERE map_object_id = :map_object_id OR COALESCE(polygon_ui_config_id, config_id) = :config_id'), {'map_object_id': map_object_id, 'config_id': cfg['id']})
        for idx, item in enumerate(payload['options'], start=1):
            db.execute(text("""
                INSERT INTO polygon_ui_state_option (
                    id, polygon_ui_config_id, config_id, map_object_id,
                    state_code, button_label, button_color, color_hex, sort_order, is_visible, is_enabled
                ) VALUES (
                    :id, :config_id, :config_id, :map_object_id,
                    :state_code, :button_label, :color_hex, :color_hex, :sort_order, :is_visible, :is_enabled
                )
            """), {
                'id': _next_id(db, 'polygon_ui_state_option'),
                'config_id': cfg['id'],
                'map_object_id': map_object_id,
                'state_code': str(item.get('state_code') or f'option_{idx}')[:50],
                'button_label': str(item.get('button_label') or item.get('state_code') or f'OPCION {idx}')[:100],
                'color_hex': item.get('color_hex'),
                'sort_order': _safe_int(item.get('sort_order'), idx),
                'is_visible': _safe_bool(item.get('is_visible'), True),
                'is_enabled': _safe_bool(item.get('is_enabled'), True),
            })
    db.commit()
    return {'ok': True}


def _normalize_license_plan(value: Any) -> str:
    normalized = str(value or 'unlimited').strip().lower()
    mapping = {
        'sin licencia': 'no_license',
        'sin_licencia': 'no_license',
        'no_license': 'no_license',
        'daily': 'daily',
        'diaria': 'daily',
        '90': '90_days',
        '90_days': '90_days',
        '90 dias': '90_days',
        '180': '180_days',
        '180_days': '180_days',
        '180 dias': '180_days',
        '360': '360_days',
        '360_days': '360_days',
        '360 dias': '360_days',
        'unlimited': 'unlimited',
        'ilimitado': 'unlimited',
    }
    return mapping.get(normalized, 'unlimited')


def _compute_license_fields(plan_raw: Any, days_raw: Any = None) -> dict[str, Any]:
    from datetime import datetime, timedelta, timezone
    plan = _normalize_license_plan(plan_raw)
    now = datetime.now(timezone.utc)
    days = None
    expires = None
    status = 'licensed'
    if plan == 'no_license':
        status = 'blocked'
    elif plan == 'daily':
        days = 1
        expires = now + timedelta(days=1)
    elif plan == '90_days':
        days = 90
        expires = now + timedelta(days=90)
    elif plan == '180_days':
        days = 180
        expires = now + timedelta(days=180)
    elif plan == '360_days':
        days = 360
        expires = now + timedelta(days=360)
    elif plan == 'unlimited':
        days = None
        expires = None
    if isinstance(days_raw, int) and plan not in {'no_license', 'unlimited'}:
        days = days_raw
        expires = now + timedelta(days=max(1, days_raw))
    return {'license_plan': plan, 'license_days': days, 'license_expires_at': expires, 'license_status': status}


def _license_status_from_row(row: dict[str, Any]) -> tuple[str, Any]:
    from datetime import datetime, timezone
    plan = _normalize_license_plan(row.get('license_plan'))
    expires = row.get('license_expires_at')
    if isinstance(expires, str):
        try:
            expires = datetime.fromisoformat(expires.replace('Z', '+00:00'))
        except Exception:
            expires = None
    if getattr(expires, 'tzinfo', None) is None and expires is not None:
        expires = expires.replace(tzinfo=timezone.utc)
    if not _safe_bool(row.get('is_active'), True):
        return 'disabled', expires
    if plan == 'no_license':
        return 'blocked', expires
    if expires and expires < datetime.now(timezone.utc):
        return 'expired', expires
    if _safe_bool(row.get('enforce_mac_lock'), False) and _normalize_mac(row.get('authorized_mac')):
        detected = _normalize_mac(row.get('mac_address'))
        expected = _normalize_mac(row.get('authorized_mac'))
        if detected and detected != expected:
            return 'unauthorized_device', expires
        if not detected:
            return 'awaiting_mac', expires
    return row.get('license_status') or 'licensed', expires


@router.get('/screens')
def list_config_screens(db: Session = Depends(get_db)):
    if _table_exists(db, 'screen'):
        rows = db.execute(text("""
            SELECT
                s.id,
                s.code,
                s.name,
                s.expected_url AS url,
                s.status_code AS status,
                s.last_heartbeat_at AS last_heartbeat,
                s.site_id,
                s.is_active,
                s.client_ip,
                s.mac_address,
                s.authorized_mac,
                COALESCE(s.device_label, '') AS device_label,
                COALESCE(s.device_name, '') AS device_name,
                COALESCE(s.device_fingerprint, '') AS device_fingerprint,
                COALESCE(s.user_agent, '') AS user_agent,
                COALESCE(s.notes, '') AS notes,
                COALESCE(s.enforce_mac_lock, FALSE) AS enforce_mac_lock,
                s.license_plan,
                s.license_status,
                s.license_expires_at,
                s.license_days,
                st.code AS site_code,
                st.name AS site_name
            FROM screen s
            LEFT JOIN site st ON st.id = s.site_id
            ORDER BY s.name, s.id
        """)).mappings().all()
        payload = []
        for row in rows:
            item = dict(row)
            status, expires = _license_status_from_row(item)
            item['license_status'] = status
            item['license_expires_at'] = expires.isoformat() if hasattr(expires, 'isoformat') and expires else None
            item['authorized_mac'] = _normalize_mac(item.get('authorized_mac'))
            item['mac_address'] = _normalize_mac(item.get('mac_address'))
            item['license_reason'] = None if status == 'licensed' else ('Pantalla deshabilitada desde configuración.' if status == 'disabled' else ('La licencia está vencida.' if status == 'expired' else ('MAC distinta a la autorizada.' if status == 'unauthorized_device' else 'Sin licencia activa.')))
            payload.append(item)
        return payload
    return []


@router.post('/screens')
def create_config_screen(payload: dict[str, Any], db: Session = Depends(get_db)):
    site_code = (payload.get('site_code') or '').replace('-', '_')
    site_id = db.execute(text('SELECT id FROM site WHERE code = :code LIMIT 1'), {'code': site_code}).scalar()
    if not site_id:
        site_id = db.execute(text('SELECT id FROM site ORDER BY id LIMIT 1')).scalar()
    license_fields = _compute_license_fields(payload.get('license_plan'), payload.get('license_days'))
    db.execute(text("""
        INSERT INTO screen (id, site_id, code, name, device_label, device_name, device_fingerprint, user_agent, expected_url, is_active, status_code, role_code, created_at, last_heartbeat_at, client_ip, mac_address, authorized_mac, enforce_mac_lock, notes, license_plan, license_status, license_expires_at, license_days)
        VALUES (:id, :site_id, :code, :name, :device_label, :device_name, :device_fingerprint, :user_agent, :expected_url, :is_active, :status_code, :role_code, NOW(), NULL, :client_ip, :mac_address, :authorized_mac, :enforce_mac_lock, :notes, :license_plan, :license_status, :license_expires_at, :license_days)
    """), {
        'id': _next_id(db, 'screen'),
        'site_id': site_id,
        'code': payload.get('code'),
        'name': payload.get('name') or payload.get('code'),
        'expected_url': payload.get('url'),
        'is_active': _safe_bool(payload.get('is_active'), True),
        'status_code': payload.get('status') or 'offline',
        'role_code': 'wall',
        'client_ip': payload.get('client_ip'),
        'mac_address': _normalize_mac(payload.get('mac_address')),
        'authorized_mac': _normalize_mac(payload.get('authorized_mac') or payload.get('mac_authorized')),
        'enforce_mac_lock': _safe_bool(payload.get('enforce_mac_lock'), False),
        'device_label': payload.get('device_label') or payload.get('location_name') or payload.get('name'),
        'device_name': payload.get('device_name'),
        'device_fingerprint': payload.get('device_fingerprint'),
        'user_agent': payload.get('user_agent'),
        'notes': payload.get('notes'),
        **license_fields,
    })
    db.commit()
    return {'ok': True}


@router.put('/screens/{item_id}')
def update_config_screen(item_id: int, payload: dict[str, Any], db: Session = Depends(get_db)):
    site_code = (payload.get('site_code') or '').replace('-', '_')
    site_id = db.execute(text('SELECT id FROM site WHERE code = :code LIMIT 1'), {'code': site_code}).scalar()
    license_fields = _compute_license_fields(payload.get('license_plan'), payload.get('license_days'))
    params = {
        'id': item_id,
        'code': payload.get('code'),
        'name': payload.get('name') or payload.get('code'),
        'expected_url': payload.get('url'),
        'is_active': _safe_bool(payload.get('is_active'), True),
        'status_code': payload.get('status') or 'offline',
        'client_ip': payload.get('client_ip'),
        'mac_address': _normalize_mac(payload.get('mac_address')),
        'authorized_mac': _normalize_mac(payload.get('authorized_mac') or payload.get('mac_authorized')),
        'enforce_mac_lock': _safe_bool(payload.get('enforce_mac_lock'), False),
        'device_label': payload.get('device_label') or payload.get('location_name') or payload.get('name'),
        'device_name': payload.get('device_name'),
        'device_fingerprint': payload.get('device_fingerprint'),
        'user_agent': payload.get('user_agent'),
        'notes': payload.get('notes'),
        **license_fields,
    }
    if site_id:
        params['site_id'] = site_id
        db.execute(text("""
            UPDATE screen
            SET site_id = :site_id,
                code = :code,
                name = :name,
                expected_url = :expected_url,
                is_active = :is_active,
                status_code = :status_code,
                client_ip = COALESCE(:client_ip, client_ip),
                mac_address = COALESCE(:mac_address, mac_address),
                authorized_mac = :authorized_mac,
                enforce_mac_lock = :enforce_mac_lock,
                device_label = :device_label,
                device_name = :device_name,
                device_fingerprint = :device_fingerprint,
                user_agent = :user_agent,
                notes = :notes,
                license_plan = :license_plan,
                license_status = :license_status,
                license_expires_at = :license_expires_at,
                license_days = :license_days
            WHERE id = :id
        """), params)
    else:
        db.execute(text("""
            UPDATE screen
            SET code = :code,
                name = :name,
                expected_url = :expected_url,
                is_active = :is_active,
                status_code = :status_code,
                client_ip = COALESCE(:client_ip, client_ip),
                mac_address = COALESCE(:mac_address, mac_address),
                authorized_mac = :authorized_mac,
                enforce_mac_lock = :enforce_mac_lock,
                device_label = :device_label,
                device_name = :device_name,
                device_fingerprint = :device_fingerprint,
                user_agent = :user_agent,
                notes = :notes,
                license_plan = :license_plan,
                license_status = :license_status,
                license_expires_at = :license_expires_at,
                license_days = :license_days
            WHERE id = :id
        """), params)
    db.commit()
    return {'ok': True}
