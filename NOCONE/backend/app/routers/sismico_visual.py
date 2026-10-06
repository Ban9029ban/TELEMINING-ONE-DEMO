"""User layouts for the seismic UI embedded in NOCONE."""
import json
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.db import get_db
from app.db.models import User
from app.deps.auth import get_current_user
from app.core.permissions import is_admin_role
from app.services.user_licenses import coerce_license_expiration_date, license_warning_due
from app.services.app_settings import ensure_app_setting_schema, upsert_app_setting

router = APIRouter(prefix="/sismico-ui", tags=["sismico-visual"])
MAPS = {"diamante", "andesita", "andes-norte", "det-np-andes-norte", "det-ucl-andes-norte", "andes-norte-tunel-correa", "pilar-norte", "esmeralda", "sala-sic"}

class Box(BaseModel):
    x: float = Field(ge=0, le=100, allow_inf_nan=False)
    y: float = Field(ge=0, le=100, allow_inf_nan=False)
    width: float = Field(ge=3, le=100, allow_inf_nan=False)
    height: float = Field(ge=3, le=100, allow_inf_nan=False)

class SalaProject(BaseModel):
    selected: bool = False
    mode: Literal['together', 'separate'] = 'together'
    showPolygons: bool = False
    showMap: bool = True

class SalaView(BaseModel):
    density: Literal['compact', 'normal', 'large'] = 'normal'
    projects: dict[str, SalaProject] = Field(default_factory=dict, max_length=8)

class OverlayVisibility(BaseModel):
    visible: bool = True
    allowed: bool = True

class Layout(BaseModel):
    overlays: dict[Literal['alert-map', 'remote-alerts'], OverlayVisibility] = Field(default_factory=dict)
    sala: SalaView | None = None
    version: Literal[1] = 1
    boxes: dict[str, Box] = Field(default_factory=dict, max_length=80)

def profile(user):
    return {"username": user.username, "full_name": user.full_name or user.username,
            "role_code": "admin" if is_admin_role(user.role) else "user"}

@router.get('/auth/me')
async def me(current=Depends(get_current_user)):
    expires = coerce_license_expiration_date(getattr(current, "license_expires_on", None))
    return {**profile(current), "license_expires_on": expires, "license_warning_due": license_warning_due(expires)}

@router.get('/visual-layout/users')
async def users(db: AsyncSession = Depends(get_db), current=Depends(get_current_user)):
    if not is_admin_role(current.role):
        return [profile(current)]
    rows = (await db.execute(select(User).where(User.is_active.is_(True)).order_by(User.username))).scalars().all()
    return [profile(user) for user in rows]

async def target_user(db, current, username, map_code):
    if map_code not in MAPS:
        raise HTTPException(404, "Mapa no encontrado")
    if username != current.username and not is_admin_role(current.role):
        raise HTTPException(403, "Solo Admin puede configurar vistas de otros usuarios")
    target = (await db.execute(select(User).where(User.username == username, User.is_active.is_(True)))).scalar_one_or_none()
    if target is None:
        raise HTTPException(404, "Usuario no encontrado")
    return target

@router.get('/visual-layout/{map_code}/{username}')
async def get_layout(map_code: str, username: str, db: AsyncSession = Depends(get_db), current=Depends(get_current_user)):
    target = await target_user(db, current, username, map_code)
    await ensure_app_setting_schema(db)
    value = (await db.execute(text('SELECT value FROM app_setting WHERE key = :key'), {"key": f"sismico_visual:{target.id}:{map_code}"})).scalar_one_or_none()
    return json.loads(value) if value else {"version": 1, "boxes": {}}

@router.put('/visual-layout/{map_code}/{username}')
async def save_layout(map_code: str, username: str, payload: Layout, db: AsyncSession = Depends(get_db), current=Depends(get_current_user)):
    target = await target_user(db, current, username, map_code)
    if map_code == 'sala-sic' and not is_admin_role(current.role):
        raise HTTPException(403, "Solo Admin puede modificar la vista de Sala CIC")
    for key, box in payload.boxes.items():
        if not key or len(key) > 100 or box.x + box.width > 100.001 or box.y + box.height > 100.001:
            raise HTTPException(422, "Los recuadros deben quedar dentro de la pantalla")
    data = payload.model_dump(exclude_none=True)
    if not (is_admin_role(current.role)):
        previous = (await get_layout(map_code, username, db, current)).get('overlays', {})
        for name, setting in data['overlays'].items():
            allowed = previous.get(name, {}).get('allowed', True)
            if setting['allowed'] != allowed or (not allowed and setting['visible']):
                raise HTTPException(403, "El administrador no permite mostrar este elemento")
        data['overlays'] = {**previous, **data['overlays']}
    for setting in data['overlays'].values():
        if not setting['allowed']:
            setting['visible'] = False

    await upsert_app_setting(db, key=f"sismico_visual:{target.id}:{map_code}", value=json.dumps(data),
        description=f"Vista sísmica de {target.username}, actualizada por {current.username}", category="sismico_visual")
    await db.commit()
    return data
