from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import io
import json
import os
import re
import traceback
from collections import defaultdict
from datetime import date, datetime, time as dtime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional

import pandas as pd
from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import StreamingResponse
from ollama import AsyncClient, Client
from pydantic import BaseModel, Field, ValidationError
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession
from unidecode import unidecode

from app.core.config import settings
from app.data.faq_responses import find_faq_entry
from app.data.ia_system_queries import (
    MCPFilter,
    build_sql_with_filters,
    find_system_query,
    parse_date_safe,
    parse_time_safe,
)
from app.data.ia_tables_metadata import IA_TABLES
from app.db.db import get_db

router = APIRouter(prefix="/mcp", tags=["mcp"])

MODEL_CAPABILITY_TERMS = (
    "modelo de datos",
    "data model",
    "esquema",
    "schema",
    "que datos puedes entregar",
    "que datos puedes consultar",
    "que informacion puedes entregar",
    "que informacion puedes consultar",
    "que tablas puedes consultar",
    "tablas disponibles",
    "fuentes disponibles",
    "que puede ver la ia",
    "que puede consultar la ia",
)

SECRET_TERMS = (
    "hashed_password",
    "password",
    "contrasena",
    "contraseña",
    "secret",
    "secret_key",
    "api key",
    "apikey",
    "token",
    "jwt",
    "credencial",
    "credenciales",
    "usuarios del sistema",
    "tabla users",
    "connection string",
    "cadena de conexion",
)

MUTATION_TERMS = (
    " delete ",
    " update ",
    " insert ",
    " drop ",
    " truncate ",
    " alter ",
    " borra ",
    " elimina ",
    " modifica ",
    " actualiza la base",
    " cambia la data",
    " resetea ",
    " crea usuario del sistema",
)

SENSITIVE_COLUMN_TERMS = (
    "password",
    "secret",
    "token",
    "hash",
    "apikey",
    "credential",
)

VAGUE_PATTERNS = {
    "que pasa",
    "que esta pasando",
    "que ocurre",
    "analiza",
    "resumen",
    "necesito ayuda",
    "informacion",
}

DEFAULT_FOLLOW_UPS = [
    "Puedo enfocarlo en una zona especifica si me indicas cual.",
    "Si quieres, tambien lo acoto por fecha o por tipo de entidad.",
    "Puedo convertirlo en una consulta de datos o en una recomendacion operativa.",
]

DEFAULT_CHAT_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b-instruct")
DEFAULT_OLLAMA_HOST = (
    os.getenv("OLLAMA_BASE_URL")
    or os.getenv("OLLAMA_HOST")
    or "http://127.0.0.1:11434"
)
FALLBACK_CHAT_MODELS = ()
EXPORT_TOKEN_TTL_HOURS = int(os.getenv("MCP_EXPORT_TOKEN_TTL_HOURS", "24"))
MAX_SQL_ROWS = int(os.getenv("MCP_MAX_ROWS", "250"))
OLLAMA_LIST_TIMEOUT_SECONDS = float(os.getenv("OLLAMA_LIST_TIMEOUT_SECONDS", "30"))
OLLAMA_CHAT_TIMEOUT_SECONDS = float(os.getenv("OLLAMA_CHAT_TIMEOUT_SECONDS", "60"))
OLLAMA_STATUS_TIMEOUT_SECONDS = float(
    os.getenv("OLLAMA_STATUS_TIMEOUT_SECONDS", str(OLLAMA_LIST_TIMEOUT_SECONDS))
)
OLLAMA_MAX_MODEL_ATTEMPTS = int(os.getenv("OLLAMA_MAX_MODEL_ATTEMPTS", "1"))

_MINING_SYNONYMS_CACHE: Optional[dict] = None


class MCPHistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class MCPConsultaRequest(BaseModel):
    fecha_inicio: Optional[date] = None
    fecha_fin: Optional[date] = None
    cargo_id: Optional[int] = None
    cargo: Optional[str] = None
    site: Optional[str] = None
    zonas: List[str] = Field(default_factory=list)
    active_module: Optional[str] = None
    active_path: Optional[str] = None
    pregunta: Optional[str] = None
    message: Optional[str] = None
    mode: Literal["auto", "datos", "analisis", "ayuda"] = "auto"
    history: List[MCPHistoryMessage] = Field(default_factory=list)

    def get_question(self) -> str:
        if self.pregunta and self.pregunta.strip():
            return self.pregunta.strip()
        if self.message and self.message.strip():
            return self.message.strip()
        return ""


class MCPTabla(BaseModel):
    title: str
    columns: List[str]
    rows: List[Dict[str, Any]]


class MCPChart(BaseModel):
    title: str
    type: str
    config: Dict[str, Any] = Field(default_factory=dict)
    data: Optional[Dict[str, Any]] = None


class MCPStructuredAnswer(BaseModel):
    headline: str
    summary: str
    details: List[str] = Field(default_factory=list)
    evidence: List[str] = Field(default_factory=list)
    actions: List[str] = Field(default_factory=list)
    follow_ups: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    clarification_question: Optional[str] = None
    confidence: Literal["alta", "media", "baja"] = "media"


class MCPConsultaResponse(BaseModel):
    answer: str
    structured: Optional[MCPStructuredAnswer] = None
    tables: List[MCPTabla] = Field(default_factory=list)
    charts: List[MCPChart] = Field(default_factory=list)
    export_token: Optional[str] = None
    mode: str = "auto"
    sources: List[str] = Field(default_factory=list)
    model: Optional[str] = None


def _load_mining_synonyms() -> dict:
    global _MINING_SYNONYMS_CACHE
    if _MINING_SYNONYMS_CACHE is not None:
        return _MINING_SYNONYMS_CACHE

    base_dir = os.path.dirname(__file__)
    json_path = os.path.abspath(os.path.join(base_dir, "..", "data", "mining_synonyms.json"))
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            _MINING_SYNONYMS_CACHE = json.load(f)
    except Exception:
        _MINING_SYNONYMS_CACHE = {}
    return _MINING_SYNONYMS_CACHE


def normalize(text: str) -> str:
    return unidecode((text or "").lower().strip())


def _get_ollama_host() -> str:
    return (
        os.getenv("OLLAMA_BASE_URL")
        or os.getenv("OLLAMA_HOST")
        or DEFAULT_OLLAMA_HOST
    )


def _normalize_model_name(name: Optional[str]) -> str:
    return (name or "").strip().lower()


def _preferred_model_candidates(configured_model: str) -> List[str]:
    candidates = [configured_model, DEFAULT_CHAT_MODEL, *FALLBACK_CHAT_MODELS]
    deduped: List[str] = []
    seen: set[str] = set()

    for item in candidates:
        normalized = _normalize_model_name(item)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(item)

    return deduped


