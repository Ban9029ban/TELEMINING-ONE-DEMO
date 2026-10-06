from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict

_DATA_DIR = Path(__file__).resolve().parent
_JSON_PATH = _DATA_DIR / "mining_synonyms.json"


@lru_cache(maxsize=1)
def get_mining_synonyms() -> Dict[str, Any]:
    """Carga el diccionario de sinónimos mineros (backend).

    Se usa para normalizar lenguaje de mina (NP/UCL/NTI, UR/pórtico, vueltas, permanencias, CO/TEMP, etc.)
    y exponerlo en /mcp/facts para transparencia.
    """
    if not _JSON_PATH.exists():
        return {}
    return json.loads(_JSON_PATH.read_text(encoding="utf-8"))
