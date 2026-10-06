from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import unquote, urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from PIL import Image

from app.services.legacy_sync_profiles import LEGACY_SITE_PROFILES, normalize_text

STATE_WORDS = {"NORMAL", "ALERTA", "CENTRO", "SUPERIOR", "INFERIOR", "ALTA", "BAJA", "VERDE", "AMARILLO", "ROJO", "AZUL"}


@dataclass
class ParsedRow:
    name: str
    raw_text: str = ""
    image_url: Optional[str] = None
    detected_state: Optional[str] = None
    source_mode: str = "text"
    score: Optional[int] = None


@dataclass
class ParserMatch:
    expected_polygon: str
    matched_row_name: Optional[str]
    operational_state: Optional[str]
    source_mode: str
    score: Optional[int]
    image_url: Optional[str] = None
    raw_text: Optional[str] = None
    notes: str = ""


@dataclass
class ParserResult:
    states: Dict[str, str] = field(default_factory=dict)
    rows: List[ParsedRow] = field(default_factory=list)
    matches: List[ParserMatch] = field(default_factory=list)
    parser_type: str = ""
    content_type: str = ""
    endpoint_kind: str = ""
    raw_items_count: int = 0

    def as_dict(self) -> Dict[str, Any]:
        return {
            "states": self.states,
            "rows": [r.__dict__ for r in self.rows],
            "matches": [m.__dict__ for m in self.matches],
            "parser_type": self.parser_type,
            "content_type": self.content_type,
            "endpoint_kind": self.endpoint_kind,
            "raw_items_count": self.raw_items_count,
        }


def normalize_estado_text(raw: str | None) -> Optional[str]:
    t = normalize_text(raw)
    if not t:
        return None
    if any(token in t for token in ["estado png", "estado 1 png", "estado 2 png", "estado 3 png", "estado 4 png", "png", "jpg", "jpeg"]):
        return None
    if "centro" in t:
        return "centro"
    if "super" in t or "alta" in t or t == "rojo":
        return "superior"
    if "infer" in t or "baja" in t:
        return "inferior"
    if any(token in t for token in ["normal", "media", "verde", "ok"]):
        return "centro"
    if "amarillo" in t:
        return "amarillo"
    if "alerta" in t:
        return "alerta"
    return raw.strip().lower() if isinstance(raw, str) and raw.strip() else None


def _load_image_bytes(image_url: str) -> Optional[bytes]:
    parsed = urlparse(image_url or "")
    try:
        if parsed.scheme == "file":
            raw_path = unquote(parsed.path or "")
            if parsed.netloc:
                raw_path = f"//{parsed.netloc}{raw_path}"
            if re.match(r"^/[a-zA-Z]:", raw_path):
                raw_path = raw_path[1:]
            candidate = Path(raw_path)
            if candidate.exists():
                return candidate.read_bytes()
            filename = candidate.name
            for parent in candidate.parents:
                hits = list(parent.rglob(filename))
                if hits:
                    return hits[0].read_bytes()
            return None
        if parsed.scheme in {"http", "https"}:
            resp = requests.get(image_url, timeout=8, verify=False)
            resp.raise_for_status()
            return resp.content
        candidate = Path(image_url)
        if candidate.exists():
            return candidate.read_bytes()
    except Exception:
        return None
    return None


def detect_estado_from_png(image_url: str) -> Optional[str]:
    try:
        payload = _load_image_bytes(image_url)
        if not payload:
            return None
        image = Image.open(BytesIO(payload)).convert("RGBA")
        width, height = image.size
        inset = max(1, int(min(width, height) * 0.12))
        x0, y0 = inset, inset
        x1, y1 = max(x0 + 1, width - inset), max(y0 + 1, height - inset)

        cnt_red = cnt_blue = cnt_yellow = cnt_dark = cnt_visible = 0
        for y in range(y0, y1):
            for x in range(x0, x1):
                r, g, b, a = image.getpixel((x, y))
                if a < 40:
                    continue
                cnt_visible += 1
                maxc = max(r, g, b)
                minc = min(r, g, b)
                sat = ((maxc - minc) / maxc) if maxc else 0
                brightness = (r + g + b) / 3
                if brightness < 55 or sat < 0.18:
                    cnt_dark += 1
                    continue
                if r >= 110 and r > g + 28 and r > b + 28:
                    cnt_red += 1
                elif b >= 110 and b > g + 18 and b > r + 28:
                    cnt_blue += 1
                elif r >= 120 and g >= 120 and b < 90:
                    cnt_yellow += 1

        if cnt_red >= max(4, cnt_blue):
            return "superior"
        if cnt_blue >= 4:
            return "inferior"
        if cnt_yellow >= 4:
            return "amarillo"
        if cnt_visible and cnt_dark / cnt_visible >= 0.15:
            return "centro"
        return "centro"
    except Exception:
        return None