def _resolve_available_model(configured_model: str, available_models: List[str]) -> tuple[str, bool]:
    cleaned_models = [model for model in available_models if model]
    if not cleaned_models:
        return configured_model, False

    for candidate in _preferred_model_candidates(configured_model):
        candidate_norm = _normalize_model_name(candidate)

        exact_match = next(
            (model for model in cleaned_models if _normalize_model_name(model) == candidate_norm),
            None,
        )
        if exact_match:
            return exact_match, _normalize_model_name(exact_match) != _normalize_model_name(configured_model)

        prefix_match = next(
            (model for model in cleaned_models if _normalize_model_name(model).startswith(candidate_norm)),
            None,
        )
        if prefix_match:
            return prefix_match, _normalize_model_name(prefix_match) != _normalize_model_name(configured_model)

    preferred_families = [
        _normalize_model_name(item).split(":")[0]
        for item in _preferred_model_candidates(configured_model)
        if _normalize_model_name(item)
    ]

    for family in preferred_families:
        family_matches = [
            model
            for model in cleaned_models
            if _normalize_model_name(model).split(":")[0] == family
        ]
        if family_matches:
            instruct_match = next(
                (model for model in family_matches if "instruct" in _normalize_model_name(model)),
                family_matches[0],
            )
            return instruct_match, _normalize_model_name(instruct_match) != _normalize_model_name(configured_model)

    first_model = cleaned_models[0]
    return first_model, _normalize_model_name(first_model) != _normalize_model_name(configured_model)


def _resolve_available_models(configured_model: str, available_models: List[str]) -> List[str]:
    cleaned_models = [model for model in available_models if model]
    if not cleaned_models:
        return _preferred_model_candidates(configured_model)[:OLLAMA_MAX_MODEL_ATTEMPTS]

    resolved: List[str] = []
    seen: set[str] = set()

    def add_model(name: Optional[str]) -> None:
        normalized = _normalize_model_name(name)
        if not normalized or normalized in seen:
            return
        seen.add(normalized)
        resolved.append(name)  # type: ignore[arg-type]

    primary_model, _ = _resolve_available_model(configured_model, cleaned_models)
    add_model(primary_model)

    for candidate in _preferred_model_candidates(configured_model):
        candidate_norm = _normalize_model_name(candidate)
        exact_match = next(
            (model for model in cleaned_models if _normalize_model_name(model) == candidate_norm),
            None,
        )
        if exact_match:
            add_model(exact_match)
            continue

        prefix_match = next(
            (model for model in cleaned_models if _normalize_model_name(model).startswith(candidate_norm)),
            None,
        )
        if prefix_match:
            add_model(prefix_match)

    if not resolved and cleaned_models:
        add_model(cleaned_models[0])

    return resolved[:OLLAMA_MAX_MODEL_ATTEMPTS]


def _collapse_ai_text(text: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


def _is_low_signal_ai_text(text: Optional[str], *, min_alnum: int = 10) -> bool:
    collapsed = _collapse_ai_text(text)
    if not collapsed:
        return True

    lowered = collapsed.lower()
    if lowered in {"0", "1", "[]", "{}", '""', "''", "null", "none", "...", "```"}:
        return True

    if re.fullmatch(r"[\W\d_]+", collapsed):
        return True

    alnum = re.sub(r"[^0-9a-zA-ZáéíóúÁÉÍÓÚñÑüÜ]+", "", collapsed)
    if len(alnum) < min_alnum:
        return True

    words = [item for item in collapsed.split(" ") if item]
    if len(words) <= 2 and len(alnum) < max(min_alnum, 18):
        return True

    return False


def _looks_like_json_payload(text: Optional[str]) -> bool:
    if not text:
        return False

    collapsed = _collapse_ai_text(text)
    if not collapsed:
        return False

    return bool(
        re.search(
            r"\{[^}]*\b(?:\\\"headline\\\"|\\\"summary\\\"|\\\"details\\\"|\\\"evidence\\\"|\\\"actions\\\")[^}]*\}",
            collapsed,
            re.DOTALL,
        )
    )


def _structured_answer_is_usable(structured: MCPStructuredAnswer) -> bool:
    if _looks_like_json_payload(structured.headline):
        return False

    if _looks_like_json_payload(structured.summary):
        return False

    if _is_low_signal_ai_text(structured.headline, min_alnum=6):
        return False

    if _is_low_signal_ai_text(structured.summary, min_alnum=14):
        return False

    meaningful_sections = 0
    for section in (structured.details, structured.evidence, structured.actions):
        if any(not _is_low_signal_ai_text(item, min_alnum=8) for item in section or []):
            meaningful_sections += 1

    clarification_ok = not structured.clarification_question or not _is_low_signal_ai_text(
        structured.clarification_question,
        min_alnum=8,
    )

    if not clarification_ok:
        return False

    # Evita aceptar salidas casi vacias como "0", "1" o texto residual sin contenido operacional.
    return meaningful_sections > 0 or not _is_low_signal_ai_text(structured.summary, min_alnum=20)


def _extract_ollama_message_content(response: Any) -> str:
    if isinstance(response, dict):
        return ((response.get("message") or {}).get("content") or "").strip()

    message_obj = getattr(response, "message", None)
    return (getattr(message_obj, "content", None) or "").strip()


def _extract_json_object(text: str) -> Optional[str]:
    start = text.find("{")
    if start < 0:
        return None

    depth = 0
    in_string = False
    escaped = False

    for idx, char in enumerate(text[start:], start=start):
        if escaped:
            escaped = False
            continue

        if char == "\\":
            escaped = True
            continue

        if char == '"':
            in_string = not in_string
            continue

        if in_string:
            continue

        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start : idx + 1]

    return None


def _parse_ollama_structured_answer(content: str) -> MCPStructuredAnswer:
    structured = None

    try:
        structured = MCPStructuredAnswer.model_validate_json(content)
    except ValidationError:
        json_payload = _extract_json_object(content)
        if json_payload:
            try:
                structured = MCPStructuredAnswer.model_validate_json(json_payload)
            except ValidationError:
                structured = None

    if structured is None:
        structured = MCPStructuredAnswer(
            headline="Respuesta del agente",
            summary=content,
            follow_ups=DEFAULT_FOLLOW_UPS,
            confidence="media",
        )

    if not structured.follow_ups:
        structured.follow_ups = DEFAULT_FOLLOW_UPS

    return structured


def _is_capability_question(question: str) -> bool:
    q_norm = normalize(question)
    return any(term in q_norm for term in MODEL_CAPABILITY_TERMS)


def _detect_blocked_request(question: str) -> Optional[MCPStructuredAnswer]:
    q_norm = f" {normalize(question)} "

    if any(term in q_norm for term in SECRET_TERMS):
        return MCPStructuredAnswer(
            headline="Solicitud bloqueada por seguridad",
            summary=(
                "Puedo ayudarte con datos operacionales y explicaciones del sistema, "
                "pero no entrego usuarios del sistema, credenciales, tokens, claves ni secretos."
            ),
            details=[
                "La politica del agente es de solo lectura.",
                "Las credenciales, hashes y secretos quedan fuera del alcance del asistente.",
            ],
            actions=[
                "Pide un resumen operativo, una consulta de datos o una explicacion del modelo disponible.",
            ],
            follow_ups=[
                "Que informacion operacional si puedes mostrarme ahora mismo?",
                "Que tablas y campos del modelo de datos tienes habilitados?",
            ],
            warnings=["Acceso denegado a informacion sensible del sistema."],
            confidence="alta",
        )

    if any(term in q_norm for term in MUTATION_TERMS) or re.search(
        r"\b(delete|update|insert|drop|truncate|alter)\b", q_norm
    ):
        return MCPStructuredAnswer(
            headline="Operacion no permitida",
            summary=(
                "Este agente no realiza cambios en la aplicacion ni modifica registros de la base de datos."
            ),
            details=[
                "Solo puede leer informacion, resumirla y ayudarte a interpretarla.",
                "Si necesitas cambios, esa accion debe ejecutarse fuera del agente y con control humano.",
            ],
            actions=[
                "Puedo indicarte que datos revisar antes de hacer un cambio manual.",
                "Tambien puedo ayudarte a validar el impacto de una modificacion propuesta.",
            ],
            follow_ups=[
                "Que datos deberia revisar antes de cambiar esa configuracion?",
                "Hazme un diagnostico de solo lectura sobre el estado actual.",
            ],
            warnings=["Politica de solo lectura activa."],
            confidence="alta",
        )

    return None


