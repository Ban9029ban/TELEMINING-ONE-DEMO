from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch

with patch("app.main.init_models", new=AsyncMock()):
    from app.main import app

client = TestClient(app)

def test_health_endpoint_returns_ok():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

def test_root_endpoint_exposes_docs():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["docs"] == "/docs"
