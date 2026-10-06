
from fastapi.routing import APIRoute
from app.main import app

def test_config_routes_present():
    route_paths = {route.path for route in app.routes if isinstance(route, APIRoute)}
    expected = {
        "/api/config/users",
        "/api/config/companies",
        "/api/config/semaforos",
        "/api/config/external-sources",
        "/api/config/system",
        "/api/config/polygon-sites",
        "/api/config/screens",
    }
    for item in expected:
        assert item in route_paths