def _detect_vague_request(question: str, payload: MCPConsultaRequest) -> Optional[MCPStructuredAnswer]:
    q_norm = normalize(question)
    if payload.zonas or payload.site or payload.fecha_inicio or payload.fecha_fin:
        return None

    if len(q_norm) < 12 or q_norm in VAGUE_PATTERNS:
        return MCPStructuredAnswer(
            headline="Necesito un poco mas de contexto",
            summary="Puedo ayudarte mejor si defines que quieres revisar.",
            details=[
                "Puedes pedirme un resumen operativo, una consulta puntual de datos o un analisis guiado.",
            ],
            actions=[
                "Indica una zona, un sitio o un rango de fechas para aterrizar la respuesta.",
            ],
            follow_ups=[
                "Dame un resumen operativo del sitio principal de hoy.",
                "Muestrame personas y vehiculos dentro actualmente.",
                "Sugiere riesgos y acciones operativas visibles ahora mismo.",
            ],
            clarification_question="Quieres foco en monitoreo, alertas, control operacional o datos historicos?",
            confidence="alta",
        )
    return None


def _render_plain_answer(structured: MCPStructuredAnswer) -> str:
    lines = [structured.headline, "", structured.summary]

    if structured.clarification_question:
        lines.extend(["", f"Pregunta de aclaracion: {structured.clarification_question}"])
    if structured.details:
        lines.extend(["", "Detalles:"])
        lines.extend(f"- {item}" for item in structured.details)
    if structured.evidence:
        lines.extend(["", "Datos destacados:"])
        lines.extend(f"- {item}" for item in structured.evidence)
    if structured.actions:
        lines.extend(["", "Siguiente paso sugerido:"])
        lines.extend(f"- {item}" for item in structured.actions)
    if structured.follow_ups:
        lines.extend(["", "Puedes seguir con:"])
        lines.extend(f"- {item}" for item in structured.follow_ups)
    if structured.warnings:
        lines.extend(["", "Advertencias:"])
        lines.extend(f"- {item}" for item in structured.warnings)

    return "\n".join(lines).strip()


def _row_to_highlight(row: Dict[str, Any], max_pairs: int = 3) -> str:
    pairs: List[str] = []
    for key, value in row.items():
        if value is None or value == "":
            continue
        label = key.replace("_", " ")
        pairs.append(f"{label}: {value}")
        if len(pairs) >= max_pairs:
            break
    return " | ".join(pairs)


def _build_row_highlights(rows: List[Dict[str, Any]], max_items: int = 3) -> List[str]:
    highlights: List[str] = []
    for row in rows[:max_items]:
        line = _row_to_highlight(row)
        if line:
            highlights.append(line)
    return highlights


def _sanitize_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    sanitized: List[Dict[str, Any]] = []
    for row in rows:
        cleaned: Dict[str, Any] = {}
        for key, value in row.items():
            key_norm = normalize(key)
            if any(term in key_norm for term in SENSITIVE_COLUMN_TERMS):
                cleaned[key] = "[RESTRINGIDO]"
            else:
                cleaned[key] = value
        sanitized.append(cleaned)
    return sanitized


def _sign_payload(raw_payload: bytes) -> str:
    return hmac.new(
        settings.secret_key.encode("utf-8"),
        raw_payload,
        hashlib.sha256,
    ).hexdigest()


def create_export_token(query_id: str, sql: str, params: Dict[str, Any], title: str) -> str:
    payload = {
        "q": query_id,
        "sql": sql,
        "params": params,
        "title": title,
        "iat": datetime.now(timezone.utc).isoformat(),
    }
    raw_payload = json.dumps(payload, default=str, sort_keys=True).encode("utf-8")
    envelope = {
        "payload": base64.urlsafe_b64encode(raw_payload).decode("utf-8"),
        "sig": _sign_payload(raw_payload),
    }
    return base64.urlsafe_b64encode(json.dumps(envelope).encode("utf-8")).decode("utf-8")


def decode_export_token(token: str) -> Dict[str, Any]:
    try:
        raw_envelope = base64.urlsafe_b64decode(token.encode("utf-8"))
        envelope = json.loads(raw_envelope.decode("utf-8"))

        encoded_payload = envelope["payload"]
        signature = envelope["sig"]

        raw_payload = base64.urlsafe_b64decode(encoded_payload.encode("utf-8"))
        expected_signature = _sign_payload(raw_payload)
        if not hmac.compare_digest(signature, expected_signature):
            raise HTTPException(status_code=400, detail="Token de exportacion invalido.")

        payload = json.loads(raw_payload.decode("utf-8"))
        issued_at_raw = payload.get("iat")
        if issued_at_raw:
            issued_at = datetime.fromisoformat(issued_at_raw.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) - issued_at > timedelta(hours=EXPORT_TOKEN_TTL_HOURS):
                raise HTTPException(
                    status_code=400,
                    detail="El token de exportacion expiro. Ejecuta la consulta nuevamente.",
                )

        return payload
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Token de exportacion invalido o corrupto.",
        )


def _detect_date_range_from_question(q: str) -> tuple[Optional[date], Optional[date], List[str]]:
    msgs: List[str] = []
    today = date.today()
    q_norm = normalize(q)

    start: Optional[date] = None
    end: Optional[date] = None

    m = re.search(
        r"entre\s+(\d{1,2}[-/]\d{1,2}[-/]\d{4})\s+y\s+(\d{1,2}[-/]\d{1,2}[-/]\d{4})",
        q_norm,
    )
    if m:
        d1 = parse_date_safe(m.group(1))
        d2 = parse_date_safe(m.group(2))
        if d1 and d2:
            start, end = sorted([d1, d2])
            msgs.append(f"Interprete el rango de fechas como {start} -> {end}.")
            return start, end, msgs

    if "hoy" in q_norm and "ayer" not in q_norm:
        start = end = today
        msgs.append(f"Interprete el rango de fechas como solo hoy ({today}).")
        return start, end, msgs

    if "ayer" in q_norm and "hoy" not in q_norm:
        start = end = today - timedelta(days=1)
        msgs.append(f"Interprete el rango de fechas como solo ayer ({start}).")
        return start, end, msgs

    if "esta semana" in q_norm or "ultima semana" in q_norm or "semana pasada" in q_norm:
        end = today
        start = today - timedelta(days=7)
        msgs.append(f"Interprete el rango de fechas como la ultima semana ({start} -> {end}).")
        return start, end, msgs

    if "este mes" in q_norm:
        start = today.replace(day=1)
        end = today
        msgs.append(f"Interprete el rango de fechas como este mes ({start} -> {end}).")
        return start, end, msgs

    if "mes pasado" in q_norm:
        first_this_month = today.replace(day=1)
        end = first_this_month - timedelta(days=1)
        start = end.replace(day=1)
        msgs.append(f"Interprete el rango de fechas como mes pasado ({start} -> {end}).")
        return start, end, msgs

    return None, None, msgs


