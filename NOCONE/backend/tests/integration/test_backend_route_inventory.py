from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch

with patch("app.main.init_models", new=AsyncMock()):
    from app.main import app

client = TestClient(app)

def test_openapi_exposes_substantial_route_inventory():
    spec = client.get("/openapi.json").json()
    route_count = len(spec["paths"])
    assert route_count >= 15

def test_health_route_is_get_only():
    spec = client.get("/openapi.json").json()
    assert list(spec["paths"]["/api/health"].keys()) == ["get"]
