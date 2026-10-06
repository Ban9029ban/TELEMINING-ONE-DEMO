from datetime import datetime, timedelta, timezone
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.deps import get_db
from app.models.site import Site
from app.services.semaforo_service import SemaforoService
from app.services.screen_tracking_service import get_device_name_from_ip, get_mac_from_ip
from app.services.control_orchestrator_service import ControlOrchestratorService

router = APIRouter()

STALE_SECONDS = 180
SCREEN_RANGE = range(1, 7)




def _normalize_mac(value: str | None) -> str | None:
    raw = str(value or '').strip().lower().replace('-', ':')
    if not raw:
        return None
    parts = [part.zfill(2) for part in raw.split(':') if part.strip()]
    if len(parts) != 6:
        return raw
    return ':'.join(parts)

def _normalize_license_plan(value):
    normalized = str(value or 'unlimited').strip().lower()
    mapping = {
        'sin licencia': 'no_license',
        'sin_licencia': 'no_license',
        'no_license': 'no_license',
        'daily': 'daily',
        'diaria': 'daily',
        '90': '90_days',
        '90_days': '90_days',
        '180': '180_days',
        '180_days': '180_days',
        '360': '360_days',
        '360_days': '360_days',
        'unlimited': 'unlimited',
        'ilimitado': 'unlimited',
    }
    return mapping.get(normalized, 'unlimited')


def _screen_license_payload(screen_row):
    plan = _normalize_license_plan(screen_row.get('license_plan') if screen_row else None)
    expires = screen_row.get('license_expires_at') if screen_row else None
    if isinstance(expires, str):
        try:
            expires = datetime.fromisoformat(expires.replace('Z', '+00:00'))
        except Exception:
            expires = None
    if expires and expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)

    status = (screen_row.get('license_status') if screen_row else None) or 'licensed'
    reason = None
    allowed = True

    if not screen_row or not screen_row.get('is_active', True):
        status = 'disabled'
        reason = 'Pantalla deshabilitada desde configuración.'
        allowed = False
    elif plan == 'no_license':
        status = 'blocked'
        reason = 'Pantalla sin licencia activa.'
        allowed = False
    elif expires and expires < _utc_now():
        status = 'expired'
        reason = 'La licencia expiró.'
        allowed = False
    elif bool(screen_row.get('enforce_mac_lock')) and _normalize_mac(screen_row.get('authorized_mac')):
        detected = _normalize_mac(screen_row.get('mac_address'))
        expected = _normalize_mac(screen_row.get('authorized_mac'))
        if detected and expected and detected != expected:
            status = 'unauthorized_device'
            reason = f'Dispositivo no autorizado. MAC detectada {detected}, esperada {expected}.'
            allowed = False
        elif not detected:
            status = 'awaiting_mac'
            reason = 'Bloqueado hasta detectar MAC del equipo.'
            allowed = False

    return {
        'plan': plan,
        'status': status,
        'expires_at': expires.isoformat() if hasattr(expires, 'isoformat') and expires else None,
        'allowed': allowed,
        'reason': reason,
        'authorized_mac': _normalize_mac(screen_row.get('authorized_mac') if screen_row else None),
        'detected_mac': _normalize_mac(screen_row.get('mac_address') if screen_row else None),
        'enforce_mac_lock': bool(screen_row.get('enforce_mac_lock')) if screen_row else False,
    }


def _resolve_client_ip(request: Request | None, payload: dict | None = None):
    payload = payload or {}
    forwarded = payload.get('client_ip') or (request.headers.get('x-forwarded-for') if request else None)
    if isinstance(forwarded, str) and forwarded.strip():
        return forwarded.split(',')[0].strip()
    return request.client.host if request and request.client else None


def _utc_now():
    return datetime.now(timezone.utc)


def _normalize_screen_number(value):
    try:
        n = int(value)
    except Exception:
        return None
    return n if 1 <= n <= 99 else None


def _table_exists(db: Session, table_name: str) -> bool:
    return bool(
        db.execute(
            text(
                """
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = :table_name
                )
                """
            ),
            {'table_name': table_name},
        ).scalar()
    )


