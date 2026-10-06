import os

import requests

BACKEND_BASE_URL = os.getenv("BACKEND_BASE_URL", "http://localhost:8000")


def test_live_health_endpoint():
    response = requests.get(f"{BACKEND_BASE_URL}/api/health", timeout=10)
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_live_root_endpoint():
    response = requests.get(f"{BACKEND_BASE_URL}/", timeout=10)
    assert response.status_code == 200
    assert "docs" in response.json()
