import json
from pathlib import Path

def load_params():
    path = Path(__file__).resolve().parent.parent / "config" / "params.json"
    with open(path, "r") as f:
        return json.load(f)

PARAMS = load_params()