def _table_columns(db: Session, table_name: str) -> set[str]:
    if not _table_exists(db, table_name):
        return set()
    rows = db.execute(
        text(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = :table_name
            """
        ),
        {'table_name': table_name},
    ).fetchall()
    return {r[0] for r in rows}


def _next_id(db: Session, table_name: str) -> int:
    return int(db.execute(text(f"SELECT COALESCE(MAX(id), 0) + 1 FROM {table_name}")).scalar() or 1)


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


def _upsert_system_value(db: Session, key: str, value):
    _ensure_system_config_table(db)
    db.execute(text("""
        INSERT INTO system_config (key, value_text, scope, updated_at)
        VALUES (:key, :value_text, 'global', NOW())
        ON CONFLICT (key)
        DO UPDATE SET value_text = EXCLUDED.value_text, updated_at = NOW()
    """), {'key': key, 'value_text': None if value is None else str(value)})


def _get_system_value(db: Session, key: str, default=None):
    if not _table_exists(db, 'system_config'):
        return default
    row = db.execute(text('SELECT value_text FROM system_config WHERE key = :key LIMIT 1'), {'key': key}).mappings().first()
    return row['value_text'] if row and row.get('value_text') is not None else default


def _find_site_id(db: Session, site_code: str | None):
    query = db.query(Site)
    if site_code:
        site = query.filter(Site.code == site_code).first()
        if site:
            return site.id
        alt = query.filter(Site.code == site_code.replace('-', '_')).first()
        if alt:
            return alt.id
    site = query.order_by(Site.id.asc()).first()
    return site.id if site else None


def _get_screen_row(db: Session, code: str):
    if not _table_exists(db, 'screen'):
        return None
    return db.execute(text('SELECT * FROM screen WHERE code = :code LIMIT 1'), {'code': code}).mappings().first()


def _update_screen(db: Session, screen_id: int, values: dict):
    cols = _table_columns(db, 'screen')
    filtered = {k: v for k, v in values.items() if k in cols}
    if not filtered:
        return
    assignments = ', '.join(f"{k} = :{k}" for k in filtered.keys())
    params = dict(filtered)
    params['id'] = screen_id
    db.execute(text(f'UPDATE screen SET {assignments} WHERE id = :id'), params)


def _insert_screen(db: Session, values: dict):
    cols = _table_columns(db, 'screen')
    filtered = {k: v for k, v in values.items() if k in cols and k != 'id'}
    if not filtered:
        return None

    code = filtered.get('code')
    if code:
        existing = _get_screen_row(db, code)
        if existing:
            updates = {k: v for k, v in filtered.items() if k != 'code'}
            if updates:
                _update_screen(db, existing['id'], updates)
            return _get_screen_row(db, code)

    column_sql = ', '.join(filtered.keys())
    value_sql = ', '.join(f':{k}' for k in filtered.keys())
    db.execute(text(f'INSERT INTO screen ({column_sql}) VALUES ({value_sql})'), filtered)
    return _get_screen_row(db, code) if code else None


def _ensure_screen_slot(db: Session, number: int, site_code: str | None = None, current_url: str | None = None):
    code = f'pantalla-{number}'
    row = _get_screen_row(db, code)
    site_id = _find_site_id(db, site_code)
    now = _utc_now()

    defaults = {
        'site_id': site_id,
        'code': code,
        'name': f'Pantalla {number:02d}',
        'expected_url': current_url or f'/legacy-sismico/{site_code or "diamante"}',
        'is_active': True,
        'status_code': 'offline',
        'role_code': 'wall',
        'created_at': now,
        'last_heartbeat_at': None,
    }

    if row:
        updates = {}
        if site_id and row.get('site_id') != site_id:
            updates['site_id'] = site_id
        if current_url and row.get('expected_url') != current_url:
            updates['expected_url'] = current_url
        if updates:
            _update_screen(db, row['id'], updates)
            row = _get_screen_row(db, code)
        return row

    inserted = _insert_screen(db, defaults)
    return inserted or _get_screen_row(db, code)


def _seed_screen_catalog(db: Session):
    if not _table_exists(db, 'screen'):
        return []
    for number in SCREEN_RANGE:
        _ensure_screen_slot(db, number)
    db.commit()
    return db.execute(text('SELECT * FROM screen ORDER BY code ASC, id ASC')).mappings().all()


def _insert_heartbeat(db: Session, screen_row, payload: dict, now: datetime):
    if not _table_exists(db, 'screen_heartbeat'):
        return
    cols = _table_columns(db, 'screen_heartbeat')
    values = {
        'screen_id': screen_row.get('id') if screen_row else None,
        'browser_session_id': payload.get('browser_session_id'),
        'current_url': payload.get('current_url'),
        'status_code': 'online',
        'sent_at': now,
    }
    filtered = {k: v for k, v in values.items() if k in cols and k != 'id'}
    if not filtered:
        return
    column_sql = ', '.join(filtered.keys())
    value_sql = ', '.join(f':{k}' for k in filtered.keys())
    db.execute(text(f'INSERT INTO screen_heartbeat ({column_sql}) VALUES ({value_sql})'), filtered)


@router.get('/')
def list_screens(db: Session = Depends(get_db)):
    screens = _seed_screen_catalog(db)
    now = _utc_now()
    payload = []
    for screen in screens:
        last_hb = screen.get('last_heartbeat_at')
        is_online = False
        if last_hb:
            if isinstance(last_hb, str):
                try:
                    last_hb = datetime.fromisoformat(last_hb.replace('Z', '+00:00'))
                except Exception:
                    last_hb = None
            if last_hb and last_hb.tzinfo is None:
                last_hb = last_hb.replace(tzinfo=timezone.utc)
            if last_hb:
                is_online = (now - last_hb) <= timedelta(seconds=STALE_SECONDS)
        license_info = _screen_license_payload(screen)
        payload.append({
            'id': screen.get('id'),
            'code': screen.get('code'),
            'name': screen.get('name') or screen.get('code'),
            'status': 'online' if is_online else (screen.get('status_code') or 'offline'),
            'last_heartbeat': last_hb.isoformat() if hasattr(last_hb, 'isoformat') and last_hb else None,
            'url': screen.get('expected_url'),
            'site_id': screen.get('site_id'),
            'client_ip': screen.get('client_ip'),
            'mac_address': screen.get('mac_address'),
            'license_plan': license_info['plan'],
            'license_status': license_info['status'],
            'license_expires_at': license_info['expires_at'],
            'license_access': license_info['allowed'],
            'license_reason': license_info['reason'],
            'authorized_mac': license_info['authorized_mac'],
            'detected_mac': license_info['detected_mac'],
            'enforce_mac_lock': license_info['enforce_mac_lock'],
            'device_label': screen.get('device_label'),
            'device_name': screen.get('device_name'),
            'device_fingerprint': screen.get('device_fingerprint'),
            'user_agent': screen.get('user_agent'),
            'notes': screen.get('notes'),
        })
    return payload


@router.post('/')
def create_screen(payload: dict, db: Session = Depends(get_db)):
    site_id = _find_site_id(db, payload.get('site_code'))
    if not site_id:
        raise HTTPException(status_code=400, detail='No existe sitio disponible para la pantalla.')
    screen_number = _normalize_screen_number(payload.get('screen_number'))
    code = str(payload.get('code') or (f'pantalla-{screen_number}' if screen_number else '')).strip()
    if not code:
        raise HTTPException(status_code=400, detail='Código de pantalla requerido.')
    existing = _get_screen_row(db, code)
    if existing:
        raise HTTPException(status_code=409, detail='Ya existe una pantalla con ese código.')
    license_plan = _normalize_license_plan(payload.get('license_plan'))
    screen = _insert_screen(db, {
        'site_id': site_id,
        'code': code,
        'name': payload.get('name') or code,
        'expected_url': payload.get('url') or payload.get('expected_url'),
        'status_code': payload.get('status') or 'offline',
        'role_code': payload.get('role_code') or 'wall',
        'is_active': bool(payload.get('is_active', True)),
        'license_plan': license_plan,
        'license_status': 'blocked' if license_plan == 'no_license' else 'licensed',
        'license_days': payload.get('license_days'),
        'device_label': payload.get('device_label') or payload.get('location_name'),
        'device_name': payload.get('device_name'),
        'device_fingerprint': payload.get('device_fingerprint'),
        'user_agent': payload.get('user_agent'),
        'authorized_mac': _normalize_mac(payload.get('authorized_mac') or payload.get('mac_address')),
        'enforce_mac_lock': bool(payload.get('enforce_mac_lock', False)),
        'notes': payload.get('notes'),
        'created_at': _utc_now(),
    })
    db.commit()
    return {'ok': True, 'item': dict(screen) if screen else None}


@router.put('/{screen_id}')
def update_screen(screen_id: int, payload: dict, db: Session = Depends(get_db)):
    row = db.execute(text('SELECT * FROM screen WHERE id = :id LIMIT 1'), {'id': screen_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail='Pantalla no encontrada.')
    values = {}
    if 'name' in payload:
        values['name'] = payload.get('name') or row.get('name')
    if 'url' in payload or 'expected_url' in payload:
        values['expected_url'] = payload.get('url') or payload.get('expected_url')
    if 'status' in payload:
        values['status_code'] = payload.get('status')
    if 'site_code' in payload:
        site_id = _find_site_id(db, payload.get('site_code'))
        if site_id:
            values['site_id'] = site_id
    if 'is_active' in payload:
        values['is_active'] = bool(payload.get('is_active'))
    if 'client_ip' in payload:
        values['client_ip'] = payload.get('client_ip')
    if 'mac_address' in payload:
        values['mac_address'] = _normalize_mac(payload.get('mac_address'))
    if 'authorized_mac' in payload:
        values['authorized_mac'] = _normalize_mac(payload.get('authorized_mac'))
    if 'device_label' in payload or 'location_name' in payload:
        values['device_label'] = payload.get('device_label') or payload.get('location_name')
    if 'device_name' in payload:
        values['device_name'] = payload.get('device_name')
    if 'device_fingerprint' in payload:
        values['device_fingerprint'] = payload.get('device_fingerprint')
    if 'user_agent' in payload:
        values['user_agent'] = payload.get('user_agent')
    if 'notes' in payload:
        values['notes'] = payload.get('notes')
    if 'enforce_mac_lock' in payload:
        values['enforce_mac_lock'] = bool(payload.get('enforce_mac_lock'))
    if 'license_plan' in payload:
        plan = _normalize_license_plan(payload.get('license_plan'))
        values['license_plan'] = plan
        values['license_status'] = 'blocked' if plan == 'no_license' else 'licensed'
    if 'license_expires_at' in payload:
        values['license_expires_at'] = payload.get('license_expires_at')
    if 'license_days' in payload:
        values['license_days'] = payload.get('license_days')
    _update_screen(db, screen_id, values)
    db.commit()
    updated = db.execute(text('SELECT * FROM screen WHERE id = :id LIMIT 1'), {'id': screen_id}).mappings().first()
    return {'ok': True, 'item': dict(updated) if updated else None}


@router.post('/heartbeat')
def heartbeat(payload: dict, request: Request, db: Session = Depends(get_db)):
    payload = payload or {}
    screen_code = str(payload.get('screen_code') or payload.get('screen') or '').strip()
    current_url = str(payload.get('current_url') or payload.get('url') or '').strip() or None
    site_code = str(payload.get('site_code') or '').strip() or None

    screen_number = _normalize_screen_number(payload.get('screen_number'))
    if not screen_number and screen_code.startswith('pantalla-'):
        screen_number = _normalize_screen_number(screen_code.split('-')[-1])
    if not screen_number:
        screen_number = 1

    screen = _ensure_screen_slot(db, screen_number, site_code=site_code, current_url=current_url)
    now = _utc_now()
    client_ip = _resolve_client_ip(request, payload)
    mac_address = _normalize_mac(get_mac_from_ip(client_ip)) if client_ip else 'unknown'
    detected_name = payload.get('device_name') or (get_device_name_from_ip(client_ip) if client_ip else None)
    fingerprint = payload.get('device_fingerprint')
    user_agent = payload.get('user_agent')

    if screen and screen.get('id'):
        update_values = {
            'status_code': 'online',
            'last_heartbeat_at': now,
            'expected_url': current_url or screen.get('expected_url'),
            'client_ip': client_ip,
            'mac_address': mac_address if mac_address not in {'unknown', None} else screen.get('mac_address'),
            'device_name': detected_name or screen.get('device_name'),
            'device_fingerprint': fingerprint or screen.get('device_fingerprint'),
            'user_agent': user_agent or screen.get('user_agent'),
        }
        _update_screen(db, screen['id'], update_values)
        screen = _get_screen_row(db, screen['code'])

    _insert_heartbeat(db, screen, payload, now)
    db.commit()
    license_info = _screen_license_payload(screen or {})
    return {
        'ok': True,
        'screen_code': screen.get('code') if screen else screen_code,
        'screen_number': screen_number,
        'last_heartbeat_at': now.isoformat(),
        'payload': payload,
        'client_ip': client_ip,
        'mac_address': mac_address,
        'device_name': detected_name,
        'device_fingerprint': fingerprint,
        'license_plan': license_info['plan'],
        'license_status': license_info['status'],
        'license_expires_at': license_info['expires_at'],
        'license_access': license_info['allowed'],
        'license_reason': license_info['reason'],
        'authorized_mac': license_info['authorized_mac'],
        'detected_mac': license_info['detected_mac'],
        'enforce_mac_lock': license_info['enforce_mac_lock'],
    }

@router.post('/{screen_code}/heartbeat')
def heartbeat_by_screen_code(screen_code: str, payload: dict | None = None, request: Request = None, db: Session = Depends(get_db)):
    body = dict(payload or {})
    body['screen_code'] = screen_code
    return heartbeat(body, request=request, db=db)

@router.get('/emergency')

def get_emergency(db: Session = Depends(get_db)):
    active = str(_get_system_value(db, 'global_emergency_active', 'false')).lower() in {'1', 'true', 'yes', 'on', 'si'}
    site_code = _get_system_value(db, 'global_emergency_site_code', None)
    site_codes_raw = _get_system_value(db, 'global_emergency_site_codes', '[]') or '[]'
    try:
        site_codes = json.loads(site_codes_raw) if isinstance(site_codes_raw, str) else list(site_codes_raw or [])
    except Exception:
        site_codes = [site_code] if site_code else []
    scope = _get_system_value(db, 'global_emergency_scope', 'global' if active and not site_codes else 'site_selection')
    return {
        'is_active': active,
        'site_code': site_code,
        'site_codes': site_codes,
        'scope': scope,
        'screen_number': _get_system_value(db, 'global_emergency_screen_number', None),
        'siren_type': _get_system_value(db, 'global_emergency_siren_type', 'police'),
        'updated_at': _get_system_value(db, 'global_emergency_updated_at', None),
    }


@router.post('/emergency')
def set_emergency(payload: dict, db: Session = Depends(get_db)):
    payload = payload or {}
    active = str(payload.get('is_active', False)).lower() in {'1', 'true', 'yes', 'on', 'si'} if not isinstance(payload.get('is_active'), bool) else payload.get('is_active')
    site_code = payload.get('site_code') or None
    site_codes = [str(code).strip() for code in (payload.get('site_codes') or []) if str(code).strip()]
    if not site_codes and site_code:
        site_codes = [site_code]
    scope = payload.get('scope') or ('site_selection' if site_codes else 'global')

    _upsert_system_value(db, 'global_emergency_active', 'true' if active else 'false')
    _upsert_system_value(db, 'global_emergency_site_code', site_code)
    _upsert_system_value(db, 'global_emergency_site_codes', json.dumps(site_codes))
    _upsert_system_value(db, 'global_emergency_scope', scope)
    _upsert_system_value(db, 'global_emergency_screen_number', payload.get('screen_number'))
    _upsert_system_value(db, 'global_emergency_siren_type', payload.get('siren_type') or 'police')
    _upsert_system_value(db, 'global_emergency_updated_at', _utc_now().isoformat())
    db.commit()

    orchestrator = ControlOrchestratorService(db)
    targets = site_codes or ([site_code] if site_code else [])
    if not targets:
        targets = ['diamante']

    results = []
    for target_site in targets:
        if active:
            results.append(orchestrator.apply_site_state(site_code=target_site, target_state='alerta', requested_by='screens_emergency', dry_run=False))
        else:
            results.append(orchestrator.apply_site_clear(site_code=target_site, requested_by='screens_emergency', dry_run=False))

    return {'ok': True, 'is_active': active, 'scope': scope, 'site_codes': targets, 'result': results}
