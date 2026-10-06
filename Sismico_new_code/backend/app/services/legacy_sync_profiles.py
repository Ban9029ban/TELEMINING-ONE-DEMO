from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, replace
from typing import Dict, List, Optional


@dataclass(frozen=True)
class PolygonProfile:
    canonical_name: str
    patterns: List[str]
    aliases: List[str]
    state_mode: str = "tri"
    source_scope: Optional[List[str]] = None
    notes: str = ""

    def regexes(self):
        return [re.compile(pattern, re.I) for pattern in self.patterns]


LEGACY_SITE_PROFILES: Dict[str, Dict] = {
    "diamante": {
        "legacy_page": "diamante.html",
        "description": "Legacy lee resumen principal 8001 y detecta color desde imagen estado para BDE; PIPA/HW/FW pueden venir por filas resumen.",
        "source_strategy": [
            {"endpoint_code": "diamante_legacy_resumen", "priority": 100, "notes": "Resumen principal 8001"},
        ],
        "polygons": [
            PolygonProfile(
                canonical_name="Diamante PIPA",
                patterns=[r"\bpipa\b"],
                aliases=["diamante_pipa", "pipa", "diamante pipa"],
                state_mode="dual",
            ),
            PolygonProfile(
                canonical_name="FootPrint HW",
                patterns=[r"foot\s*print.*hw", r"\bhw\b"],
                aliases=["footprint_hw", "diamante_footprint_hw", "hw", "footprint hw"],
                state_mode="dual",
            ),
            PolygonProfile(
                canonical_name="FootPrint Fw",
                patterns=[r"foot\s*print.*fw", r"\bfw\b"],
                aliases=["footprint_fw", "diamante_footprint_fw", "fw", "footprint fw"],
                state_mode="dual",
            ),
            PolygonProfile(
                canonical_name="Bajo Diamante Esmeralda",
                patterns=[r"bajo\s+diamante\s+esmeralda"],
                aliases=["bde", "bda", "esmeralda", "bajo diamante esmeralda", "diamante_bajo_diamante_esmeralda"],
                state_mode="tri",
                notes="Legacy usa imagen estado PNG con color azul/negro/rojo.",
            ),
        ],
    },
    "andesita": {
        "legacy_page": "andesita.html",
        "description": "Legacy intenta primero JSON /api/poligonos y luego fallback HTML /resumen.",
        "source_strategy": [
            {"endpoint_code": "andesita_legacy_json", "priority": 200, "notes": "JSON prioritario"},
            {"endpoint_code": "andesita_legacy_html", "priority": 100, "notes": "Fallback HTML"},
        ],
        "polygons": [
            PolygonProfile("Andesita Norte HW", [r"andesita\s+norte\s+hw"], ["andesita_norte_hw"], "tri"),
            PolygonProfile("Andesita Norte FW", [r"andesita\s+norte\s+fw"], ["andesita_norte_fw"], "tri"),
            PolygonProfile("Andesita Sur HW", [r"andesita\s+sur\s+hw"], ["andesita_sur_hw"], "tri"),
            PolygonProfile("Andesita Sur FW", [r"andesita\s+sur\s+fw"], ["andesita_sur_fw"], "tri"),
        ],
    },
    "andes_norte": {
        "legacy_page": "andesnorte.html",
        "description": "Legacy usa resumen 8001 para automaticos y 8008 solo para Inicio Caving.",
        "source_strategy": [
            {"endpoint_code": "andes_norte_legacy_main", "priority": 200, "notes": "Resumen principal 8001; cubre todos excepto Inicio Caving."},
            {"endpoint_code": "andes_norte_legacy_inicio_caving", "priority": 300, "notes": "Resumen 8008 exclusivo para Inicio Caving."},
        ],
        "polygons": [
            PolygonProfile("Poligono Bajo Andesita Profundo", [r"bajo\s+andesita\s+profundo\b"], ["bajo_andesita_profundo", "ann_bajo_andesita_profundo", "tc_bajo_andesita_profundo"], "tri", source_scope=["andes_norte_legacy_main"]),
            PolygonProfile("Poligono Bajo Andesita Under", [r"bajo\s+andesita\s+under\b"], ["bajo_andesita_under", "ann_bajo_andesita_under", "tc_bajo_andesita_under"], "tri", source_scope=["andes_norte_legacy_main"]),
            PolygonProfile("Monitoreo Post Evento 2025", [r"monitoreo\s+post\s+evento\s*2025"], ["monitoreo_post_evento_2025", "ann_monitoreo_post_evento_2025"], "tri"),
            PolygonProfile("Monitoreo Post Evento", [r"monitoreo\s+post\s+evento(?!\s*(?:2025|fw))", r"monitoreo\s+post\s+evento\s+local"], ["monitoreo_post_evento", "ann_monitoreo_post_evento", "monitoreo post evento local"], "dual", notes="Poligono local manual visible en layout Andes Norte."),
            PolygonProfile("Bajo FootPrint AN", [r"bajo\s*foot\s*print\s*an", r"poligono\s*bajo\s*foot\s*print\s*an", r"bajo\s*andes\s*norte", r"poligono\s*bajo\s*andes\s*norte"], ["bajo_footprint_an", "ann_bajo_footprint_an", "bajo_andes_norte", "ann_bajo_andes_norte", "bajo andes norte"], "tri", notes="Fila presente en resumen legacy Codelco; mantener en diagnostico y UI aunque el rotulo operativo ahora aparezca como Bajo Andes Norte."),
            PolygonProfile("ADIT 74 - 75", [r"adit\s*74\s*[-–]?\s*75", r"adit\s*74\s*-?\s*75\s*profundo"], ["adit_74_75", "ann_adit_74_75", "ann_adit_74_75_profundo"], "tri"),
            PolygonProfile("Poligono Pilar 2", [r"pilar\s*2", r"poligono\s+pilar\s*2", r"pilar\s*2\s*profundo"], ["poligono_pilar_2", "ann_pilar_2", "ann_pilar_2_profundo"], "tri"),
            PolygonProfile("Inicio Caving", [r"(?:an\s*)?inicio\s*caving"], ["inicio_caving", "ann_inicio_caving"], "tri", source_scope=["andes_norte_legacy_inicio_caving"]),
            PolygonProfile("P 4600", [r"\bp\s*4600\b"], ["p_4600", "ann_p4600", "tc_p_4600"], "dual"),
            PolygonProfile("TC OIM", [r"tc\s*oim"], ["tc_oim", "ann_tc_oim", "tc_tc_oim"], "dual", notes="Visible en layout nuevo pero no automatizado claramente en legacy principal."),
            PolygonProfile("PACIFICO", [r"pacifico"], ["pacifico", "ann_pacifico"], "dual", notes="Overlay presente en Andes Norte nuevo; legacy automatico no evidente."),
            PolygonProfile("AN NORTE HW", [r"an\s*norte\s*hw"], ["an_norte_hw", "ann_an_norte_hw"], "dual"),
            PolygonProfile("AN NORTE FW", [r"an\s*norte\s*fw"], ["an_norte_fw", "ann_an_norte_fw"], "dual"),
            PolygonProfile("AN SUR HW", [r"an\s*sur\s*hw"], ["an_sur_hw", "ann_an_sur_hw"], "dual"),
            PolygonProfile("CABECERA HW", [r"cabecera\s*hw"], ["cabecera_hw", "ann_cab_hw", "ann_cabecera_hw"], "dual"),
            PolygonProfile("CABECERA FW NORTE", [r"cabecera\s*fw\s*norte"], ["cabecera_fw_norte", "ann_cab_fw_norte", "ann_cabecera_fw_norte"], "dual"),
            PolygonProfile("Monitoreo Post Evento FW", [r"monitoreo\s+post\s+evento\s*fw"], ["monitoreo_post_evento_fw", "ann_monitoreo_post_evento_fw"], "dual"),
        ],
    },
    "pilar_norte": {
        "legacy_page": "andesnorte.html",
        "description": "Deriva del poligono Pilar 2 de Andes Norte. Debe seguir la misma fuente y estado operativo.",
        "source_strategy": [
            {"endpoint_code": "pilar_norte_legacy_main", "priority": 200, "notes": "Hereda desde resumen principal Andes Norte."},
        ],
        "polygons": [
            PolygonProfile("Poligono Pilar 2", [r"pilar\s*2", r"poligono\s+pilar\s*2", r"pilar\s*2\s*profundo"], ["poligono_pilar_2", "ann_pilar_2", "ann_pilar_2_profundo", "pilar_norte"], "tri"),
        ],
    },
    "esmeralda": {
        "legacy_page": "diamante.html",
        "description": "Deriva de Bajo Diamante Esmeralda y su color en PNG desde resumen principal.",
        "source_strategy": [
            {"endpoint_code": "esmeralda_legacy_main", "priority": 200, "notes": "Hereda desde resumen principal Diamante."},
        ],
        "polygons": [
            PolygonProfile("Bajo Diamante Esmeralda", [r"bajo\s+diamante\s+esmeralda"], ["bde", "bda", "esmeralda", "diamante_bajo_diamante_esmeralda"], "tri"),
        ],
    },
    "andes_norte_tunel_correa": {
        "legacy_page": "Dashboard_TC",
        "description": "HDIS 8001 automático para Bajo Andesita Profundo, Bajo Andesita Under y Pilar 2; TC OIM y P 4600 locales.",
        "source_strategy": [
            {"endpoint_code": "andes_norte_tunel_correa_template", "priority": 100, "notes": "Resumen HDIS 8001"},
        ],
        "polygons": [
            PolygonProfile("Poligono Bajo Andesita Profundo", [r"bajo\s+andesita\s+profundo\b"], ["bajo_andesita_profundo", "ann_bajo_andesita_profundo", "tc_bajo_andesita_profundo"], "tri", source_scope=["andes_norte_tunel_correa_template"]),
            PolygonProfile("Poligono Bajo Andesita Under", [r"bajo\s+andesita\s+under\b"], ["bajo_andesita_under", "ann_bajo_andesita_under", "tc_bajo_andesita_under"], "tri", source_scope=["andes_norte_tunel_correa_template"]),
            PolygonProfile("TC OIM", [r"(?!)"], ["tc_tc_oim", "tc_oim"], "traffic", source_scope=["local_manual_only"]),
            PolygonProfile("P 4600", [r"(?!)"], ["tc_p_4600", "p_4600"], "traffic", source_scope=["local_manual_only"]),
            PolygonProfile("Poligono Pilar 2 Profundo", [r"pilar\s*2\s*profundo"], ["tc_pilar_2_profundo", "pilar_2_profundo"], "tri"),
        ],
    },
}


