import importlib
import pkgutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LISTENER_APP = ROOT / "listener" / "app"
sys.path.insert(0, str(ROOT / "listener"))

failed = []
for module in pkgutil.walk_packages([str(LISTENER_APP)], prefix="app."):
    name = module.name
    if ".__pycache__" in name or name.endswith(".gui"):
        continue
    try:
        importlib.import_module(name)
        print(f"IMPORT_OK {name}")
    except Exception as exc:
        failed.append((name, str(exc)))
        print(f"IMPORT_FAIL {name}: {exc}")

if failed:
    print(f"TOTAL_IMPORT_FAILURES={len(failed)}")
    raise SystemExit(1)

print("TOTAL_IMPORT_FAILURES=0")
