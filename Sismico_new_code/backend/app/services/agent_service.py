from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import datetime
import re
import unicodedata
from typing import Any, Dict, Iterable, Optional
from zoneinfo import ZoneInfo

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.settings import settings
from app.core.state_codes import CRITICAL, OFFLINE, UNKNOWN, WARNING
from app.models.alert import AlertEvent
from app.models.map_object import MapObject
from app.models.module_tmone_real import ModuleAIConsultLog, ModuleAIFaq, ModuleZoneDet
from app.models.screen import Screen
from app.models.site import Site
from app.models.sismico_runtime import SemaforoDevice, SemaforoRule
from app.schemas.agent import (
    AgentAskRequest,
    AgentAskResponse,
    AgentChartArtifact,
    AgentFaqCategory,
    AgentFaqItem,
    AgentFaqsResponse,
    AgentInputOption,
    AgentStatusResponse,
    AgentTableArtifact,
    AgentTableColumn,
)
from app.services.ollama_service import OllamaService
from app.services.productivity_service import ProductivityService
from app.services.sismico_service import SismicoService, build_source_message, normalize_site_code, normalize_source_status


DEFAULT_TIMEZONE = "America/Santiago"
PLACEHOLDER_ANSWER_MARKERS = (
    "respuesta simulada",
    "respuesta desde bd simulada",
    "respuesta desde bd para",
)

SENSITIVE_DISCLOSURE_TERMS = (
    "password",
    "passwd",
    "contrasena",
    "clave",
    "credencial",
    "credenciales",
    "secret",
    "secreto",
    "secrets",
    "token",
    "tokens",
    "jwt",
    "api key",
    "apikey",
    "bearer",
    "password_hash",
    "hash",
    "connection string",
    "cadena de conexion",
    "db password",
    "jwt secret",
    "secret key",
    "private key",
    "llave privada",
)

MUTATION_TERMS = (
    "cambiar",
    "cambia",
    "modifica",
    "modificar",
    "actualiza",
    "actualizar",
    "setea",
    "setear",
    "establece",
    "establecer",
    "editar",
    "edita",
    "crear",
    "crea",
    "insertar",
    "insert",
    "delete",
    "eliminar",
    "elimina",
    "borrar",
    "borra",
    "drop",
    "alter",
    "grant",
    "truncate",
    "activar",
    "activa",
    "desactivar",
    "desactiva",
    "ejecutar",
    "ejecuta",
    "reiniciar",
    "reinicia",
    "forzar",
    "fuerza",
)

MUTATION_TARGET_TERMS = (
    "configuracion",
    "config",
    "usuario",
    "usuarios",
    "password",
    "contrasena",
    "token",
    "secret",
    "jwt",
    "licencia",
    "authorized mac",
    "mac autorizada",
    "screen",
    "pantalla",
    "pantallas",
    "semaforo",
    "semaforos",
    "polling",
    "system config",
    "system_config",
    "estado manual",
    "emergencia",
    "plc",
)

SENSITIVE_OUTPUT_PATTERNS = (
    re.compile(r"(?i)\b(postgres(?:ql)?://\S+)"),
    re.compile(r"(?i)\b(?:password|passwd|password_hash|token|secret|apikey|api[_ -]?key|jwt(?:_secret)?|secret[_ -]?key)\s*[:=]\s*\S+"),
    re.compile(r"(?i)\bauthorization\s*:\s*bearer\s+\S+"),
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._\-]{16,}"),
)


@dataclass(frozen=True)
class AgentFaqDefinition:
    id: str
    category_id: str
    question: str
    description: str
    intent: str


FAQ_CATEGORY_META = {
    "monitoreo": {
        "label": "Monitoreo",
        "description": "Estado actual del sistema sismico y sus sitios.",
    },
    "alertas": {
        "label": "Alertas",
        "description": "Resumen y detalle de alertas abiertas.",
    },
    "control": {
        "label": "Control",
        "description": "Semaforos y pantallas registrados en la operacion.",
    },
    "datos": {
        "label": "Datos operacionales",
        "description": "Productividad, zonas y tablas auxiliares.",
    },
    "analisis": {
        "label": "Analisis IA",
        "description": "Consultas mas abiertas apoyadas por Ollama sobre el estado actual.",
    },
    "ayuda": {
        "label": "Ayuda",
        "description": "Significado de estados y como interpretar el sistema.",
    },
}


FAQ_DEFINITIONS = (
    AgentFaqDefinition(
        id="resumen_monitoreo",
        category_id="monitoreo",
        question="Dame un resumen del monitoreo actual por sitio.",
        description="Resume fuente, alertas y estado de poligonos por sitio.",
        intent="resumen_monitoreo",
    ),
    AgentFaqDefinition(
        id="estado_fuentes",
        category_id="monitoreo",
        question="Que sitios estan online, cached, manual u offline ahora mismo?",
        description="Entrega el estado de lectura por sitio y su ultima sincronizacion.",
        intent="estado_fuentes",
    ),
    AgentFaqDefinition(
        id="ultimo_registro",
        category_id="monitoreo",
        question="Cual es el ultimo registro visible por sitio?",
        description="Muestra la fecha, hora y origen del dato mas reciente.",
        intent="ultimo_registro",
    ),
    AgentFaqDefinition(
        id="poligonos_alerta",
        category_id="monitoreo",
        question="Que poligonos estan en warning o critical actualmente?",
        description="Lista los objetos con estados visibles no normales.",
        intent="poligonos_alerta",
    ),
    AgentFaqDefinition(
        id="alertas_abiertas",
        category_id="alertas",
        question="Cuantas alertas abiertas hay por sitio?",
        description="Agrupa las alertas activas por sitio.",
        intent="alertas_abiertas",
    ),
    AgentFaqDefinition(
        id="ultimas_alertas",
        category_id="alertas",
        question="Muestrame las alertas abiertas mas recientes.",
        description="Detalle de las alertas abiertas con severidad y fecha.",
        intent="ultimas_alertas",
    ),
    AgentFaqDefinition(
        id="resumen_semaforos",
        category_id="control",
        question="Cuantos semaforos y reglas activas hay por sitio?",
        description="Cuenta dispositivos y reglas habilitadas por sitio.",
        intent="resumen_semaforos",
    ),
    AgentFaqDefinition(
        id="estado_pantallas",
        category_id="control",
        question="Que pantallas estan online y cuando fue su ultimo heartbeat?",
        description="Entrega el estado actual de las pantallas registradas.",
        intent="estado_pantallas",
    ),
    AgentFaqDefinition(
        id="resumen_productividad",
        category_id="datos",
        question="Resume los eventos de productividad cargados en la base de datos.",
        description="Suma eventos, energia y el rango temporal disponible.",
        intent="resumen_productividad",
    ),
    AgentFaqDefinition(
        id="graficos_productividad",
        category_id="datos",
        question="Muestrame los graficos de productividad sismica disponibles.",
        description="Entrega los graficos del modulo de productividad sismica directamente en el agente.",
        intent="graficos_productividad",
    ),
    AgentFaqDefinition(
        id="zonas_configuradas",
        category_id="datos",
        question="Lista las zonas DET configuradas.",
        description="Entrega el listado de zonas y su zone_key.",
        intent="zonas_configuradas",
    ),
    AgentFaqDefinition(
        id="riesgos_actuales",
        category_id="analisis",
        question="Cuales son los principales riesgos operativos visibles ahora mismo?",
        description="Sintetiza riesgos segun estado de sitios, alertas y poligonos visibles.",
        intent="riesgos_actuales",
    ),
    AgentFaqDefinition(
        id="acciones_recomendadas",
        category_id="analisis",
        question="Sugiere acciones operativas rapidas segun el estado actual del sistema.",
        description="Entrega recomendaciones breves usando el contexto actual disponible.",
        intent="acciones_recomendadas",
    ),
    AgentFaqDefinition(
        id="explica_sitio",
        category_id="analisis",
        question="Explicame en lenguaje simple que esta pasando en un sitio.",
        description="Pide el sitio si falta y resume el contexto operativo con IA rapida.",
        intent="explica_sitio",
    ),
    AgentFaqDefinition(
        id="glosario_estados",
        category_id="ayuda",
        question="Que significan los estados online, cached, manual y offline?",
        description="Explica como interpretar el estado visible del sistema.",
        intent="glosario_estados",
    ),
)