def _detect_time_range_from_question(q: str) -> tuple[Optional[dtime], Optional[dtime], List[str]]:
    msgs: List[str] = []
    q_norm = normalize(q)

    m = re.search(
        r"(\d{1,2}(?::\d{2})?)\s*(am|pm)?\s*(?:a|hasta|-)\s*(\d{1,2}(?::\d{2})?)\s*(am|pm)?",
        q_norm,
    )
    if not m:
        return None, None, msgs

    h1_str = (m.group(1) or "").strip()
    h1_ampm = (m.group(2) or "").strip()
    h2_str = (m.group(3) or "").strip()
    h2_ampm = (m.group(4) or "").strip()

    raw1 = h1_str + (h1_ampm if h1_ampm else "")
    raw2 = h2_str + (h2_ampm if h2_ampm else "")

    t1 = parse_time_safe(raw1) if raw1 else None
    t2 = parse_time_safe(raw2) if raw2 else None

    if t1 and t2:
        msgs.append(f"Interprete el rango horario como {t1} -> {t2}.")
        return t1, t2, msgs

    return None, None, msgs


def _extract_filters_for_system_query(
    question: str,
    body: MCPConsultaRequest,
    system_query: Dict[str, Any],
) -> tuple[List[MCPFilter], List[str]]:
    filters: List[MCPFilter] = []
    info_msgs: List[str] = []

    q_norm = normalize(question)
    q = question
    meta_filters: Dict[str, Dict[str, Any]] = system_query.get("filters", {})

    def append_filter(field: str, value: Any, ftype: str = "string", op: str = "ilike") -> None:
        filters.append(MCPFilter(field=field, type=ftype, op=op, value=value))

    start_date: Optional[date] = body.fecha_inicio
    end_date: Optional[date] = body.fecha_fin
    if not start_date and not end_date and "fecha" in meta_filters:
        d1, d2, msgs = _detect_date_range_from_question(q)
        info_msgs.extend(msgs)
        if d1 or d2:
            start_date, end_date = d1, d2

    if start_date or end_date:
        filters.append(
            MCPFilter(
                field="fecha",
                type="datetime_range",
                op="between",
                value_from=start_date,
                value_to=end_date,
            )
        )

    if "hora" in meta_filters:
        t1, t2, msgs = _detect_time_range_from_question(q)
        info_msgs.extend(msgs)
        if t1 or t2:
            filters.append(
                MCPFilter(
                    field="hora",
                    type="time_range",
                    op="between",
                    value_from=t1,
                    value_to=t2,
                )
            )

    if body.cargo and "cargo" in meta_filters:
        append_filter("cargo", body.cargo)
        info_msgs.append(f"Considere el cargo '{body.cargo}' como contexto de la consulta.")

    if body.site:
        if "sitio" in meta_filters:
            append_filter("sitio", body.site)
            info_msgs.append(f"Filtre el sitio como '{body.site}'.")
        elif "site" in meta_filters:
            append_filter("site", body.site)
            info_msgs.append(f"Filtre el sitio como '{body.site}'.")

    if body.zonas:
        first_zone = body.zonas[0]
        if "zona" in meta_filters:
            append_filter("zona", first_zone)
            info_msgs.append(f"Filtre la zona como '{first_zone}'.")
        elif "nivel" in meta_filters:
            append_filter("nivel", first_zone)
            info_msgs.append(f"Filtre el nivel como '{first_zone}'.")

    if "direccion" in meta_filters:
        if any(term in q_norm for term in ("salidas", "salida", "egresos", "egreso")):
            filters.append(MCPFilter(field="direccion", type="enum", op="eq", value="out"))
            info_msgs.append("Interprete la direccion como salida.")
        elif any(term in q_norm for term in ("entradas", "entrada", "ingresos", "ingreso")):
            filters.append(MCPFilter(field="direccion", type="enum", op="eq", value="in"))
            info_msgs.append("Interprete la direccion como entrada.")

    if "activos" in meta_filters and "activo" in q_norm:
        filters.append(MCPFilter(field="activos", type="bool", op="eq", value=True))
        info_msgs.append("Interprete que solicitaste solo registros activos.")

    if ("nivel" in meta_filters or "zona" in meta_filters) and not body.zonas:
        for token in ("np", "ucl", "nti", "oficina"):
            if re.search(rf"\b{token}\b", q_norm):
                field = "nivel" if "nivel" in meta_filters else "zona"
                append_filter(field, token.upper())
                info_msgs.append(f"Interprete el filtro {field} como '{token.upper()}'.")
                break

    if "persona" in meta_filters:
        for kw in ("entradas de", "ingresos de", "accesos de", "buscar persona", "trabajador"):
            idx = q_norm.find(kw)
            if idx != -1:
                rest = q[idx + len(kw) :]
                for sep in (" en ", " al ", " a ", " durante ", " entre ", " por "):
                    pos = rest.lower().find(sep)
                    if pos != -1:
                        rest = rest[:pos]
                        break
                persona = rest.strip(" ,.:")
                if persona:
                    append_filter("persona", persona)
                    info_msgs.append(f"Interprete que la persona consultada es '{persona}'.")
                break

    if "portico" in meta_filters:
        for kw in ("portico", "pórtico"):
            if kw in q_norm:
                idx = q_norm.find(kw)
                rest = q[idx + len(kw) :].strip()
                parts = rest.split()
                if parts:
                    append_filter("portico", parts[0].strip(" ,.:"))
                    info_msgs.append(f"Interprete que el portico consultado es '{parts[0].strip(' ,.:')}'.")
                break

    if "empresa" in meta_filters and "empresa" in q_norm:
        idx = q_norm.find("empresa")
        empresa = q[idx + len("empresa") :].strip(" :,-.")
        if empresa:
            append_filter("empresa", empresa)
            info_msgs.append(f"Interprete que la empresa consultada es '{empresa}'.")

    return filters, info_msgs


async def _build_exposed_catalog(db: AsyncSession) -> List[Dict[str, Any]]:
    result = await db.execute(
        sa_text(
            """
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
            ORDER BY table_name, ordinal_position;
            """
        )
    )

    live_columns: Dict[str, List[str]] = defaultdict(list)
    for row in result.mappings().all():
        live_columns[row["table_name"]].append(row["column_name"])

    catalog: List[Dict[str, Any]] = []
    for logical_name, meta in IA_TABLES.items():
        if not meta.get("expose"):
            continue

        table_name = meta["table"]
        if table_name not in live_columns:
            continue

        columns: List[Dict[str, str]] = []
        for column_name, column_meta in meta.get("columns", {}).items():
            if not column_meta.get("expose"):
                continue
            if column_name not in live_columns[table_name]:
                continue
            columns.append(
                {
                    "name": column_name,
                    "label": column_meta.get("label", column_name.replace("_", " ")),
                    "type": column_meta.get("type", "string"),
                }
            )

        if columns:
            catalog.append(
                {
                    "id": logical_name,
                    "table": table_name,
                    "description": meta.get("description", logical_name),
                    "columns": columns,
                }
            )

    return catalog