def _json_map(payload: dict) -> Dict[str, str]:
    if isinstance(payload.get("items"), list):
        result = {}
        for item in payload["items"]:
            name = item.get("nombre") or item.get("name") or item.get("polygon")
            state = item.get("estado") or item.get("state") or item.get("value")
            if name:
                result[str(name)] = str(state or "")
        return result
    if isinstance(payload.get("data"), list):
        result = {}
        for item in payload["data"]:
            if not isinstance(item, dict):
                continue
            name = item.get("nombre") or item.get("name") or item.get("polygon")
            state = item.get("estado") or item.get("state") or item.get("value")
            if name:
                result[str(name)] = str(state or "")
        return result
    return {str(k): str(v or "") for k, v in payload.items()}


def _extract_html_rows(html: str, endpoint_url: Optional[str] = None) -> List[ParsedRow]:
    soup = BeautifulSoup(html or "", "html.parser")
    local_asset_urls = _build_local_capture_img_map(soup, endpoint_url)
    rows: List[ParsedRow] = []
    for tr in soup.select("tr"):
        cells = tr.select("td,th")
        if len(cells) < 2:
            continue
        texts = [c.get_text(" ", strip=True) for c in cells]
        name = texts[0].strip() if texts else ""
        if not name:
            continue
        normalized_name = normalize_text(name)
        if normalized_name in {"poligonos sectores", "graficos", "estado", "ultimas 24 horas", "ultimos 7 dias"}:
            continue
        img = tr.select_one('img[src*="estado"]')
        raw_text = texts[1].strip() if len(texts) > 1 else ""
        img_url = None
        if img and img.get("src"):
            img_url = local_asset_urls.get(id(img)) or urljoin(endpoint_url or "", img.get("src"))
            raw_text = raw_text or Path(urlparse(img.get("src") or "").path).name
        if not img_url and not raw_text:
            continue
        rows.append(ParsedRow(name=name, raw_text=raw_text, image_url=img_url))
    return rows


def _build_local_capture_img_map(soup: BeautifulSoup, endpoint_url: Optional[str]) -> Dict[int, str]:
    endpoint_path = _resolve_local_endpoint_path(endpoint_url)
    if endpoint_path is None or not endpoint_path.exists():
        return {}

    lookup: Dict[int, str] = {}
    for index, img in enumerate(soup.select("img[src]"), start=1):
        candidate = _resolve_local_capture_asset(endpoint_path, index)
        if candidate is None:
            continue
        lookup[id(img)] = candidate.resolve().as_uri()
    return lookup


def _resolve_local_endpoint_path(endpoint_url: Optional[str]) -> Optional[Path]:
    if not endpoint_url:
        return None

    parsed = urlparse(endpoint_url)
    if parsed.scheme == "file":
        raw_path = unquote(parsed.path or "")
        if parsed.netloc:
            raw_path = f"//{parsed.netloc}{raw_path}"
        if re.match(r"^/[a-zA-Z]:", raw_path):
            raw_path = raw_path[1:]
        return Path(raw_path)

    candidate = Path(endpoint_url)
    return candidate if candidate.exists() else None


def _resolve_local_capture_asset(endpoint_path: Path, index: int) -> Optional[Path]:
    for candidate in sorted(endpoint_path.parent.glob(f"{endpoint_path.stem}__asset_{index}.*")):
        if candidate.is_file():
            return candidate
    return None


def _compute_score(expected: str, regexes: List[re.Pattern], row_name: str) -> int:
    k = normalize_text(expected)
    n = normalize_text(row_name)
    if not k or not n:
        return -1
    if n == k:
        return 100
    if n.startswith(k):
        return 85
    if k in n:
        return 70
    for rx in regexes:
        if rx.search(row_name or ""):
            return 55
    return -1


