from __future__ import annotations

import os
from typing import Dict, List

from app.models.remote_endpoint import RemoteEndpoint


LEGACY_DEFAULTS = {
    "diamante": [
        {
            "code": "diamante_legacy_resumen",
            "name": "Diamante legacy resumen",
            "endpoint_url": os.getenv("TARGET_URL_MAIN", "http://10.18.18.83:8001/hdis1/resumen/"),
            "endpoint_kind": "html_table",
            "parser_type": "legacy_diamante",
            "polling_seconds": int(os.getenv("CODELCO_POLL_MS", "10000")) // 1000,
        }
    ],
    "andesita": [
        {
            "code": "andesita_legacy_json",
            "name": "Andesita legacy json",
            "endpoint_url": os.getenv("ANDESITA_JSON_URL", "http://10.18.18.83:8008/api/poligonos"),
            "endpoint_kind": "json_api",
            "parser_type": "legacy_andesita",
            "polling_seconds": 15,
        },
        {
            "code": "andesita_legacy_html",
            "name": "Andesita legacy html fallback",
            "endpoint_url": os.getenv("ANDESITA_HTML_URL", "http://10.18.18.83:8008/hdis1/resumen/"),
            "endpoint_kind": "html_table",
            "parser_type": "legacy_andesita",
            "polling_seconds": 15,
        },
    ],
    "andes_norte": [
        {
            "code": "andes_norte_legacy_main",
            "name": "Andes Norte legacy resumen main",
            "endpoint_url": os.getenv("TARGET_URL_MAIN", "http://10.18.18.83:8001/hdis1/resumen/"),
            "endpoint_kind": "html_table",
            "parser_type": "legacy_andes_norte",
            "polling_seconds": int(os.getenv("CODELCO_POLL_MS", "10000")) // 1000,
        },
        {
            "code": "andes_norte_legacy_inicio_caving",
            "name": "Andes Norte legacy inicio caving",
            "endpoint_url": os.getenv("TARGET_URL_ANDESNORTE", "http://10.18.18.83:8008/hdis1/resumen/"),
            "endpoint_kind": "html_table",
            "parser_type": "legacy_andes_norte",
            "polling_seconds": int(os.getenv("CODELCO_POLL_MS", "10000")) // 1000,
        },
    ],
    "andes_norte_tunel_correa": [
        {
            "code": "andes_norte_tunel_correa_template",
            "name": "Túnel Correa HDIS resumen",
            "endpoint_url": os.getenv("TUNEL_CORREA_URL", os.getenv("TARGET_URL_MAIN", "http://10.18.18.83:8001/hdis1/resumen/")),
            "endpoint_kind": "html_table",
            "parser_type": "legacy_tunel_correa",
            "polling_seconds": 10,
        }
    ],
    "pilar_norte": [
        {
            "code": "pilar_norte_legacy_main",
            "name": "Pilar Norte legacy basado en Andes Norte",
            "endpoint_url": os.getenv("TARGET_URL_MAIN", "http://10.18.18.83:8001/hdis1/resumen/"),
            "endpoint_kind": "html_table",
            "parser_type": "legacy_pilar_norte",
            "polling_seconds": int(os.getenv("CODELCO_POLL_MS", "10000")) // 1000,
        }
    ],
    "esmeralda": [
        {
            "code": "esmeralda_legacy_main",
            "name": "Esmeralda legacy basado en Diamante",
            "endpoint_url": os.getenv("TARGET_URL_MAIN", "http://10.18.18.83:8001/hdis1/resumen/"),
            "endpoint_kind": "html_table",
            "parser_type": "legacy_esmeralda",
            "polling_seconds": int(os.getenv("CODELCO_POLL_MS", "10000")) // 1000,
        }
    ],
}


def endpoint_payload(endpoint: RemoteEndpoint) -> Dict[str, str]:
    return {
        "code": endpoint.code,
        "name": endpoint.name,
        "endpoint_url": endpoint.endpoint_url,
        "endpoint_kind": endpoint.endpoint_kind,
        "parser_type": endpoint.parser_type,
        "polling_seconds": endpoint.polling_seconds or 15,
    }


def defaults_for_site(site_code: str) -> List[Dict[str, str]]:
    return LEGACY_DEFAULTS.get(site_code, [])