async def _build_capability_response(
    question: str,
    db: AsyncSession,
) -> MCPConsultaResponse:
    catalog = await _build_exposed_catalog(db)
    table_lines = [
        f"{item['table']}: {item['description']} ({', '.join(col['label'] for col in item['columns'][:5])})"
        for item in catalog[:8]
    ]

    structured = MCPStructuredAnswer(
        headline="Capacidades de datos habilitadas",
        summary=(
            f"Tengo acceso de solo lectura a {len(catalog)} estructuras del modelo expuesto para IA. "
            "Puedo consultar personas, vehiculos, porticos, eventos de acceso, agentes ambientales, zonas y vistas resumidas."
        ),
        details=[
            "El catalogo se cruza contra la base de datos usando information_schema y metadata interna del agente.",
            "Solo se exponen tablas y columnas marcadas como aptas para IA.",
        ],
        evidence=table_lines,
        actions=[
            "Pide una consulta con fecha, sitio o zona para responder con datos concretos.",
            "Si quieres, te explico una tabla especifica y que campos puedo usar de ella.",
        ],
        follow_ups=[
            "Que informacion puedes entregar sobre personas y vehiculos dentro actualmente?",
            "Muestrame las tablas que usas para agentes ambientales y alertas.",
            "Explicame como consultas eventos de acceso y permanencias.",
        ],
        warnings=[
            "No se exponen usuarios del sistema, claves, secretos ni operaciones de escritura.",
        ],
        confidence="alta",
    )

    return MCPConsultaResponse(
        answer=_render_plain_answer(structured),
        structured=structured,
        mode="catalog",
        sources=["information_schema", "IA_TABLES metadata"],
        model=None,
    )


async def _build_operational_context(body: MCPConsultaRequest, db: AsyncSession) -> str:
    question = normalize(body.get_question())
    if not any(
        kw in question
        for kw in (
            "riesgo",
            "alerta",
            "estado",
            "zona",
            "persona",
            "vehiculo",
            "vehículo",
            "acceso",
            "clima",
            "semaforo",
            "semaforo",
            "monitoreo",
            "operativo",
        )
    ):
        return ""

    params: Dict[str, Any] = {}
    filters: List[str] = []
    if body.site:
        filters.append("ap.site = :site")
        params["site"] = body.site
    if body.zonas:
        filters.append("i.zone = :zone")
        params["zone"] = body.zonas[0]

    where_clause = f"WHERE {' AND '.join(filters)}" if filters else ""

    current_sql = sa_text(
        f"""
        SELECT
            COALESCE(i.zone, 'SIN_ZONA') AS zone,
            COUNT(*) FILTER (WHERE i.entity_type = 'person') AS personas,
            COUNT(*) FILTER (WHERE i.entity_type = 'vehicle') AS vehiculos,
            COUNT(*) FILTER (WHERE i.entity_type = 'equipment') AS equipos
        FROM vw_access_interior i
        LEFT JOIN access_portico ap ON ap.id = i.portico_id
        {where_clause}
        GROUP BY COALESCE(i.zone, 'SIN_ZONA')
        ORDER BY personas DESC, vehiculos DESC, zone ASC
        LIMIT 5;
        """
    )
    current_rows = (await db.execute(current_sql, params)).mappings().all()

    lines: List[str] = []
    if current_rows:
        lines.append("Resumen actual de presencia por zona:")
        for row in current_rows:
            lines.append(
                f"- {row['zone']}: personas={row['personas']}, vehiculos={row['vehiculos']}, equipos={row['equipos']}."
            )

    if any(kw in question for kw in ("riesgo", "alerta", "clima", "semaforo", "temperatura", "co2", "co ")):
        climate_filters: List[str] = []
        climate_params: Dict[str, Any] = {}
        if body.site:
            climate_filters.append("ap.site = :site")
            climate_params["site"] = body.site
        if body.zonas:
            climate_filters.append("ap.zone = :zone")
            climate_params["zone"] = body.zonas[0]

        climate_where = f"WHERE {' AND '.join(climate_filters)}" if climate_filters else ""
        climate_sql = sa_text(
            f"""
            SELECT *
            FROM (
                SELECT
                    ap.name AS portico,
                    ap.zone AS zona,
                    cv.code AS variable,
                    r.level AS nivel,
                    r.ts AS fecha_hora,
                    ROW_NUMBER() OVER (
                        PARTITION BY ap.id, cv.code
                        ORDER BY r.ts DESC, r.id DESC
                    ) AS rn
                FROM access_portico_climate_reading r
                JOIN access_portico ap ON ap.id = r.portico_id
                JOIN access_climate_var cv ON cv.id = r.climate_var_id
                {climate_where}
            ) t
            WHERE rn = 1
              AND COALESCE(nivel, '') IN ('yellow', 'red')
            ORDER BY fecha_hora DESC
            LIMIT 6;
            """
        )
        climate_rows = (await db.execute(climate_sql, climate_params)).mappings().all()
        if climate_rows:
            lines.append("Ultimas alertas ambientales visibles:")
            for row in climate_rows:
                lines.append(
                    f"- {row['portico']} / {row['zona']} / {row['variable']}: nivel {row['nivel']} a las {row['fecha_hora']}."
                )

    return "\n".join(lines)


async def _build_schema_context(body: MCPConsultaRequest, db: AsyncSession) -> str:
    if not (_is_capability_question(body.get_question()) or body.mode == "ayuda"):
        return ""

    catalog = await _build_exposed_catalog(db)
    lines = ["Catalogo de datos habilitado para IA:"]
    for item in catalog[:10]:
        visible_columns = ", ".join(col["label"] for col in item["columns"][:6])
        lines.append(f"- {item['table']}: {item['description']}. Campos visibles: {visible_columns}.")
    return "\n".join(lines)


def _build_system_prompt(payload: MCPConsultaRequest, extra_context: str = "") -> str:
    parts = [
        "Eres Agente IA TM One, el asistente operativo de TM One para mineria subterranea.",
        "Responde siempre en espanol claro, natural y profesional, con un estilo cercano y bien estructurado.",
        "Debes sonar util y conversacional, similar a un asistente moderno tipo chat, sin perder precision tecnica.",
        "Si falta contexto, formula una sola pregunta de aclaracion concreta y luego sugiere alternativas utiles.",
        "Nunca respondas solo con numeros, comillas, corchetes, texto vacio ni fragmentos sin explicacion.",
        "Nunca inventes datos ni confirmes algo que no este sustentado por el contexto disponible.",
        "Nunca entregues usuarios del sistema, credenciales, secretos, tokens, claves ni hashes.",
        "Nunca propongas ni ejecutes cambios sobre la aplicacion o la base de datos. Tu alcance es solo lectura.",
        "Cuando cites informacion de la base, explicita en terminos simples desde que tipo de datos viene.",
    ]

    if payload.mode == "analisis":
        parts.append(
            "En modo analisis prioriza riesgos visibles, impacto operativo, recomendaciones y proximos pasos."
        )
    elif payload.mode == "datos":
        parts.append(
            "En modo datos prioriza exactitud, filtros aplicados, tablas usadas y resultados verificables."
        )
    elif payload.mode == "ayuda":
        parts.append(
            "En modo ayuda explica que puede consultar el agente y como formular mejores preguntas."
        )

    if payload.fecha_inicio and payload.fecha_fin:
        parts.append(f"Periodo consultado: {payload.fecha_inicio} -> {payload.fecha_fin}.")
    if payload.cargo:
        parts.append(f"Rol declarado por el usuario: {payload.cargo}.")
    elif payload.cargo_id:
        parts.append(f"Rol declarado por el usuario: cargo interno {payload.cargo_id}.")
    if payload.site:
        parts.append(f"Sitio de interes: {payload.site}.")
    if payload.zonas:
        parts.append(f"Zonas de interes: {', '.join(payload.zonas)}.")
    if payload.active_module:
        parts.append(f"Pantalla activa del usuario: {payload.active_module}.")
    if payload.active_path:
        parts.append(f"Ruta activa del frontend: {payload.active_path}.")

    if extra_context:
        parts.append("Contexto seguro disponible:")
        parts.append(extra_context)

    parts.append(
        "Responde con un unico objeto JSON valido que imprima exactamente los campos: headline, summary, details, evidence, actions, follow_ups, warnings, clarification_question y confidence."
    )
    parts.append(
        "No agregues texto fuera del objeto JSON ni comillas adicionales. Si no puedes devolver la respuesta estructurada, responde con un objeto JSON valido indicando el problema en el summary."
    )

    return "\n".join(parts)


