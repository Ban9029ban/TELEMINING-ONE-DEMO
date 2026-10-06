import os
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch

os.environ.setdefault("APP_ENV", "develop")
os.environ.setdefault("POSTGRES_DB", "zenit_test")
os.environ.setdefault("POSTGRES_USER", "zenit")
os.environ.setdefault("POSTGRES_PASSWORD", "zenit")

with patch("app.main.init_models", new=AsyncMock()):
    from app.main import app

client = TestClient(app)

def test_docs_and_openapi_are_available():
    assert client.get("/docs").status_code == 200
    spec = client.get("/openapi.json")
    assert spec.status_code == 200
    assert "paths" in spec.json()

def test_auth_me_requires_authentication():
    response = client.get("/api/auth/me")
    assert response.status_code in {401, 403}

def test_unknown_route_returns_404():
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404
