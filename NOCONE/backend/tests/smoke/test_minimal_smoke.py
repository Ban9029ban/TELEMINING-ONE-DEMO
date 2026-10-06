import os

import requests

BACKEND_BASE_URL = os.getenv("BACKEND_BASE_URL", "http://localhost:8000")
FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "http://localhost:3000")


def test_backend_health_smoke():
    response = requests.get(f"{BACKEND_BASE_URL}/api/health", timeout=10)
    assert response.status_code == 200


def test_frontend_home_smoke():
    response = requests.get(FRONTEND_BASE_URL, timeout=10)
    assert response.status_code == 200
    assert "<html" in response.text.lower()
