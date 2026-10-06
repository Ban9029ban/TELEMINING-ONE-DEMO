
import importlib

MODULES = [
    "app.main",
    "app.api.routes.config_admin",
    "app.api.routes.screens",
    "app.api.routes.sismico",
    "app.api.routes.sismico_operator",
    "app.api.routes.semaforos",
]

def test_import_modules():
    for module_name in MODULES:
        module = importlib.import_module(module_name)
        assert module is not None