FAQ_BY_ID = {faq.id: faq for faq in FAQ_DEFINITIONS}

SITE_REQUIRED_INTENTS = {
    "poligonos_alerta",
    "ultimas_alertas",
    "resumen_semaforos",
    "estado_pantallas",
    "explica_sitio",
}

LLM_INTENTS = {
    "riesgos_actuales",
    "acciones_recomendadas",
    "explica_sitio",
}

CHART_REQUEST_TERMS = (
    "grafico",
    "graficos",
    "grafica",
    "graficas",
    "chart",
    "charts",
    "visualizacion",
    "visualizaciones",
)

TABLE_REQUEST_TERMS = (
    "tabla",
    "tablas",
    "csv",
    "dataset",
    "data",
    "datos",
    "detalle tabular",
)

PRODUCTIVITY_VISUAL_TERMS = (
    "productividad",
    "productivo",
    "sismico",
    "sismica",
    "plano",
    "planos",
    "poligonos",
    "alertas por severidad",
    "polling",
    "fuentes",
    "frescura",
    "correlacion",
    "eventos por intervalo",
    "actividad por plano",
)

PRODUCTIVITY_CHART_ALIASES = {
    "events_timeline": (
        "eventos por intervalo",
        "historial de eventos",
        "tendencia de eventos",
        "timeline",
        "serie temporal",
        "grafico de eventos",
    ),
    "current_state_distribution": (
        "panorama actual",
        "estado actual por sitio",
        "distribucion actual",
        "poligonos por sitio",
        "estado por sitio",
    ),
    "alerts_by_severity": (
        "alertas por severidad",
        "severidad de alertas",
        "grafico de alertas",
        "alertas severidad",
    ),
    "top_polygons": (
        "top poligonos",
        "ranking de poligonos",
        "poligonos por cambios",
        "poligonos mas activos",
    ),
    "sync_correlation": (
        "correlacion polling",
        "polling vs alertas",
        "sync vs alertas",
        "registros mapeados",
        "correlacion de sync",
    ),
    "source_status_distribution": (
        "fuente externa por estado",
        "estado de fuentes",
        "online cached manual offline",
        "fuentes por estado",
    ),
    "activity_by_map": (
        "actividad por plano",
        "plano mas activo",
        "eventos por plano",
        "actividad de planos",
    ),
    "freshness_by_map": (
        "frescura del ultimo dato",
        "frescura",
        "ultimo dato por plano",
        "sin lectura",
        "stale",
    ),
}


def normalize_agent_text(value: Optional[str]) -> str:
    raw = unicodedata.normalize("NFKD", value or "")
    raw = "".join(char for char in raw if not unicodedata.combining(char))
    raw = raw.lower()
    raw = re.sub(r"[^a-z0-9]+", " ", raw)
    return re.sub(r"\s+", " ", raw).strip()


def is_placeholder_answer(value: Optional[str]) -> bool:
    normalized = normalize_agent_text(value)
    return any(marker in normalized for marker in PLACEHOLDER_ANSWER_MARKERS)


def format_dt(value: Optional[datetime], tz_name: Optional[str] = None) -> str:
    if value is None:
        return "sin dato"
    current = value
    if current.tzinfo is not None:
        try:
            current = current.astimezone(ZoneInfo(tz_name or DEFAULT_TIMEZONE))
        except Exception:
            pass
    return current.strftime("%Y-%m-%d %H:%M:%S")


def count_visible_states(object_states) -> Counter:
    return Counter((item.state_code or UNKNOWN).lower() for item in (object_states or []))


def current_time() -> datetime:
    return datetime.now(ZoneInfo(DEFAULT_TIMEZONE))