def normalize_text(value: str | None) -> str:
    text = str(value or "")
    text = unicodedata.normalize("NFKD", text)
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = text.lower().replace("_", " ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def build_alias_map(site_code: str) -> Dict[str, str]:
    profile = LEGACY_SITE_PROFILES.get(site_code, {})
    alias_map: Dict[str, str] = {}
    for polygon in profile.get("polygons", []):
        alias_map[normalize_text(polygon.canonical_name)] = normalize_text(polygon.canonical_name)
        for alias in polygon.aliases:
            alias_map[normalize_text(alias)] = normalize_text(polygon.canonical_name)
    return alias_map


# Operational classification confirmed by the user: these polygons never
# consume HDIS values, even if a similarly named row appears in a response.
MANUAL_ONLY_POLYGONS = {
    'diamante': {'Diamante PIPA', 'FootPrint HW', 'FootPrint Fw'},
    'andes_norte': {'AN NORTE HW', 'AN NORTE FW', 'AN SUR HW',
                    'CABECERA HW', 'CABECERA FW NORTE', 'Monitoreo Post Evento FW'},
}
for _site_code, _names in MANUAL_ONLY_POLYGONS.items():
    _profile = LEGACY_SITE_PROFILES[_site_code]
    _profile['polygons'] = [
        replace(polygon, patterns=[r'(?!)'], source_scope=['local_manual_only'],
                notes='Exclusivamente manual; no consumir lecturas externas.')
        if polygon.canonical_name in _names else polygon
        for polygon in _profile['polygons']
    ]


def is_manual_only_object(site_code: str, object_code: str) -> bool:
    site_code = str(site_code or '').lower().replace('-', '_')
    canonical = build_alias_map(site_code).get(normalize_text(object_code), normalize_text(object_code))
    return any(normalize_text(p.canonical_name) == canonical and p.source_scope == ['local_manual_only']
               for p in LEGACY_SITE_PROFILES.get(site_code, {}).get('polygons', []))
