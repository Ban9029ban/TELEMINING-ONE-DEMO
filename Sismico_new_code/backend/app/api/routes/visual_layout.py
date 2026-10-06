import json
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.deps import get_db
from app.models.user import AppUser
from app.models.visual_layout import VisualLayout
from app.api.routes.auth import current_user, DEMO_USERS, public_user

router = APIRouter()
MAP_CODES = {"diamante", "andesita", "andes-norte", "det-np-andes-norte", "det-ucl-andes-norte",
             "andes-norte-tunel-correa", "pilar-norte", "esmeralda", "sala-sic"}


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


def available_users(db):
    users = {u['username']: {k: u[k] for k in ('username', 'full_name', 'role_code')} for u in DEMO_USERS}
    for row in db.scalars(select(AppUser)):
        if row.is_active:
            users[row.username] = public_user(row)
        else:
            users.pop(row.username, None)
    return list(users.values())


def check_target(db, user, username, map_code):
    if map_code not in MAP_CODES:
        raise HTTPException(404, "Mapa no encontrado")
    if username != user['username'] and user['role_code'].lower() != 'admin':
        raise HTTPException(403, "Solo Admin puede configurar vistas de otros usuarios")
    if username not in {u['username'] for u in available_users(db)}:
        raise HTTPException(404, "Usuario no encontrado")


@router.get('/users')
def users(db: Session = Depends(get_db), user=Depends(current_user)):
    return available_users(db) if user['role_code'].lower() == 'admin' else [user]


@router.get('/{map_code}/{username}')
def get_layout(map_code: str, username: str, db: Session = Depends(get_db), user=Depends(current_user)):
    check_target(db, user, username, map_code)
    row = db.get(VisualLayout, (username, map_code))
    return json.loads(row.value) if row else {"version": 1, "boxes": {}}


@router.put('/{map_code}/{username}')
def save_layout(map_code: str, username: str, payload: Layout, db: Session = Depends(get_db), user=Depends(current_user)):
    check_target(db, user, username, map_code)
    if map_code == 'sala-sic' and user['role_code'].lower() != 'admin':
        raise HTTPException(403, "Solo Admin puede modificar la vista de Sala CIC")
    for key, box in payload.boxes.items():
        if not key or len(key) > 100 or box.x + box.width > 100.001 or box.y + box.height > 100.001:
            raise HTTPException(422, "Los recuadros deben quedar dentro de la pantalla")
    data = payload.model_dump(exclude_none=True)
    if not (user['role_code'].lower() == 'admin'):
        previous = (get_layout(map_code, username, db, user)).get('overlays', {})
        for name, setting in data['overlays'].items():
            allowed = previous.get(name, {}).get('allowed', True)
            if setting['allowed'] != allowed or (not allowed and setting['visible']):
                raise HTTPException(403, "El administrador no permite mostrar este elemento")
        data['overlays'] = {**previous, **data['overlays']}
    for setting in data['overlays'].values():
        if not setting['allowed']:
            setting['visible'] = False

    # Lock per user/map, including the first save, to serialize concurrent editors.
    if db.bind.dialect.name == 'postgresql':
        from sqlalchemy import text
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"visual:{username}:{map_code}"})
    row = db.get(VisualLayout, (username, map_code))
    if row is None:
        row = VisualLayout(username=username, map_code=map_code)
        db.add(row)
    row.value = json.dumps(data)
    row.updated_by = user['username']
    db.commit()
    return data