def _extract_model_names(payload: Any) -> List[str]:
    if payload is None:
        return []

    models = None
    if isinstance(payload, dict):
        models = payload.get("models")
    else:
        models = getattr(payload, "models", None)

    if not models:
        return []

    names: List[str] = []
    for item in models:
        if isinstance(item, dict):
            names.append(item.get("model") or item.get("name") or "")
        else:
            names.append(getattr(item, "model", None) or getattr(item, "name", None) or "")
    return [name for name in names if name]


async def _ask_ollama(
    question: str,
    payload: MCPConsultaRequest,
    extra_context: str,
) -> tuple[MCPStructuredAnswer, str, bool]:
    system_prompt = _build_system_prompt(payload, extra_context)
    configured_model = os.getenv("OLLAMA_MODEL", DEFAULT_CHAT_MODEL)
    client = AsyncClient(host=_get_ollama_host())
    candidate_models = [configured_model]

    messages: List[Dict[str, str]] = [{"role": "system", "content": system_prompt}]
    for item in payload.history[-4:]:
        content = (item.content or "").strip()
        if content:
            messages.append({"role": item.role, "content": content[:900]})
    messages.append({"role": "user", "content": question})
    last_error: Optional[Exception] = None

    for model in candidate_models:
        request_kwargs = {
            "model": model,
            "messages": messages,
            "options": {
                "temperature": 0,
                "num_ctx": int(os.getenv("OLLAMA_NUM_CTX", "1024")),
                "num_predict": int(os.getenv("OLLAMA_NUM_PREDICT", "160")),
            },
            "stream": False,
            "keep_alive": os.getenv("OLLAMA_KEEP_ALIVE", "5m"),
        }

        try:
            try:
                response = await asyncio.wait_for(
                    client.chat(
                        **request_kwargs,
                        format=MCPStructuredAnswer.model_json_schema(),
                    ),
                    timeout=OLLAMA_CHAT_TIMEOUT_SECONDS,
                )
            except Exception as exc:
                message = _normalize_model_name(str(exc))
                if isinstance(exc, asyncio.TimeoutError):
                    raise RuntimeError(
                        f"El modelo {model} demoro mas de {int(OLLAMA_CHAT_TIMEOUT_SECONDS)}s en responder."
                    ) from exc
                if any(term in message for term in ("format", "schema", "json")):
                    raise RuntimeError(
                        f"El modelo {model} no pudo entregar la respuesta en el formato estructurado requerido."
                    ) from exc
                raise

            content = _extract_ollama_message_content(response)
            if not content:
                raise RuntimeError(f"El modelo {model} no devolvio contenido.")

            structured = _parse_ollama_structured_answer(content)
            if _looks_like_json_payload(structured.headline) or _looks_like_json_payload(structured.summary):
                raise RuntimeError(
                    f"El modelo {model} devolvio una respuesta de formato JSON no estructurado."
                )
            if not _structured_answer_is_usable(structured):
                raise RuntimeError(
                    f"El modelo {model} devolvio una respuesta demasiado corta o sin informacion util."
                )

            fallback_model_active = _normalize_model_name(model) != _normalize_model_name(configured_model)
            return structured, model, fallback_model_active
        except Exception as exc:
            last_error = exc
            continue

    if last_error is None:
        raise HTTPException(
            status_code=503,
            detail="El modelo no devolvio contenido util en este momento.",
        )

    raise last_error


def _build_sql_response(
    system_query: Dict[str, Any],
    rows: List[Dict[str, Any]],
    info_msgs: List[str],
    truncated: bool,
) -> MCPStructuredAnswer:
    title = system_query["default_output"]["title"]

    if rows:
        summary = f"Encontre {len(rows)} registros en la consulta '{title}'."
        evidence = _build_row_highlights(rows)
        actions = [
            "Si quieres, puedo cruzar este resultado con un sitio, una zona o un rango de fechas.",
            "Tambien puedo explicarte que significa operativamente este resultado.",
        ]
        warnings = []
        if truncated:
            warnings.append(
                f"Mostre solo los primeros {MAX_SQL_ROWS} registros para mantener la respuesta util y legible."
            )
    else:
        summary = f"No encontre registros para la consulta '{title}' con los filtros aplicados."
        evidence = []
        actions = [
            "Prueba ampliar el rango de fechas o cambiar la zona consultada.",
            "Si quieres, puedo sugerirte una variante de la consulta.",
        ]
        warnings = []

    return MCPStructuredAnswer(
        headline=title,
        summary=summary,
        details=info_msgs,
        evidence=evidence,
        actions=actions,
        follow_ups=[
            "Acotalo por una zona especifica.",
            "Comparalo con otro sitio o periodo.",
            "Explicame el impacto operativo de este resultado.",
        ],
        warnings=warnings,
        confidence="alta" if rows else "media",
    )


