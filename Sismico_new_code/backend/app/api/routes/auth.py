
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException, Depends, Header
from sqlalchemy import select, delete, func
from sqlalchemy.orm import Session
from app.db.deps import get_db
from app.models.user import AppUser
from app.models.visual_layout import VisualSession

router = APIRouter()

DEMO_USERS = [
    {"username": "admin", "password": "admin123", "full_name": "Administrador", "role_code": "admin"},
    {"username": "operador", "password": "operador123", "full_name": "Operador", "role_code": "operator"},
    {"username": "visualizador", "password": "visualizador123", "full_name": "Visualizador", "role_code": "viewer"},
]

@router.post('/login')
def login(payload: dict, db: Session = Depends(get_db)):
    username = str(payload.get('username') or '').strip()
    password = str(payload.get('password') or '').strip()
    stored = db.scalar(select(AppUser).where(AppUser.username == username))
    if stored is not None:
        # Existing installations store the seeded credentials in password_hash.
        user = public_user(stored) if stored.is_active and hmac.compare_digest(stored.password_hash.encode(), password.encode()) else None
    else:
        user = next((u for u in DEMO_USERS if u['username'] == username and hmac.compare_digest(u['password'].encode(), password.encode())), None)
    if not user:
        raise HTTPException(status_code=401, detail='Credenciales inválidas')
    token = secrets.token_urlsafe(32)
    db.execute(delete(VisualSession).where(VisualSession.expires_at <= func.now()))
    db.add(VisualSession(token_hash=hashlib.sha256(token.encode()).hexdigest(), username=username,
                         expires_at=datetime.now(timezone.utc) + timedelta(days=30)))
    db.commit()
    return {
        'ok': True,
        'token': token,
        'user': {
            'username': user['username'],
            'full_name': user['full_name'],
            'role_code': user['role_code'],
        }
    }


def public_user(user):
    return {"username": user.username, "full_name": user.full_name, "role_code": user.role_code}


def current_user(db: Session = Depends(get_db), authorization: str | None = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Inicia sesión para configurar tu vista")
    digest = hashlib.sha256(authorization[7:].encode()).hexdigest()
    session = db.scalar(select(VisualSession).where(VisualSession.token_hash == digest,
                                                   VisualSession.expires_at > func.now()))
    if session is None:
        raise HTTPException(401, "La sesión venció. Vuelve a iniciar sesión")
    stored = db.scalar(select(AppUser).where(AppUser.username == session.username))
    if stored is not None:
        if not stored.is_active:
            raise HTTPException(401, "Usuario desactivado")
        return public_user(stored)
    user = next((u for u in DEMO_USERS if u['username'] == session.username), None)
    if user is None:
        raise HTTPException(401, "Usuario no encontrado")
    return {key: user[key] for key in ("username", "full_name", "role_code")}


@router.get('/me')
def me(user=Depends(current_user)):
    return user


def require_admin(user=Depends(current_user)):
    if user['role_code'].strip().lower() != 'admin':
        raise HTTPException(403, "Solo Admin puede administrar usuarios")
    return user
