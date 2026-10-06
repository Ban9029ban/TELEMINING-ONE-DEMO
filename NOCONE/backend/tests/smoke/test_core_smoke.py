from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch

with patch("app.main.init_models", new=AsyncMock()):
    from app.main import app

client = TestClient(app)

def test_smoke_core_pages():
    for path in ["/", "/docs", "/openapi.json", "/api/health"]:
        response = client.get(path)
        assert response.status_code == 200