class AgentService:
    def __init__(self, db: Session):
        self.db = db
        self.sismico = SismicoService(db)
        self.productivity = ProductivityService(db)
        self.ollama = OllamaService()
        self._ollama_status_cache: Optional[dict] = None

    def get_status(self) -> AgentStatusResponse:
        raw = self._ollama_status()
        return AgentStatusResponse(
            enabled=bool(settings.enable_ai_agent),
            ollama_enabled=bool(raw.get("enabled")),
            ollama_reachable=bool(raw.get("reachable")),
            fast_model=raw.get("fastModel"),
            chat_model=raw.get("chatModel"),
            loaded_models=list(raw.get("models") or []),
            interactive_supported=True,
            error=raw.get("error"),
        )

    def list_faqs(self) -> AgentFaqsResponse:
        categories = []
        flat_items = []
        for category_id, meta in FAQ_CATEGORY_META.items():
            items = [
                AgentFaqItem(
                    id=faq.id,
                    category_id=faq.category_id,
                    question=faq.question,
                    description=faq.description,
                )
                for faq in FAQ_DEFINITIONS
                if faq.category_id == category_id
            ]
            if category_id == "analisis" and not self._can_use_ollama():
                items = []
            if not items:
                continue
            categories.append(
                AgentFaqCategory(
                    id=category_id,
                    label=meta["label"],
                    description=meta["description"],
                    items=items,
                )
            )
            flat_items.extend(items)

        custom_items = self._custom_faq_items()
        if custom_items:
            categories.append(
                AgentFaqCategory(
                    id="personalizadas",
                    label="Personalizadas",
                    description="Preguntas cargadas manualmente en la base de datos.",
                    items=custom_items,
                )
            )
            flat_items.extend(custom_items)

        return AgentFaqsResponse(categories=categories, faqs=flat_items)

    def ask(self, payload: AgentAskRequest) -> AgentAskResponse:
        history = [str(item).strip() for item in (payload.history or []) if str(item).strip()]
        question = (payload.question or "").strip()
        full_context_text = " ".join([*history, question]).strip()
        faq_item = self._resolve_faq_item(payload.faq_id, question or full_context_text)
        question = (payload.question or "").strip()
        if faq_item and not question:
            question = faq_item.question
            full_context_text = " ".join([*history, question]).strip()
        display_question = history[0] if history else question
        if not question:
            return AgentAskResponse(
                question="",
                answer="Debes ingresar una consulta o seleccionar una pregunta frecuente.",
                faq_id=(faq_item.id if faq_item else None),
                category_id=(faq_item.category_id if faq_item else None),
                intent="empty",
                site_code=None,
                mode="guided",
                read_only=True,
                blocked=False,
                safety_reason=None,
                generated_at=current_time(),
                charts=[],
                tables=[],
                suggestions=self._suggestion_items(None),
            )

        mode = self._normalize_mode(payload.mode)
        site = self._resolve_site(payload.site_code, full_context_text or question)
        site_code = site.code if site else None
        intent = (faq_item.id if faq_item else self._detect_intent(full_context_text or question)) or "help"
        security_reason = self._security_block_reason(full_context_text or question)
        if security_reason:
            blocked = self._blocked_response(
                question=display_question,
                intent=intent,
                reason=security_reason,
                faq_id=(faq_item.id if faq_item else (intent if intent in FAQ_BY_ID else None)),
                category_id=(faq_item.category_id if faq_item else (FAQ_BY_ID[intent].category_id if intent in FAQ_BY_ID else None)),
                site_code=site_code,
            )
            self._log_consult(question=full_context_text or question, answer=blocked.answer)
            return blocked
        missing_input = self._detect_missing_input(intent=intent, site=site, question=full_context_text or question)
        if missing_input is not None:
            return AgentAskResponse(
                question=display_question,
                answer=missing_input["answer"],
                faq_id=(faq_item.id if faq_item else (intent if intent in FAQ_BY_ID else None)),
                category_id=(faq_item.category_id if faq_item else (FAQ_BY_ID[intent].category_id if intent in FAQ_BY_ID else None)),
                intent=intent,
                site_code=site_code,
                source="interaction",
                mode="guided",
                used_llm=False,
                model=None,
                read_only=True,
                blocked=False,
                safety_reason=None,
                needs_input=True,
                follow_up_question=missing_input["follow_up_question"],
                missing_fields=list(missing_input["missing_fields"]),
                input_options=list(missing_input["input_options"]),
                generated_at=current_time(),
                charts=[],
                tables=[],
                suggestions=self._suggestion_items(intent),
            )

        custom_answer = self._resolve_custom_answer(payload.faq_id, question)
        if custom_answer is not None:
            answer = custom_answer
            source = "database"
            response_mode = "guided"
            used_llm = False
            model = None
            intent = "custom_faq"
            faq_id = payload.faq_id if payload.faq_id and str(payload.faq_id).startswith("custom:") else None
            category_id = "personalizadas"
        else:
            guided_answer = self._dispatch(intent=intent, site=site)
            llm_result = self._generate_llm_answer(
                intent=intent,
                question=question,
                full_context_text=full_context_text or question,
                site=site,
                guided_answer=guided_answer,
                mode=mode,
            )
            if llm_result is not None:
                answer = llm_result["answer"]
                source = "ollama"
                response_mode = llm_result["mode"]
                used_llm = True
                model = llm_result["model"]
            else:
                answer = guided_answer
                source = "database"
                response_mode = "guided" if mode == "guided" else mode
                used_llm = False
                model = None
            faq_id = faq_item.id if faq_item else (intent if intent in FAQ_BY_ID else None)
            category_id = faq_item.category_id if faq_item else (FAQ_BY_ID[intent].category_id if intent in FAQ_BY_ID else None)

        safe_answer, safety_reason = self._sanitize_answer(answer)
        artifacts = self._resolve_response_artifacts(
            intent=intent,
            question=full_context_text or question,
            site=site,
        )
        self._log_consult(question=full_context_text or question, answer=safe_answer)
        return AgentAskResponse(
            question=display_question,
            answer=safe_answer,
            faq_id=faq_id,
            category_id=category_id,
            intent=intent,
            site_code=site_code,
            source=source,
            mode=response_mode,
            used_llm=used_llm,
            model=model,
            read_only=True,
            blocked=False,
            safety_reason=safety_reason,
            generated_at=current_time(),
            charts=artifacts["charts"],
            tables=artifacts["tables"],
            suggestions=self._suggestion_items(intent),
        )

    def _dispatch(self, *, intent: str, site: Optional[Site]) -> str:
        handlers = {
            "resumen_monitoreo": self._answer_monitoring_overview,
            "estado_fuentes": self._answer_source_statuses,
            "ultimo_registro": self._answer_last_records,
            "poligonos_alerta": self._answer_polygons_in_alert,
            "alertas_abiertas": self._answer_open_alerts_count,
            "ultimas_alertas": self._answer_latest_alerts,
            "resumen_semaforos": self._answer_semaforo_summary,
            "estado_pantallas": self._answer_screen_status,
            "resumen_productividad": self._answer_productivity_summary,
            "graficos_productividad": self._answer_productivity_visuals,
            "zonas_configuradas": self._answer_zones,
            "riesgos_actuales": self._answer_risks_current,
            "acciones_recomendadas": self._answer_recommended_actions,
            "explica_sitio": self._answer_explain_site,
            "glosario_estados": self._answer_status_glossary,
            "help": self._answer_help,
        }
        handler = handlers.get(intent, self._answer_help)
        return handler(site=site)

    def _normalize_mode(self, value: Optional[str]) -> str:
        normalized = (value or "auto").strip().lower()
        if normalized in {"auto", "guided", "fast", "llm"}:
            return normalized
        return "auto"

    def _can_use_ollama(self) -> bool:
        status = self._ollama_status()
        return bool(settings.enable_ai_agent and status.get("enabled") and status.get("reachable"))

    def _ollama_status(self) -> dict:
        if self._ollama_status_cache is None:
            self._ollama_status_cache = self.ollama.get_status()
        return self._ollama_status_cache

    def _security_block_reason(self, question: str) -> Optional[str]:
        normalized = normalize_agent_text(question)
        if not normalized:
            return None
        if self._mentions_any(normalized, SENSITIVE_DISCLOSURE_TERMS):
            return "No entrego contrasenas, hashes, tokens, llaves, cadenas de conexion ni otros secretos del sistema."
        if self._mentions_any(normalized, MUTATION_TERMS) and self._mentions_any(normalized, MUTATION_TARGET_TERMS):
            return "El agente esta en modo solo lectura y no puede cambiar configuracion, estados ni valores operativos del sistema."
        return None

    def _is_sensitive_answer(self, answer: Optional[str]) -> bool:
        text_value = str(answer or "").strip()
        if not text_value:
            return False
        return any(pattern.search(text_value) for pattern in SENSITIVE_OUTPUT_PATTERNS)

    def _sanitize_answer(self, answer: Optional[str]) -> tuple[str, Optional[str]]:
        text_value = str(answer or "").strip()
        if not text_value:
            return "", None
        if self._is_sensitive_answer(text_value):
            return (
                "Omiti informacion sensible por politica de seguridad. Puedo ayudarte con un resumen operacional no sensible.",
                "sensitive_output_redacted",
            )
        return text_value, None

    def _blocked_response(
        self,
        *,
        question: str,
        intent: str,
        reason: str,
        faq_id: Optional[str] = None,
        category_id: Optional[str] = None,
        site_code: Optional[str] = None,
    ) -> AgentAskResponse:
        return AgentAskResponse(
            question=question,
            answer=reason,
            faq_id=faq_id,
            category_id=category_id,
            intent=intent,
            site_code=site_code,
            source="policy",
            mode="guided",
            used_llm=False,
            model=None,
            read_only=True,
            blocked=True,
            safety_reason=reason,
            generated_at=current_time(),
            charts=[],
            tables=[],
            suggestions=self._suggestion_items(None),
        )

    def _generate_llm_answer(
        self,
        *,
        intent: str,
        question: str,
        full_context_text: str,
        site: Optional[Site],
        guided_answer: str,
        mode: str,
    ) -> Optional[dict]:
        if mode == "guided":
            return None
        if not self._should_use_ollama(intent=intent, question=full_context_text, mode=mode):
            return None
        if not self._can_use_ollama():
            return None

        llm_mode = "fast" if mode in {"auto", "fast"} else "llm"
        context_block = self._build_llm_context(site=site, guided_answer=guided_answer)
        system_prompt = (
            "Eres el asistente operacional del dashboard sismico.\n"
            "Responde en espanol claro y breve.\n"
            "Usa solo el contexto entregado y no inventes datos.\n"
            "Si el contexto no alcanza para sostener una afirmacion, dilo explicitamente.\n"
            "Cuando entregues recomendaciones, mantenlas operativas y prudentes.\n"
            "Nunca entregues contrasenas, hashes, tokens, llaves, secretos, cadenas de conexion ni instrucciones para modificar configuracion o ejecutar cambios sobre el sistema."
        )
        user_prompt = (
            f"Consulta del usuario:\n{question}\n\n"
            f"Contexto confiable del sistema:\n{context_block}\n\n"
            "Entrega una respuesta util para operacion. Si corresponde, separa en 2 o 3 puntos breves."
        )
        result = self.ollama.generate(system_prompt=system_prompt, user_prompt=user_prompt, mode=llm_mode)
        if not result.ok or not result.content:
            return None
        return {"answer": result.content, "mode": llm_mode, "model": result.model}

    def _should_use_ollama(self, *, intent: str, question: str, mode: str) -> bool:
        if mode == "llm":
            return True
        if intent in LLM_INTENTS:
            return True
        normalized = normalize_agent_text(question)
        if self._mentions_any(
            normalized,
            ("analiza", "analisis", "explica", "resume operativamente", "sugiere", "recomienda", "riesgo", "riesgos"),
        ):
            return True
        return False

    def _detect_missing_input(self, *, intent: str, site: Optional[Site], question: str) -> Optional[dict]:
        normalized = normalize_agent_text(question)
        if intent in SITE_REQUIRED_INTENTS and site is None and not self._question_mentions_all_sites(normalized):
            options = self._site_input_options()
            return {
                "answer": "Necesito un poco mas de contexto para responder bien esa consulta.",
                "follow_up_question": "De que sitio necesitas el detalle?",
                "missing_fields": ["site_code"],
                "input_options": options,
            }
        if intent == "help" and len(normalized.split()) <= 3:
            return {
                "answer": "Puedo ayudarte, pero la consulta viene muy abierta todavia.",
                "follow_up_question": "Quieres revisar monitoreo, alertas, semaforos, pantallas, productividad o zonas DET?",
                "missing_fields": ["topic"],
                "input_options": [
                    AgentInputOption(field="topic", value="monitoreo", label="Monitoreo"),
                    AgentInputOption(field="topic", value="alertas", label="Alertas"),
                    AgentInputOption(field="topic", value="semaforos", label="Semaforos"),
                    AgentInputOption(field="topic", value="pantallas", label="Pantallas"),
                    AgentInputOption(field="topic", value="productividad", label="Productividad"),
                    AgentInputOption(field="topic", value="zonas_det", label="Zonas DET"),
                ],
            }
        return None

    def _question_mentions_all_sites(self, normalized: str) -> bool:
        return self._mentions_any(normalized, ("todos los sitios", "por sitio", "cada sitio", "estado general", "general", "global", "todos"))

    def _site_input_options(self) -> list[AgentInputOption]:
        return [
            AgentInputOption(field="site_code", value=site.code, label=site.name)
            for site in self._scoped_sites(None)
        ]

    def _build_llm_context(self, *, site: Optional[Site], guided_answer: str) -> str:
        states = self._scoped_site_states(site)
        lines = [guided_answer.strip()]
        if states:
            lines.append("")
            lines.append("Snapshot estructurado:")
            for site_model, current in states:
                counts = count_visible_states(current.object_states)
                lines.append(
                    f"- {site_model.name}: fuente {normalize_source_status(current.source_status)}, "
                    f"{len(current.alerts)} alertas, "
                    f"{counts.get(CRITICAL, 0)} criticos, {counts.get(WARNING, 0)} warning, {counts.get(OFFLINE, 0)} offline, "
                    f"ultimo dato {format_dt(current.last_effective_record_at, site_model.timezone)}."
                )
        return "\n".join(lines).strip()

    def _resolve_response_artifacts(self, *, intent: str, question: str, site: Optional[Site]) -> dict[str, list]:
        normalized = normalize_agent_text(question)
        wants_chart = self._question_requests_chart(normalized)
        wants_table = self._question_requests_table(normalized)
        charts_raw: list[dict[str, Any]] = []
        tables: list[AgentTableArtifact] = []

        if intent == "graficos_productividad" or self._question_requests_productivity_visuals(normalized):
            productivity_charts = self._resolve_productivity_charts(question=question, site=site)
            if wants_chart or intent == "graficos_productividad":
                charts_raw = productivity_charts
            if wants_table:
                tables.extend(self._build_chart_tables(productivity_charts))
        elif wants_table:
            tables.extend(self._build_intent_tables(intent=intent, site=site))

        return {
            "charts": [AgentChartArtifact.model_validate(chart) for chart in charts_raw],
            "tables": tables,
        }

    def _question_requests_chart(self, normalized: str) -> bool:
        return self._mentions_any(normalized, CHART_REQUEST_TERMS)

    def _question_requests_table(self, normalized: str) -> bool:
        return self._mentions_any(normalized, TABLE_REQUEST_TERMS)

    def _question_requests_productivity_visuals(self, normalized: str) -> bool:
        if not normalized:
            return False
        if not (self._question_requests_chart(normalized) or self._question_requests_table(normalized)):
            return False
        if self._productivity_chart_keys_for_question(normalized):
            return True
        return self._mentions_any(normalized, PRODUCTIVITY_VISUAL_TERMS) or self._mentions_any(
            normalized,
            ("graficos del sistema", "graficos disponibles", "dashboard sismico", "dashboard de productividad"),
        )

    def _productivity_chart_keys_for_question(self, normalized: str) -> list[str]:
        matches: list[str] = []
        for chart_key, aliases in PRODUCTIVITY_CHART_ALIASES.items():
            if any(alias in normalized for alias in aliases):
                matches.append(chart_key)
        return matches

    def _resolve_productivity_range_key(self, normalized: str) -> str:
        if self._mentions_any(normalized, ("24h", "24 horas", "24 hrs", "hoy", "ultimo dia", "ultimas horas")):
            return "24h"
        if self._mentions_any(normalized, ("90 dias", "90d", "trimestre", "ultimos 3 meses")):
            return "90d"
        if self._mentions_any(normalized, ("30 dias", "30d", "mes", "ultimo mes")):
            return "30d"
        return "7d"

    def _resolve_productivity_charts(self, *, question: str, site: Optional[Site]) -> list[dict[str, Any]]:
        normalized = normalize_agent_text(question)
        dashboard = self.productivity.get_dashboard(
            site_code=(site.code if site else None),
            range_key=self._resolve_productivity_range_key(normalized),
            interval="auto",
            top_n=8,
        )
        charts = list(dashboard.get("charts") or [])
        selected_keys = self._productivity_chart_keys_for_question(normalized)
        if not selected_keys:
            return charts
        selected_set = set(selected_keys)
        return [chart for chart in charts if chart.get("key") in selected_set]

    def _build_chart_tables(self, charts: list[dict[str, Any]]) -> list[AgentTableArtifact]:
        return [self._chart_to_table_artifact(chart) for chart in charts]

    def _chart_to_table_artifact(self, chart: dict[str, Any]) -> AgentTableArtifact:
        chart_type = str(chart.get("type") or "line")
        if chart_type == "scatter":
            columns = [
                AgentTableColumn(key="label", label="Etiqueta"),
                AgentTableColumn(key="detail", label="Detalle"),
                AgentTableColumn(key="x", label=str(chart.get("x_label") or "X")),
                AgentTableColumn(key="y", label=str(chart.get("y_label") or "Y")),
                AgentTableColumn(key="status", label="Estado"),
            ]
            rows = [
                {
                    "label": point.get("label") or "",
                    "detail": point.get("detail") or "",
                    "x": point.get("x"),
                    "y": point.get("y"),
                    "status": point.get("status") or "",
                }
                for point in (chart.get("points") or [])
            ]
            return AgentTableArtifact(
                key=f"{chart.get('key')}_table",
                title=f"{chart.get('title')} / datos",
                subtitle=chart.get("subtitle"),
                columns=columns,
                rows=rows,
            )

        if chart_type == "horizontal_bar":
            columns = [
                AgentTableColumn(key="label", label="Etiqueta"),
                AgentTableColumn(key="detail", label="Detalle"),
                AgentTableColumn(key="value", label="Valor visible"),
                AgentTableColumn(key="raw_value", label="Valor numerico"),
                AgentTableColumn(key="secondary_label", label="Indicador secundario"),
                AgentTableColumn(key="secondary_value", label="Valor secundario visible"),
                AgentTableColumn(key="secondary_raw_value", label="Valor secundario numerico"),
            ]
            rows = [
                {
                    "label": item.get("label") or "",
                    "detail": item.get("detail") or "",
                    "value": item.get("value") or "",
                    "raw_value": item.get("raw_value"),
                    "secondary_label": item.get("secondary_label") or "",
                    "secondary_value": item.get("secondary_value") or "",
                    "secondary_raw_value": item.get("secondary_raw_value"),
                }
                for item in (chart.get("items") or [])
            ]
            return AgentTableArtifact(
                key=f"{chart.get('key')}_table",
                title=f"{chart.get('title')} / datos",
                subtitle=chart.get("subtitle"),
                columns=columns,
                rows=rows,
            )

        if chart_type == "segment_bar":
            columns = [
                AgentTableColumn(key="label", label="Etiqueta"),
                AgentTableColumn(key="value", label="Valor visible"),
                AgentTableColumn(key="raw_value", label="Valor numerico"),
            ]
            rows = [
                {
                    "label": item.get("label") or "",
                    "value": item.get("value") or "",
                    "raw_value": item.get("raw_value"),
                }
                for item in (chart.get("segments") or [])
            ]
            return AgentTableArtifact(
                key=f"{chart.get('key')}_table",
                title=f"{chart.get('title')} / datos",
                subtitle=chart.get("subtitle"),
                columns=columns,
                rows=rows,
            )

        series = list(chart.get("series") or [])
        categories = list(chart.get("categories") or [])
        columns = [AgentTableColumn(key="category", label="Categoria")]
        for item in series:
            columns.append(
                AgentTableColumn(
                    key=str(item.get("key") or item.get("label") or f"serie_{len(columns)}"),
                    label=str(item.get("label") or item.get("key") or "Serie"),
                )
            )
        rows = []
        for index, category in enumerate(categories):
            row: dict[str, Any] = {"category": category}
            for item in series:
                data = list(item.get("data") or [])
                row[str(item.get("key") or item.get("label") or f"serie_{index}")] = data[index] if index < len(data) else None
            rows.append(row)
        return AgentTableArtifact(
            key=f"{chart.get('key')}_table",
            title=f"{chart.get('title')} / datos",
            subtitle=chart.get("subtitle"),
            columns=columns,
            rows=rows,
        )

    def _build_intent_tables(self, *, intent: str, site: Optional[Site]) -> list[AgentTableArtifact]:
        builders = {
            "resumen_monitoreo": self._build_monitoring_table,
            "estado_fuentes": self._build_source_status_table,
            "ultimo_registro": self._build_last_records_table,
            "poligonos_alerta": self._build_polygons_alert_table,
            "alertas_abiertas": self._build_open_alerts_table,
            "ultimas_alertas": self._build_latest_alerts_table,
            "resumen_semaforos": self._build_semaforo_table,
            "estado_pantallas": self._build_screens_table,
            "resumen_productividad": self._build_productivity_summary_table,
            "zonas_configuradas": self._build_zones_table,
        }
        builder = builders.get(intent)
        if not builder:
            return []
        result = builder(site=site)
        return result if result else []

    def _build_monitoring_table(self, *, site: Optional[Site]) -> list[AgentTableArtifact]:
        states = self._scoped_site_states(site)
        rows = []
        for site_model, current in states:
            counts = count_visible_states(current.object_states)
            rows.append(
                {
                    "site_name": site_model.name,
                    "source_status": normalize_source_status(current.last_effective_source_status or current.source_status),
                    "alerts_open": len(current.alerts),
                    "critical": counts.get(CRITICAL, 0),
                    "warning": counts.get(WARNING, 0),
                    "offline": counts.get(OFFLINE, 0),
                    "last_record_at": format_dt(current.last_effective_record_at, site_model.timezone),
                }
            )
        return [
            AgentTableArtifact(
                key="monitoring_overview_table",
                title="Resumen del monitoreo actual",
                subtitle="Tabla exportable del estado visible por sitio.",
                columns=[
                    AgentTableColumn(key="site_name", label="Sitio"),
                    AgentTableColumn(key="source_status", label="Fuente"),
                    AgentTableColumn(key="alerts_open", label="Alertas abiertas"),
                    AgentTableColumn(key="critical", label="Critical"),
                    AgentTableColumn(key="warning", label="Warning"),
                    AgentTableColumn(key="offline", label="Offline"),
                    AgentTableColumn(key="last_record_at", label="Ultimo registro"),
                ],
                rows=rows,
            )
        ] if rows else []

    def _build_source_status_table(self, *, site: Optional[Site]) -> list[AgentTableArtifact]:
        states = self._scoped_site_states(site)
        rows = []
        for site_model, current in states:
            status = normalize_source_status(current.source_status)
            rows.append(
                {
                    "site_name": site_model.name,
                    "source_status": status,
                    "message": build_source_message(status) or "",
                    "last_sync_at": format_dt(current.last_sync_at, site_model.timezone),
                }
            )
        return [
            AgentTableArtifact(
                key="source_status_table",
                title="Estado actual de fuentes externas",
                subtitle="Tabla operativa exportable.",
                columns=[
                    AgentTableColumn(key="site_name", label="Sitio"),
                    AgentTableColumn(key="source_status", label="Estado"),
                    AgentTableColumn(key="message", label="Mensaje"),
                    AgentTableColumn(key="last_sync_at", label="Ultima sincronizacion"),
                ],
                rows=rows,
            )
        ] if rows else []

    def _build_last_records_table(self, *, site: Optional[Site]) -> list[AgentTableArtifact]:
        states = self._scoped_site_states(site)
        rows = []
        for site_model, current in states:
            rows.append(
                {
                    "site_name": site_model.name,
                    "recorded_at": format_dt(current.last_effective_record_at, site_model.timezone),
                    "source_status": normalize_source_status(current.last_effective_source_status),
                    "source_name": current.last_effective_source_name or "sin origen informado",
                }
            )
        return [
            AgentTableArtifact(
                key="last_records_table",
                title="Ultimo registro visible por sitio",
                subtitle="Fecha, estado y origen del ultimo dato visible.",
                columns=[
                    AgentTableColumn(key="site_name", label="Sitio"),
                    AgentTableColumn(key="recorded_at", label="Ultimo registro"),
                    AgentTableColumn(key="source_status", label="Estado fuente"),
                    AgentTableColumn(key="source_name", label="Origen"),
                ],
                rows=rows,
            )
        ] if rows else []

    def _build_polygons_alert_table(self, *, site: Optional[Site]) -> list[AgentTableArtifact]:
        rows = []
        for site_model, current in self._scoped_site_states(site):
            for item in current.object_states:
                state_code = (item.state_code or UNKNOWN).lower()
                if state_code not in {WARNING, CRITICAL, OFFLINE}:
                    continue
                rows.append(
                    {
                        "site_name": site_model.name,
                        "object_name": item.object_name,
                        "state_code": state_code,
                        "visible_value": item.label or item.value or "sin dato",
                        "observed_at": format_dt(item.observed_at, site_model.timezone),
                    }
                )
        return [
            AgentTableArtifact(
                key="polygons_alert_table",
                title="Poligonos con estado no normal",
                subtitle="Warning, critical y offline visibles en el filtro actual.",
                columns=[
                    AgentTableColumn(key="site_name", label="Sitio"),
                    AgentTableColumn(key="object_name", label="Poligono"),
                    AgentTableColumn(key="state_code", label="Estado"),
                    AgentTableColumn(key="visible_value", label="Valor visible"),
                    AgentTableColumn(key="observed_at", label="Observado"),
                ],
                rows=rows,
            )
        ] if rows else []

    def _build_open_alerts_table(self, *, site: Optional[Site]) -> list[AgentTableArtifact]:
        query = self.db.query(Site.name, func.count(AlertEvent.id)).join(AlertEvent, AlertEvent.site_id == Site.id).filter(
            Site.is_active == True,
            AlertEvent.status == "open",
        )
        if site:
            query = query.filter(Site.id == site.id)
        rows = [
            {"site_name": site_name, "alerts_open": int(count or 0)}
            for site_name, count in query.group_by(Site.id, Site.name).order_by(Site.name.asc()).all()
        ]
        return [
            AgentTableArtifact(
                key="open_alerts_table",
                title="Alertas abiertas por sitio",
                subtitle="Conteo de alertas activas exportable a CSV.",
                columns=[
                    AgentTableColumn(key="site_name", label="Sitio"),
                    AgentTableColumn(key="alerts_open", label="Alertas abiertas"),
                ],
                rows=rows,
            )
        ] if rows else []

    def _build_latest_alerts_table(self, *, site: Optional[Site]) -> list[AgentTableArtifact]:
        query = (
            self.db.query(AlertEvent, Site.name, MapObject.name)
            .join(Site, Site.id == AlertEvent.site_id)
            .outerjoin(MapObject, MapObject.id == AlertEvent.source_object_id)
            .filter(Site.is_active == True, AlertEvent.status == "open")
            .order_by(AlertEvent.opened_at.desc())
        )
        if site:
            query = query.filter(Site.id == site.id)
        rows = []
        for alert, site_name, object_name in query.limit(12).all():
            rows.append(
                {
                    "site_name": site_name,
                    "object_name": object_name or "sin poligono asociado",
                    "severity": alert.severity,
                    "status": alert.status,
                    "opened_at": format_dt(alert.opened_at),
                    "message": (alert.message or alert.title or "").strip(),
                }
            )
        return [
            AgentTableArtifact(
                key="latest_alerts_table",
                title="Alertas abiertas mas recientes",
                subtitle="Detalle exportable de las alertas activas.",
                columns=[
                    AgentTableColumn(key="site_name", label="Sitio"),
                    AgentTableColumn(key="object_name", label="Poligono"),
                    AgentTableColumn(key="severity", label="Severidad"),
                    AgentTableColumn(key="status", label="Estado"),
                    AgentTableColumn(key="opened_at", label="Abierta"),
                    AgentTableColumn(key="message", label="Mensaje"),
                ],
                rows=rows,
            )
        ] if rows else []

    def _build_semaforo_table(self, *, site: Optional[Site]) -> list[AgentTableArtifact]:
        rows = []
        for site_model in self._scoped_sites(site):
            devices = (
                self.db.query(func.count(SemaforoDevice.id))
                .filter(SemaforoDevice.site_id == site_model.id, SemaforoDevice.enabled == True)
                .scalar()
                or 0
            )
            rules = (
                self.db.query(func.count(SemaforoRule.id))
                .filter(SemaforoRule.site_id == site_model.id, SemaforoRule.enabled == True)
                .scalar()
                or 0
            )
            rows.append(
                {
                    "site_name": site_model.name,
                    "devices_enabled": int(devices),
                    "rules_enabled": int(rules),
                }
            )
        return [
            AgentTableArtifact(
                key="semaforo_summary_table",
                title="Resumen de semaforos y reglas activas",
                subtitle="Dispositivos y reglas habilitadas por sitio.",
                columns=[
                    AgentTableColumn(key="site_name", label="Sitio"),
                    AgentTableColumn(key="devices_enabled", label="Dispositivos habilitados"),
                    AgentTableColumn(key="rules_enabled", label="Reglas activas"),
                ],
                rows=rows,
            )
        ] if rows else []

    def _build_screens_table(self, *, site: Optional[Site]) -> list[AgentTableArtifact]:
        query = (
            self.db.query(Screen, Site.name)
            .join(Site, Site.id == Screen.site_id)
            .filter(Site.is_active == True, Screen.is_active == True)
            .order_by(Site.name.asc(), Screen.name.asc())
        )
        if site:
            query = query.filter(Site.id == site.id)
        rows = []
        for screen, site_name in query.all():
            rows.append(
                {
                    "site_name": site_name,
                    "screen_name": screen.name,
                    "status": screen.status_code,
                    "last_heartbeat": format_dt(screen.last_heartbeat_at),
                    "device": screen.device_label or screen.device_name or screen.code,
                }
            )
        return [
            AgentTableArtifact(
                key="screens_status_table",
                title="Pantallas registradas",
                subtitle="Estado y ultimo heartbeat de cada pantalla activa.",
                columns=[
                    AgentTableColumn(key="site_name", label="Sitio"),
                    AgentTableColumn(key="screen_name", label="Pantalla"),
                    AgentTableColumn(key="status", label="Estado"),
                    AgentTableColumn(key="last_heartbeat", label="Ultimo heartbeat"),
                    AgentTableColumn(key="device", label="Dispositivo"),
                ],
                rows=rows,
            )
        ] if rows else []

    def _build_productivity_summary_table(self, *, site: Optional[Site]) -> list[AgentTableArtifact]:
        dashboard = self.productivity.get_dashboard(
            site_code=(site.code if site else None),
            range_key="7d",
            interval="auto",
            top_n=8,
        )
        rows = [
            {
                "metric": item.get("label") or item.get("key") or "metrica",
                "value": item.get("value") or "",
                "helper": item.get("helper") or "",
            }
            for item in (dashboard.get("summary") or [])
        ]
        return [
            AgentTableArtifact(
                key="productivity_summary_table",
                title="Resumen de productividad sismica",
                subtitle="Mismas metricas del modulo de productividad.",
                columns=[
                    AgentTableColumn(key="metric", label="Metrica"),
                    AgentTableColumn(key="value", label="Valor"),
                    AgentTableColumn(key="helper", label="Detalle"),
                ],
                rows=rows,
            )
        ] if rows else []

    def _build_zones_table(self, *, site: Optional[Site]) -> list[AgentTableArtifact]:
        _ = site
        rows = [
            {
                "zone_name": zone.zone_name,
                "zone_key": zone.zone_key,
                "sort_order": zone.sort_order,
            }
            for zone in self.db.query(ModuleZoneDet).order_by(ModuleZoneDet.sort_order.asc(), ModuleZoneDet.id.asc()).all()
        ]
        return [
            AgentTableArtifact(
                key="zones_table",
                title="Zonas DET configuradas",
                subtitle="Listado exportable de zonas configuradas.",
                columns=[
                    AgentTableColumn(key="zone_name", label="Zona"),
                    AgentTableColumn(key="zone_key", label="Zone key"),
                    AgentTableColumn(key="sort_order", label="Orden"),
                ],
                rows=rows,
            )
        ] if rows else []

    def _answer_monitoring_overview(self, *, site: Optional[Site]) -> str:
        states = self._scoped_site_states(site)
        if not states:
            return "No hay sitios activos configurados para resumir el monitoreo."

        lines = ["Resumen del monitoreo actual:"]
        for site_model, current in states:
            counts = count_visible_states(current.object_states)
            lines.append(
                f"- {site_model.name}: fuente {normalize_source_status(current.last_effective_source_status)}, "
                f"{len(current.alerts)} alertas abiertas, "
                f"{counts.get(CRITICAL, 0)} criticos, {counts.get(WARNING, 0)} warning, "
                f"{counts.get(OFFLINE, 0)} offline. Ultimo registro {format_dt(current.last_effective_record_at, site_model.timezone)}."
            )
        return "\n".join(lines)

    def _answer_source_statuses(self, *, site: Optional[Site]) -> str:
        states = self._scoped_site_states(site)
        if not states:
            return "No hay sitios activos configurados para revisar las fuentes."

        lines = ["Estado actual de fuentes externas:"]
        for site_model, current in states:
            status = normalize_source_status(current.source_status)
            lines.append(
                f"- {site_model.name}: {status}. {build_source_message(status)}. "
                f"Ultima sincronizacion {format_dt(current.last_sync_at, site_model.timezone)}."
            )
        return "\n".join(lines)

    def _answer_last_records(self, *, site: Optional[Site]) -> str:
        states = self._scoped_site_states(site)
        if not states:
            return "No hay sitios activos configurados para revisar el ultimo registro."

        lines = ["Ultimo registro visible por sitio:"]
        for site_model, current in states:
            source_name = current.last_effective_source_name or "sin origen informado"
            lines.append(
                f"- {site_model.name}: {format_dt(current.last_effective_record_at, site_model.timezone)} / "
                f"{normalize_source_status(current.last_effective_source_status)} / {source_name}."
            )
        return "\n".join(lines)

    def _answer_polygons_in_alert(self, *, site: Optional[Site]) -> str:
        states = self._scoped_site_states(site)
        if not states:
            return "No hay sitios activos configurados para revisar poligonos."

        rows = []
        for site_model, current in states:
            for item in current.object_states:
                state_code = (item.state_code or UNKNOWN).lower()
                if state_code not in {WARNING, CRITICAL, OFFLINE}:
                    continue
                rows.append(
                    f"- {site_model.name} / {item.object_name}: {state_code}, "
                    f"valor visible {item.label or item.value or 'sin dato'}, "
                    f"observado {format_dt(item.observed_at, site_model.timezone)}."
                )

        if not rows:
            scope = site.name if site else "todos los sitios"
            return f"No hay poligonos en warning, critical u offline en {scope}."
        return "\n".join(["Poligonos con estado no normal:"] + rows)

    def _answer_open_alerts_count(self, *, site: Optional[Site]) -> str:
        query = self.db.query(Site.name, func.count(AlertEvent.id)).join(AlertEvent, AlertEvent.site_id == Site.id).filter(
            Site.is_active == True,
            AlertEvent.status == "open",
        )
        if site:
            query = query.filter(Site.id == site.id)
        rows = query.group_by(Site.id, Site.name).order_by(Site.name.asc()).all()
        if not rows:
            scope = site.name if site else "los sitios activos"
            return f"No hay alertas abiertas en {scope}."

        lines = ["Alertas abiertas por sitio:"]
        for site_name, count in rows:
            lines.append(f"- {site_name}: {int(count or 0)} alertas abiertas.")
        return "\n".join(lines)

    def _answer_latest_alerts(self, *, site: Optional[Site]) -> str:
        query = (
            self.db.query(AlertEvent, Site.name, MapObject.name)
            .join(Site, Site.id == AlertEvent.site_id)
            .outerjoin(MapObject, MapObject.id == AlertEvent.source_object_id)
            .filter(Site.is_active == True, AlertEvent.status == "open")
            .order_by(AlertEvent.opened_at.desc())
        )
        if site:
            query = query.filter(Site.id == site.id)
        rows = query.limit(8).all()
        if not rows:
            scope = site.name if site else "los sitios activos"
            return f"No hay alertas abiertas recientes en {scope}."

        lines = ["Alertas abiertas mas recientes:"]
        for alert, site_name, object_name in rows:
            object_label = object_name or "sin poligono asociado"
            message = (alert.message or alert.title or "").strip()
            lines.append(
                f"- {site_name} / {object_label}: severidad {alert.severity}, estado {alert.status}, "
                f"abierta {format_dt(alert.opened_at)}. {message}"
            )
        return "\n".join(lines)

    def _answer_semaforo_summary(self, *, site: Optional[Site]) -> str:
        sites = self._scoped_sites(site)
        if not sites:
            return "No hay sitios activos configurados para revisar semaforos."

        lines = ["Resumen de semaforos y reglas activas:"]
        for site_model in sites:
            devices = (
                self.db.query(func.count(SemaforoDevice.id))
                .filter(SemaforoDevice.site_id == site_model.id, SemaforoDevice.enabled == True)
                .scalar()
                or 0
            )
            rules = (
                self.db.query(func.count(SemaforoRule.id))
                .filter(SemaforoRule.site_id == site_model.id, SemaforoRule.enabled == True)
                .scalar()
                or 0
            )
            lines.append(f"- {site_model.name}: {int(devices)} dispositivos habilitados y {int(rules)} reglas activas.")
        return "\n".join(lines)

    def _answer_screen_status(self, *, site: Optional[Site]) -> str:
        query = (
            self.db.query(Screen, Site.name)
            .join(Site, Site.id == Screen.site_id)
            .filter(Site.is_active == True, Screen.is_active == True)
            .order_by(Site.name.asc(), Screen.name.asc())
        )
        if site:
            query = query.filter(Site.id == site.id)
        rows = query.all()
        if not rows:
            scope = site.name if site else "los sitios activos"
            return f"No hay pantallas activas registradas en {scope}."

        lines = ["Pantallas registradas:"]
        for screen, site_name in rows:
            device = screen.device_label or screen.device_name or screen.code
            lines.append(
                f"- {site_name} / {screen.name}: {screen.status_code}, "
                f"ultimo heartbeat {format_dt(screen.last_heartbeat_at)}. Dispositivo {device}."
            )
        return "\n".join(lines)

    def _answer_productivity_summary(self, *, site: Optional[Site]) -> str:
        dashboard = self.productivity.get_dashboard(
            site_code=(site.code if site else None),
            range_key="7d",
            interval="auto",
            top_n=8,
        )
        summary_items = list(dashboard.get("summary") or [])
        if not summary_items:
            return "No hay metricas de productividad sismica disponibles para este filtro."

        metrics = {item.get("key"): item for item in summary_items}
        return (
            "Resumen de productividad sismica:\n"
            f"- Eventos en rango: {metrics.get('events_total', {}).get('value', '0')}.\n"
            f"- Cambios criticos: {metrics.get('critical_events', {}).get('value', '0')}.\n"
            f"- Alertas abiertas: {metrics.get('alerts_open', {}).get('value', '0')}.\n"
            f"- Poligonos monitoreados: {metrics.get('polygons_total', {}).get('value', '0')}.\n"
            f"- Sync runs observados: {metrics.get('sync_runs_total', {}).get('value', '0')}.\n"
            f"- Ultimo dato visible: {metrics.get('last_visible_at', {}).get('value', 'Sin dato')}."
        )

    def _answer_productivity_visuals(self, *, site: Optional[Site]) -> str:
        scope = f" para {site.name}" if site else ""
        return (
            f"Te dejo la visualizacion solicitada del modulo de productividad sismica{scope}. "
            "Segun la consulta puedo adjuntar grafico, tabla o ambos, y cada resultado queda exportable."
        )

    def _answer_zones(self, *, site: Optional[Site]) -> str:
        _ = site
        rows = self.db.query(ModuleZoneDet).order_by(ModuleZoneDet.sort_order.asc(), ModuleZoneDet.id.asc()).all()
        if not rows:
            return "No hay zonas DET configuradas en la base de datos."

        lines = ["Zonas DET configuradas:"]
        for zone in rows:
            lines.append(f"- {zone.zone_name}: zone_key {zone.zone_key}, orden {zone.sort_order}.")
        return "\n".join(lines)

    def _answer_risks_current(self, *, site: Optional[Site]) -> str:
        states = self._scoped_site_states(site)
        if not states:
            return "No hay sitios activos configurados para evaluar riesgos."

        lines = ["Riesgos operativos visibles segun el estado actual:"]
        for site_model, current in states:
            counts = count_visible_states(current.object_states)
            status = normalize_source_status(current.last_effective_source_status or current.source_status)
            if counts.get(CRITICAL, 0):
                lines.append(
                    f"- {site_model.name}: prioridad alta por {counts.get(CRITICAL, 0)} poligonos en critical y {len(current.alerts)} alertas abiertas."
                )
            elif counts.get(WARNING, 0):
                lines.append(
                    f"- {site_model.name}: atencion preventiva por {counts.get(WARNING, 0)} poligonos en warning."
                )
            elif status in {"offline", "cached", "manual"}:
                lines.append(
                    f"- {site_model.name}: vigilar continuidad de lectura porque la fuente visible esta en {status}."
                )
        if len(lines) == 1:
            scope = site.name if site else "los sitios activos"
            return f"No veo riesgos destacados en {scope}; el monitoreo visible se mantiene estable."
        return "\n".join(lines)

    def _answer_recommended_actions(self, *, site: Optional[Site]) -> str:
        states = self._scoped_site_states(site)
        if not states:
            return "No hay sitios activos configurados para sugerir acciones."

        lines = ["Acciones operativas rapidas sugeridas:"]
        for site_model, current in states:
            counts = count_visible_states(current.object_states)
            if counts.get(CRITICAL, 0):
                lines.append(
                    f"- {site_model.name}: revisar de inmediato los poligonos en critical, validar fuente y confirmar semaforos asociados."
                )
            elif counts.get(WARNING, 0):
                lines.append(
                    f"- {site_model.name}: seguir la tendencia de los poligonos en warning y confirmar si hubo cambios recientes en la ultima lectura."
                )
            elif normalize_source_status(current.source_status) in {"offline", "cached"}:
                lines.append(
                    f"- {site_model.name}: verificar conectividad o polling porque la fuente externa no esta entregando lectura online."
                )
        if len(lines) == 1:
            lines.append("- Mantener monitoreo rutinario; no se detectan acciones urgentes con el contexto actual.")
        return "\n".join(lines)

    def _answer_explain_site(self, *, site: Optional[Site]) -> str:
        if site is None:
            return "Necesito el sitio para poder explicar el contexto operativo en detalle."
        current = self.sismico.get_site_current_state(site.code)
        counts = count_visible_states(current.object_states)
        return (
            f"{site.name} muestra fuente {normalize_source_status(current.last_effective_source_status or current.source_status)}, "
            f"{len(current.alerts)} alertas abiertas, "
            f"{counts.get(CRITICAL, 0)} poligonos en critical, {counts.get(WARNING, 0)} en warning y "
            f"{counts.get(OFFLINE, 0)} offline. "
            f"El ultimo registro visible es {format_dt(current.last_effective_record_at, site.timezone)}."
        )

    def _answer_status_glossary(self, *, site: Optional[Site]) -> str:
        _ = site
        return (
            "Estados que usa el sistema:\n"
            "- online: la fuente externa respondio y el ultimo dato visible es vigente.\n"
            "- cached: no hubo lectura nueva, pero el sistema mantiene la ultima captura valida.\n"
            "- manual: el ultimo estado visible fue aplicado manualmente por un operador.\n"
            "- offline: no hay lectura vigente y el sistema no tiene una actualizacion utilizable.\n"
            "- warning y critical: son estados del poligono visible, no necesariamente del enlace remoto."
        )

    def _answer_help(self, *, site: Optional[Site]) -> str:
        scope = f" para {site.name}" if site else ""
        suggestions = ", ".join(item.question for item in self._suggestion_items(None)[:4])
        llm_note = " Tambien puedo usar IA rapida con Ollama para explicaciones y recomendaciones." if self._can_use_ollama() else ""
        return (
            f"Puedo responder consultas del sistema sismico{scope} sobre monitoreo, alertas, semaforos, pantallas, productividad y zonas DET.\n"
            f"Prueba con alguna de estas preguntas: {suggestions}.{llm_note}"
        )

    def _scoped_site_states(self, site: Optional[Site]):
        states = []
        for site_model in self._scoped_sites(site):
            states.append((site_model, self.sismico.get_site_current_state(site_model.code)))
        return states

    def _scoped_sites(self, site: Optional[Site]) -> list[Site]:
        if site:
            return [site]
        return (
            self.db.query(Site)
            .filter(Site.is_active == True)
            .order_by(Site.name.asc())
            .all()
        )

    def _resolve_site(self, site_code: Optional[str], question: Optional[str]) -> Optional[Site]:
        explicit = normalize_site_code(site_code or "")
        if explicit:
            found = self.db.query(Site).filter(Site.code == explicit, Site.is_active == True).first()
            if found:
                return found

        normalized_question = normalize_agent_text(question)
        if not normalized_question:
            return None

        sites = self.db.query(Site).filter(Site.is_active == True).all()
        for site in sites:
            candidates = {
                normalize_agent_text(site.code),
                normalize_agent_text(site.code.replace("_", " ")),
                normalize_agent_text(site.name),
            }
            if any(candidate and candidate in normalized_question for candidate in candidates):
                return site
        return None

    def _resolve_faq_item(self, faq_id: Optional[str], question: Optional[str]) -> Optional[AgentFaqItem]:
        if faq_id:
            if faq_id in FAQ_BY_ID:
                return self._faq_definition_to_item(FAQ_BY_ID[faq_id])
            custom = self._custom_faq_item_by_id(faq_id)
            if custom:
                return custom

        normalized_question = normalize_agent_text(question)
        if not normalized_question:
            return None
        for faq in FAQ_DEFINITIONS:
            if normalize_agent_text(faq.question) == normalized_question:
                return self._faq_definition_to_item(faq)
        return None

    def _resolve_custom_answer(self, faq_id: Optional[str], question: Optional[str]) -> Optional[str]:
        row = None
        if faq_id and str(faq_id).startswith("custom:"):
            raw_id = str(faq_id).split(":", 1)[1]
            if raw_id.isdigit():
                row = self.db.query(ModuleAIFaq).filter(ModuleAIFaq.id == int(raw_id)).first()
        if row is None and question:
            row = (
                self.db.query(ModuleAIFaq)
                .filter(func.lower(ModuleAIFaq.question) == (question or "").strip().lower())
                .first()
            )
        if row and row.answer and not is_placeholder_answer(row.answer) and not self._is_sensitive_answer(row.answer):
            return row.answer.strip()
        return None

    def _custom_faq_item_by_id(self, faq_id: str) -> Optional[AgentFaqItem]:
        if not faq_id.startswith("custom:"):
            return None
        raw_id = faq_id.split(":", 1)[1]
        if not raw_id.isdigit():
            return None
        row = self.db.query(ModuleAIFaq).filter(ModuleAIFaq.id == int(raw_id)).first()
        if not row or not row.answer or is_placeholder_answer(row.answer) or self._is_sensitive_answer(row.answer):
            return None
        return AgentFaqItem(
            id=f"custom:{row.id}",
            category_id="personalizadas",
            question=row.question,
            description="Pregunta personalizada cargada en base de datos.",
        )

    def _custom_faq_items(self) -> list[AgentFaqItem]:
        rows = (
            self.db.query(ModuleAIFaq)
            .filter(ModuleAIFaq.question.isnot(None), ModuleAIFaq.answer.isnot(None))
            .order_by(ModuleAIFaq.id.asc())
            .all()
        )
        items = []
        for row in rows:
            if is_placeholder_answer(row.answer) or self._is_sensitive_answer(row.answer):
                continue
            items.append(
                AgentFaqItem(
                    id=f"custom:{row.id}",
                    category_id="personalizadas",
                    question=row.question,
                    description="Pregunta personalizada cargada en base de datos.",
                )
            )
        return items

    def _detect_intent(self, question: str) -> Optional[str]:
        normalized = normalize_agent_text(question)
        if not normalized:
            return None

        if self._question_requests_productivity_visuals(normalized):
            return "graficos_productividad"
        if self._mentions_any(normalized, ("riesgo", "riesgos")) and self._mentions_any(normalized, ("operativo", "visibles", "actual", "ahora")):
            return "riesgos_actuales"
        if self._mentions_any(normalized, ("sugiere", "recomienda", "acciones")) and self._mentions_any(
            normalized,
            ("operativas", "operativa", "rapidas", "sistema", "estado actual"),
        ):
            return "acciones_recomendadas"
        if self._mentions_any(normalized, ("explicame", "explica", "que esta pasando", "resumen simple")) and self._mentions_any(
            normalized,
            ("sitio", "faena", "sector", "andes", "diamante", "esmeralda", "pilar", "andesita"),
        ):
            return "explica_sitio"
        if self._mentions_any(normalized, ("que significa", "que significan", "explica", "como interpretar")) and self._mentions_any(
            normalized,
            ("online", "offline", "cached", "manual", "warning", "critical"),
        ):
            return "glosario_estados"
        if self._mentions_any(normalized, ("zona", "zonas")) and "det" in normalized:
            return "zonas_configuradas"
        if self._mentions_any(normalized, ("productividad", "energia", "eventos", "sector")):
            return "resumen_productividad"
        if self._mentions_any(normalized, ("pantalla", "pantallas", "heartbeat")):
            return "estado_pantallas"
        if self._mentions_any(normalized, ("semaforo", "semaforos", "control vial")):
            return "resumen_semaforos"
        if "alerta" in normalized and self._mentions_any(normalized, ("ultima", "ultimas", "reciente", "recientes", "detalle", "muestrame")):
            return "ultimas_alertas"
        if "alerta" in normalized:
            return "alertas_abiertas"
        if self._mentions_any(normalized, ("poligono", "poligonos", "objeto", "objetos")) and self._mentions_any(
            normalized,
            ("warning", "critical", "critico", "alerta", "offline"),
        ):
            return "poligonos_alerta"
        if self._mentions_any(normalized, ("ultimo registro", "ultima lectura", "ultima captura", "ultimo dato")):
            return "ultimo_registro"
        if self._mentions_any(normalized, ("online", "offline", "cached", "manual", "fuente", "sin lectura", "sincronizacion")):
            return "estado_fuentes"
        if self._mentions_any(normalized, ("resumen", "monitoreo", "sitios", "sitio", "estado general")):
            return "resumen_monitoreo"
        if self._mentions_any(normalized, ("analiza", "analisis", "explica", "sugiere", "recomienda", "riesgo", "riesgos")):
            return "help"
        return None

    def _suggestion_items(self, intent: Optional[str]) -> list[AgentFaqItem]:
        available_faqs = [faq for faq in FAQ_DEFINITIONS if faq.category_id != "analisis" or self._can_use_ollama()]
        if intent and intent in FAQ_BY_ID:
            category_id = FAQ_BY_ID[intent].category_id
            related = [faq for faq in available_faqs if faq.category_id == category_id and faq.id != intent]
            if related:
                return [self._faq_definition_to_item(faq) for faq in related[:3]]
        return [self._faq_definition_to_item(faq) for faq in available_faqs[:4]]

    def _faq_definition_to_item(self, faq: AgentFaqDefinition) -> AgentFaqItem:
        return AgentFaqItem(
            id=faq.id,
            category_id=faq.category_id,
            question=faq.question,
            description=faq.description,
        )

    def _log_consult(self, *, question: str, answer: str) -> None:
        try:
            self.db.add(ModuleAIConsultLog(question=question, answer=answer))
            self.db.commit()
        except Exception:
            self.db.rollback()

    @staticmethod
    def _mentions_any(normalized: str, terms: Iterable[str]) -> bool:
        return any(term in normalized for term in terms)