def _build_local_fallback_answer(
    question: str,
    payload: MCPConsultaRequest,
    extra_context: str,
    exc: Exception,
) -> MCPStructuredAnswer:
    context_lines = [line.strip() for line in extra_context.splitlines() if line.strip()]
    visible_context = context_lines[:6]
    active_filters: List[str] = []

    if payload.site:
        active_filters.append(f"sitio {payload.site}")
    if payload.zonas:
        active_filters.append(f"zonas {', '.join(payload.zonas[:3])}")
    if payload.cargo:
        active_filters.append(f"cargo {payload.cargo}")

    filter_suffix = f" con foco en {', '.join(active_filters)}" if active_filters else ""

    if visible_context:
        return MCPStructuredAnswer(
            headline="Consultas predefinidas en contingencia",
            summary=(
                "El modelo no respondio dentro de 60 segundos, por lo que respondo con consultas predefinidas "
                f"y contexto seguro disponible{filter_suffix}."
            ),
            details=visible_context[:4],
            evidence=visible_context[4:6],
            actions=[
                "Si quieres, acoto esta misma lectura por zona, sitio o periodo.",
                "Tambien puedo intentar una consulta estructurada sobre personas, vehiculos, agentes ambientales o permanencias.",
            ],
            follow_ups=[
                "Resumelo solo para una zona especifica.",
                "Convierte esto en una consulta de datos concreta.",
                "Dime que riesgo operativo ves primero con esta informacion.",
            ],
            warnings=[
                "Modo contingencia activo: se uso contexto directo sin respuesta del modelo conversacional.",
                "Se entregaron consultas predefinidas en lugar de la respuesta generada.",
                f"Detalle tecnico resumido: {exc}",
            ],
            confidence="media",
        )

    return MCPStructuredAnswer(
        headline="Servicio de IA en contingencia",
        summary=(
            "La capa conversacional no respondio y en este intento no habia contexto suficiente "
            "para sintetizar datos concretos."
        ),
        details=[
            f"Consulta original: {question}",
            "El modulo sigue habilitado para FAQ, catalogo y consultas estructuradas en modo solo lectura.",
        ],
        actions=[
            "Prueba con una pregunta mas concreta sobre personas, vehiculos, equipos, agentes ambientales o permanencias.",
            "Tambien puedes indicar sitio, zona o fecha para que el sistema arme contexto antes de responder.",
        ],
        follow_ups=[
            "Que datos puedes consultar de la base de datos de forma segura.",
            "Muestrame personas y vehiculos dentro actualmente.",
            "Dame un resumen operativo del sitio principal.",
        ],
        warnings=[
            "No hubo respuesta del modelo conversacional en este intento.",
            f"Detalle tecnico resumido: {exc}",
        ],
        confidence="baja",
    )


def _coerce_request(body: Any) -> MCPConsultaRequest:
    if isinstance(body, MCPConsultaRequest):
        return body

    if not isinstance(body, dict):
        raise HTTPException(status_code=422, detail="Payload invalido (se esperaba JSON object).")

    mapped = dict(body)
    if mapped.get("zonas") is None:
        mapped["zonas"] = []
    if mapped.get("history") is None:
        mapped["history"] = []

    q = (
        mapped.get("pregunta")
        or mapped.get("question")
        or mapped.get("query")
        or mapped.get("text")
        or mapped.get("prompt")
        or mapped.get("message")
    )
    if q is not None:
        mapped["pregunta"] = q

    filters = mapped.get("filters") or {}
    if isinstance(filters, dict):
        if mapped.get("fecha_inicio") is None and filters.get("start_date") is not None:
            mapped["fecha_inicio"] = filters.get("start_date")
        if mapped.get("fecha_fin") is None and filters.get("end_date") is not None:
            mapped["fecha_fin"] = filters.get("end_date")
        if mapped.get("cargo") is None and filters.get("cargo") is not None:
            mapped["cargo"] = filters.get("cargo")
        if mapped.get("site") is None and filters.get("site") is not None:
            mapped["site"] = filters.get("site")
        if not mapped.get("zonas") and filters.get("zona") is not None:
            zone_value = filters.get("zona")
            mapped["zonas"] = zone_value if isinstance(zone_value, list) else [zone_value]
        if mapped.get("site") is None and filters.get("sitio") is not None:
            mapped["site"] = filters.get("sitio")

    try:
        return MCPConsultaRequest.model_validate(mapped)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Payload invalido para MCP: {exc}")


@router.get("/facts")
async def mcp_facts() -> dict:
    synonyms = _load_mining_synonyms()
    return {
        "status": "ok",
        "synonyms": synonyms,
        "notes": [
            "Los sinonimos mineros se usan para normalizar preguntas del usuario.",
            "Si falta un termino, agregalo en backend/app/data/mining_synonyms.json.",
        ],
    }


@router.get("/status")
async def mcp_status() -> dict:
    host = _get_ollama_host()
    configured_model = os.getenv("OLLAMA_MODEL", DEFAULT_CHAT_MODEL)
    reachable = False
    available_models: List[str] = []
    selected_model = configured_model
    fallback_model_active = False
    model_available = False
    error = None

    try:
        payload = await asyncio.wait_for(
            asyncio.to_thread(Client(host=host).list),
            timeout=OLLAMA_STATUS_TIMEOUT_SECONDS,
        )
        available_models = _extract_model_names(payload)
        reachable = True
        model_available = bool(available_models)
        if model_available:
            selected_model, fallback_model_active = _resolve_available_model(
                configured_model,
                available_models,
            )
        else:
            error = "Ollama respondio, pero todavia no expone modelos descargados."
    except asyncio.TimeoutError:
        error = f"Ollama no respondio dentro de {int(OLLAMA_STATUS_TIMEOUT_SECONDS)}s."
    except Exception as exc:  # pragma: no cover - depende del runtime
        error = str(exc)

    return {
        "status": "ok",
        "ollama": {
            "host": host,
            "model": selected_model,
            "configured_model": configured_model,
            "ready": reachable and model_available,
            "reachable": reachable,
            "model_available": model_available,
            "fallback_model_active": fallback_model_active,
            "available_models": available_models[:12],
            "error": error,
        },
        "policies": {
            "read_only": True,
            "blocks_secrets": True,
            "blocks_mutations": True,
        },
    }


@router.get("/catalog")
async def mcp_catalog(db: AsyncSession = Depends(get_db)) -> dict:
    catalog = await _build_exposed_catalog(db)
    return {
        "status": "ok",
        "tables": catalog,
        "table_count": len(catalog),
        "policies": {
            "read_only": True,
            "restricted_data": [
                "users del sistema",
                "credenciales",
                "tokens",
                "secretos",
            ],
        },
    }


