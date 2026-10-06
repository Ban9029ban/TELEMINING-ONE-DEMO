from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch

with patch("app.main.init_models", new=AsyncMock()):
    from app.main import app

client = TestClient(app)

EXPECTED_CORE_ROUTES = {
    "/api/health",
    "/api/auth/token",
    "/api/auth/me",
    "/api/control/maps/",
}

def test_openapi_contains_expected_core_routes():
    response = client.get("/openapi.json")
    assert response.status_code == 200
    paths = set(response.json()["paths"].keys())
    assert EXPECTED_CORE_ROUTES.issubset(paths)

def test_all_routes_have_tags():
    response = client.get("/openapi.json")
    spec = response.json()
    for path, methods in spec["paths"].items():
        for _, operation in methods.items():
            assert operation.get("tags"), f"missing tags for {path}"
