import json
from datetime import datetime, timedelta, timezone
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from app.db.deps import get_db
from app.models.user import AppUser
from app.models.visual_layout import VisualLayout, VisualSession
from app.api.routes.auth import router as auth_router
from app.api.routes.config_admin import router as config_router
from app.api.routes.visual_layout import router, MAP_CODES


@pytest.fixture
def api():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for table in (AppUser.__table__, VisualSession.__table__, VisualLayout.__table__):
        table.create(engine)
    with Session(engine) as db:
        db.add(AppUser(id=1, username="user", full_name="Usuario", password_hash="test-pass", role_code="user", is_active=True))
        db.commit()
    app = FastAPI()
    app.include_router(auth_router, prefix="/auth")
    app.include_router(config_router, prefix="/config")
    app.include_router(router, prefix="/visual-layout")
    def database():
        with Session(engine) as session:
            yield session
    app.dependency_overrides[get_db] = database
    with TestClient(app) as client:
        yield client, engine
    engine.dispose()


def login(client, username="user", password="test-pass"):
    response = client.post("/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200
    return {"Authorization": "Bearer " + response.json()["token"]}


LAYOUT = {"version": 1, "boxes": {"map": {"x": 25, "y": 10, "width": 70, "height": 80}, "buttons": {"x": 0, "y": 10, "width": 24, "height": 80}}}


@pytest.mark.parametrize("map_code", sorted(MAP_CODES))
def test_user_layout_persists_across_sessions_per_map(api, map_code):
    client, engine = api
    headers = login(client)
    path = f"/visual-layout/{map_code}/user"
    assert client.put(path, headers=headers, json=LAYOUT).status_code == 200
    # A second login/request opens a fresh SQLAlchemy session.
    assert client.get(path, headers=login(client)).json() == LAYOUT
    with Session(engine) as db:
        row = db.get(VisualLayout, ("user", map_code))
        assert row.updated_by == "user"
        assert json.loads(row.value) == LAYOUT


def test_non_admin_cannot_read_or_modify_other_users(api):
    client, _ = api
    headers = login(client)
    assert [u["username"] for u in client.get('/visual-layout/users', headers=headers).json()] == ['user']
    assert client.get('/visual-layout/diamante/admin', headers=headers).status_code == 403
    assert client.put('/visual-layout/diamante/admin', headers=headers, json=LAYOUT).status_code == 403


def test_admin_assigns_other_view_and_keeps_own_independent(api):
    client, _ = api
    admin = login(client, 'admin', 'admin123')
    assert 'user' in [u['username'] for u in client.get('/visual-layout/users', headers=admin).json()]
    assert client.put('/visual-layout/diamante/user', headers=admin, json=LAYOUT).status_code == 200
    assert client.get('/visual-layout/diamante/user', headers=login(client)).json() == LAYOUT
    assert client.get('/visual-layout/diamante/admin', headers=admin).json()['boxes'] == {}
    assert client.get('/visual-layout/andesita/user', headers=admin).json()['boxes'] == {}
    assert client.put('/visual-layout/diamante/user', headers=admin, json={'version': 1, 'boxes': {}}).status_code == 200
    assert client.get('/visual-layout/diamante/user', headers=login(client)).json()['boxes'] == {}


@pytest.mark.parametrize('headers', [{}, {'Authorization': 'Bearer demo-token-admin'}, {'Authorization': 'Bearer forged'}])
def test_no_forged_or_missing_session(api, headers):
    client, _ = api
    assert client.put('/visual-layout/diamante/user', headers=headers, json=LAYOUT).status_code == 401


def test_expired_session_and_deactivated_user(api):
    client, engine = api
    headers = login(client)
    with Session(engine) as db:
        db.scalar(select(VisualSession)).expires_at = datetime.now(timezone.utc) - timedelta(days=1)
        db.commit()
    assert client.get('/visual-layout/diamante/user', headers=headers).status_code == 401
    headers = login(client)
    with Session(engine) as db:
        db.get(AppUser, 1).is_active = False
        db.commit()
    assert client.get('/visual-layout/diamante/user', headers=headers).status_code == 401
    assert client.post('/auth/login', json={'username': 'user', 'password': 'test-pass'}).status_code == 401


@pytest.mark.parametrize('box', [dict(x=-1,y=0,width=20,height=20), dict(x=90,y=0,width=20,height=20), dict(x=0,y=0,width=0,height=20), dict(x=0,y=99,width=20,height=20), dict(x='NaN',y=0,width=20,height=20)])
def test_reject_invalid_geometry(api, box):
    client, _ = api
    assert client.put('/visual-layout/diamante/user', headers=login(client), json={'boxes': {'map': box}}).status_code == 422


def test_unknown_target_and_map(api):
    client, _ = api
    admin = login(client, 'admin', 'admin123')
    assert client.put('/visual-layout/missing/user', headers=admin, json=LAYOUT).status_code == 404
    assert client.put('/visual-layout/diamante/missing', headers=admin, json=LAYOUT).status_code == 404


def test_user_cannot_elevate_own_role(api):
    client, _ = api
    headers = login(client)
    assert client.put('/config/users/1', headers=headers, json={'role':'admin'}).status_code == 403
    assert client.post('/config/users', headers=headers, json={'username':'attacker','role':'admin'}).status_code == 403
    assert client.put('/config/users/1', json={'role':'admin'}).status_code == 401