@router.post("/consulta", response_model=MCPConsultaResponse)
async def mcp_consulta(
    body: Any = Body(...),
    db: AsyncSession = Depends(get_db),
):
    req = _coerce_request(body)
    question = req.get_question()

    if not question:
        structured = MCPStructuredAnswer(
            headline="Falta tu consulta",
            summary="Escribe una pregunta para continuar.",
            follow_ups=[
                "Muestrame personas y vehiculos dentro actualmente.",
                "Dame un resumen operativo del sitio principal.",
            ],
            confidence="alta",
        )
        return MCPConsultaResponse(
            answer=_render_plain_answer(structured),
            structured=structured,
            mode="empty",
        )

    blocked = _detect_blocked_request(question)
    if blocked:
        return MCPConsultaResponse(
            answer=_render_plain_answer(blocked),
            structured=blocked,
            mode="blocked",
            sources=["politica de seguridad"],
        )

    vague = _detect_vague_request(question, req)
    if vague:
        return MCPConsultaResponse(
            answer=_render_plain_answer(vague),
            structured=vague,
            mode="clarify",
            sources=["guia conversacional"],
        )

    if _is_capability_question(question):
        return await _build_capability_response(question, db)

    faq_entry = find_faq_entry(question)
    if faq_entry:
        structured = MCPStructuredAnswer(
            headline=faq_entry.get("title") or "Ayuda TM One",
            summary=faq_entry["answer"],
            details=faq_entry.get("details", []),
            actions=faq_entry.get("actions", []),
            follow_ups=faq_entry.get("follow_ups", DEFAULT_FOLLOW_UPS),
            confidence="alta",
        )
        return MCPConsultaResponse(
            answer=_render_plain_answer(structured),
            structured=structured,
            mode="faq",
            sources=[faq_entry.get("source", "base de conocimiento TM One")],
        )

    system_query = find_system_query(question)
    if system_query:
        try:
            detected_filters, detected_messages = _extract_filters_for_system_query(
                question, req, system_query
            )
            sql, params, sql_messages = build_sql_with_filters(system_query, detected_filters)
            result = await db.execute(sa_text(sql), params)
            raw_rows = [dict(r) for r in result.mappings().all()]
            sanitized_rows = _sanitize_rows(raw_rows)

            truncated = len(sanitized_rows) > MAX_SQL_ROWS
            if truncated:
                sanitized_rows = sanitized_rows[:MAX_SQL_ROWS]

            tables: List[MCPTabla] = []
            if sanitized_rows:
                tables.append(
                    MCPTabla(
                        title=system_query["default_output"]["title"],
                        columns=list(sanitized_rows[0].keys()),
                        rows=sanitized_rows,
                    )
                )

            charts: List[MCPChart] = []
            default_chart = system_query.get("default_chart")
            if sanitized_rows and default_chart:
                charts.append(
                    MCPChart(
                        title=default_chart.get("title", system_query["default_output"]["title"]),
                        type=default_chart.get("type", "bar"),
                        config={k: v for k, v in default_chart.items() if k not in ("type", "title")},
                        data={"rows": sanitized_rows},
                    )
                )

            structured = _build_sql_response(
                system_query=system_query,
                rows=sanitized_rows,
                info_msgs=detected_messages + sql_messages,
                truncated=truncated,
            )

            export_token = (
                create_export_token(
                    system_query["id"],
                    sql,
                    params,
                    system_query["default_output"]["title"],
                )
                if sanitized_rows
                else None
            )

            return MCPConsultaResponse(
                answer=_render_plain_answer(structured),
                structured=structured,
                tables=tables,
                charts=charts,
                export_token=export_token,
                mode="sql",
                sources=[f"base de datos: {table}" for table in system_query.get("tables", [])],
            )
        except Exception:
            traceback.print_exc()
            structured = MCPStructuredAnswer(
                headline="No pude completar la consulta estructurada",
                summary="La consulta detectada fallo antes de devolver datos.",
                details=[
                    "Puedo reintentarla con otros filtros o convertirla en una consulta mas guiada.",
                ],
                follow_ups=[
                    "Reintenta la consulta sin filtros de fecha.",
                    "Ayudame a reformular la consulta paso a paso.",
                ],
                warnings=["Ocurrio un error interno al ejecutar SQL estructurado."],
                confidence="baja",
            )
            return MCPConsultaResponse(
                answer=_render_plain_answer(structured),
                structured=structured,
                mode="sql_error",
                sources=["base de datos"],
            )

    extra_context_parts = []
    schema_context = await _build_schema_context(req, db)
    if schema_context:
        extra_context_parts.append(schema_context)
    operational_context = await _build_operational_context(req, db)
    if operational_context:
        extra_context_parts.append(operational_context)
    extra_context = "\n\n".join(part for part in extra_context_parts if part)

    try:
        structured, model, fallback_model_active = await _ask_ollama(question, req, extra_context)
        sources = ["modelo conversacional"]
        if extra_context:
            sources.append("contexto de base de datos")
        if fallback_model_active:
            sources.append("modelo alternativo disponible en Ollama")
        return MCPConsultaResponse(
            answer=_render_plain_answer(structured),
            structured=structured,
            mode="chat",
            sources=sources,
            model=model,
        )
    except Exception as exc:  # pragma: no cover - depende del runtime
        structured = _build_local_fallback_answer(question, req, extra_context, exc)
        return MCPConsultaResponse(
            answer=_render_plain_answer(structured),
            structured=structured,
            mode="chat_fallback",
            sources=[
                "fallback operativo del agente",
                *(["contexto de base de datos"] if extra_context else []),
            ],
        )


@router.get("/export-excel/{token}")
async def mcp_export_excel(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    payload = decode_export_token(token)
    sql = payload.get("sql")
    params = payload.get("params", {})
    title = payload.get("title") or "Datos"

    if not sql:
        raise HTTPException(status_code=400, detail="Token sin SQL valido.")

    try:
        result = await db.execute(sa_text(sql), params)
        rows = _sanitize_rows([dict(r) for r in result.mappings().all()])
    except Exception as exc:
        print(f"[MCP EXPORT-EXCEL] Error ejecutando SQL: {exc}")
        raise HTTPException(
            status_code=500,
            detail="No se pudo ejecutar la consulta para exportar a Excel.",
        )

    df = pd.DataFrame(rows)
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name=title[:31] or "Datos")
    output.seek(0)

    filename = "agente_ia_export.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export-csv/{token}")
async def mcp_export_csv(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    payload = decode_export_token(token)
    sql = payload.get("sql")
    params = payload.get("params", {})

    if not sql:
        raise HTTPException(status_code=400, detail="Token sin SQL valido.")

    try:
        result = await db.execute(sa_text(sql), params)
        rows = _sanitize_rows([dict(r) for r in result.mappings().all()])
    except Exception as exc:
        print(f"[MCP EXPORT-CSV] Error ejecutando SQL: {exc}")
        raise HTTPException(
            status_code=500,
            detail="No se pudo ejecutar la consulta para exportar a CSV.",
        )

    df = pd.DataFrame(rows)
    output = io.StringIO()
    df.to_csv(output, index=False)
    output.seek(0)

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="agente_ia_export.csv"'},
    )


@router.get("/export-pdf/{token}")
async def mcp_export_pdf(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    payload = decode_export_token(token)
    sql = payload.get("sql")
    params = payload.get("params", {})
    title = payload.get("title") or "Exportacion de datos"

    if not sql:
        raise HTTPException(status_code=400, detail="Token sin SQL valido.")

    try:
        result = await db.execute(sa_text(sql), params)
        rows = _sanitize_rows([dict(r) for r in result.mappings().all()])
    except Exception as exc:
        print(f"[MCP EXPORT-PDF] Error ejecutando SQL: {exc}")
        raise HTTPException(
            status_code=500,
            detail="No se pudo ejecutar la consulta para exportar a PDF.",
        )

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    margin_left = 40
    margin_top = 800
    line_height = 14

    c.setFont("Helvetica-Bold", 12)
    c.drawString(margin_left, margin_top, "Agente IA TM One - Exportacion PDF")
    c.setFont("Helvetica", 9)
    c.drawString(margin_left, margin_top - 18, title[:80])

    if not rows:
        c.drawString(margin_left, margin_top - 40, "No se encontraron datos para los filtros seleccionados.")
        c.showPage()
        c.save()
        buffer.seek(0)
        return StreamingResponse(
            buffer,
            media_type="application/pdf",
            headers={"Content-Disposition": 'attachment; filename="agente_ia_export.pdf"'},
        )

    columns = list(rows[0].keys())
    y = margin_top - 50

    c.setFont("Helvetica-Bold", 8)
    x = margin_left
    for col in columns:
        c.drawString(x, y, str(col)[:18])
        x += 120
    y -= line_height

    c.setFont("Helvetica", 8)
    for row in rows:
        x = margin_left
        if y < 40:
            c.showPage()
            y = margin_top
            c.setFont("Helvetica", 8)
        for col in columns:
            text = str(row.get(col, "") or "")
            if len(text) > 20:
                text = text[:17] + "..."
            c.drawString(x, y, text)
            x += 120
        y -= line_height

    c.showPage()
    c.save()
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="agente_ia_export.pdf"'},
    )