def _match_expected_polygons(site_code: str, rows: List[ParsedRow], endpoint_code: Optional[str] = None) -> ParserResult:
    profile = LEGACY_SITE_PROFILES.get(site_code, {})
    result = ParserResult(rows=rows, raw_items_count=len(rows))
    for polygon in profile.get("polygons", []):
        if polygon.source_scope and endpoint_code and endpoint_code not in polygon.source_scope:
            continue
        best_row: Optional[ParsedRow] = None
        best_score = -1
        regexes = polygon.regexes()
        for row in rows:
            score = _compute_score(polygon.canonical_name, regexes, row.name)
            if score > best_score:
                best_score = score
                best_row = row
            elif score == best_score and score >= 0 and best_row is not None:
                if row.image_url and not best_row.image_url:
                    best_row = row
                elif bool(row.image_url) == bool(best_row.image_url) and len(normalize_text(row.name)) < len(normalize_text(best_row.name)):
                    best_row = row
        state = None
        source_mode = "none"
        if best_row and best_score >= 0:
            if best_row.image_url:
                state = detect_estado_from_png(best_row.image_url)
                if state:
                    source_mode = "image"
            if not state and best_row.raw_text:
                state = normalize_estado_text(best_row.raw_text)
                if state:
                    source_mode = "text"
            if state:
                result.states[polygon.canonical_name] = state
            result.matches.append(
                ParserMatch(
                    expected_polygon=polygon.canonical_name,
                    matched_row_name=best_row.name,
                    operational_state=state,
                    source_mode=source_mode,
                    score=best_score,
                    image_url=best_row.image_url,
                    raw_text=best_row.raw_text,
                    notes=polygon.notes,
                )
            )
        else:
            result.matches.append(
                ParserMatch(
                    expected_polygon=polygon.canonical_name,
                    matched_row_name=None,
                    operational_state=None,
                    source_mode="missing",
                    score=None,
                    notes=polygon.notes or "Sin fila compatible en payload.",
                )
            )
    return result


def parse_json_direct(text: str) -> ParserResult:
    payload = json.loads(text or "{}")
    states = _json_map(payload)
    rows = [ParsedRow(name=k, raw_text=str(v or ""), detected_state=normalize_estado_text(v), source_mode="json") for k, v in states.items()]
    result = ParserResult(states=states, rows=rows, raw_items_count=len(rows), endpoint_kind="json")
    for row in rows:
        result.matches.append(
            ParserMatch(expected_polygon=row.name, matched_row_name=row.name, operational_state=row.raw_text or None, source_mode="json", score=100, raw_text=row.raw_text)
        )
    return result


def parse_payload_detail(
    parser_type: str,
    text: str,
    content_type: str,
    *,
    endpoint_url: Optional[str] = None,
    endpoint_code: Optional[str] = None,
    site_code: Optional[str] = None,
) -> ParserResult:
    parser_type = (parser_type or "mock").lower()
    result: ParserResult
    if parser_type == "json_direct":
        result = parse_json_direct(text)
    elif parser_type == "legacy_andesita" and "json" in (content_type or "").lower():
        try:
            payload = json.loads(text or "{}")
        except json.JSONDecodeError:
            rows = _extract_html_rows(text, endpoint_url)
            for row in rows:
                if row.image_url:
                    row.detected_state = detect_estado_from_png(row.image_url)
                    row.source_mode = "image" if row.detected_state else row.source_mode
                if not row.detected_state and row.raw_text:
                    row.detected_state = normalize_estado_text(row.raw_text)
                    row.source_mode = "text" if row.detected_state else row.source_mode
            result = _match_expected_polygons(site_code or "andesita", rows, endpoint_code=endpoint_code)
            result.endpoint_kind = "html_fallback"
        else:
            states = _json_map(payload)
            rows = [ParsedRow(name=k, raw_text=str(v or ""), detected_state=normalize_estado_text(v), source_mode="json") for k, v in states.items()]
            result = _match_expected_polygons(site_code or "andesita", rows, endpoint_code=endpoint_code)
            for row in result.rows:
                row.detected_state = normalize_estado_text(row.raw_text)
                row.source_mode = "json"
    else:
        rows = _extract_html_rows(text, endpoint_url)
        for row in rows:
            if row.image_url:
                row.detected_state = detect_estado_from_png(row.image_url)
                row.source_mode = "image" if row.detected_state else row.source_mode
            if not row.detected_state and row.raw_text:
                row.detected_state = normalize_estado_text(row.raw_text)
                row.source_mode = "text" if row.detected_state else row.source_mode
        effective_site = site_code or {
            "legacy_diamante": "diamante",
            "legacy_andes_norte": "andes_norte",
            "legacy_andesita": "andesita",
            "legacy_pilar_norte": "pilar_norte",
            "legacy_esmeralda": "esmeralda",
        }.get(parser_type, "")
        if effective_site:
            result = _match_expected_polygons(effective_site, rows, endpoint_code=endpoint_code)
        else:
            result = ParserResult(rows=rows, raw_items_count=len(rows))
            for row in rows:
                if row.detected_state:
                    result.states[row.name] = row.detected_state
    result.parser_type = parser_type
    result.content_type = content_type or ""
    if not result.endpoint_kind:
        result.endpoint_kind = "json" if "json" in (content_type or "").lower() else "html"
    return result


def parse_payload(parser_type: str, text: str, content_type: str, **kwargs) -> Dict[str, str]:
    return parse_payload_detail(parser_type, text, content_type, **kwargs).states
