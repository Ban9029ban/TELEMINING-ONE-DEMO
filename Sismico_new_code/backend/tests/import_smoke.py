import importlib
import json
from pathlib import Path

MODULES = [
    "app.main",
    "app.api.routes.config_admin",
    "app.api.routes.sismico",
    "app.api.routes.screens",
    "app.api.routes.semaforos",
]

for mod in MODULES:
    importlib.import_module(mod)
    print(f"OK import {mod}")

main = importlib.import_module("app.main")
app = getattr(main, "app", None)
assert app is not None, "FastAPI app not found"
print("OK app.main:app")

required = {"/api/config/users", "/api/config/system", "/api/config/polygon-sites"}
paths = {route.path for route in app.routes}
missing = sorted(required - paths)
assert not missing, f"Missing routes: {missing}"
print("OK required routes present")
