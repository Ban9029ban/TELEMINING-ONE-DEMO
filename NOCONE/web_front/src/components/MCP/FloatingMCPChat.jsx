import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  BsArrowClockwise,
  BsBoxArrowUpRight,
  BsChatDotsFill,
  BsCheck2Circle,
  BsChevronDown,
  BsCpu,
  BsExclamationTriangle,
  BsGeoAltFill,
  BsPerson,
  BsSendFill,
  BsStars,
  BsTrash3,
} from "react-icons/bs";
import { useLocation } from "react-router-dom";

import { API_URL } from "../../api-config";
import ChartsAgents from "./ChartsAgents";
import TablesAgents from "./TablesAgents";
import "./mcp.css";

const DEFAULT_STATUS = {
  ollama: {
    host: "",
    model: "",
    configured_model: "",
    ready: false,
    reachable: false,
    model_available: false,
    fallback_model_active: false,
    available_models: [],
    error: null,
  },
  policies: {
    read_only: true,
    blocks_secrets: true,
    blocks_mutations: true,
  },
};

const MCP_STATUS_TIMEOUT = 12000;
const MCP_QUERY_TIMEOUT = 75000;
const MCP_AUX_TIMEOUT = 20000;

const MODULE_CONTEXT = [
  {
    match: "/cameras/ver",
    title: "Videoanalítica CCTV",
    description: "Estás viendo una cámara puntual con analítica y hallazgos asociados.",
    quickPrompts: [
      "Resume la cámara activa y los hallazgos recientes asociados.",
      "Explícame qué riesgos operacionales debería revisar primero en esta cámara.",
    ],
  },
  {
    match: "/cameras/nok",
    title: "NOC",
    description: "Estás monitoreando disponibilidad de cámaras IP, alertas offline y estado por plano.",
    quickPrompts: [
      "Resume qué cámaras están offline, desde cuándo y en qué plano se encuentran.",
      "Qué cámaras debería priorizar para recuperación según duración de la caída.",
    ],
  },
  {
    match: "/cameras",
    title: "Centro de cámaras",
    description: "Estás revisando el plano CCTV, hallazgos y resumen en vivo del sistema.",
    quickPrompts: [
      "Dame un resumen del mapa de cámaras, hallazgos activos y cobertura actual.",
      "Qué cámaras concentran más hallazgos y qué tipo de alertas están apareciendo.",
    ],
  },
  {
    match: "/access",
    title: "Control de accesos",
    description: "Estás mirando interiores, pórticos y trazabilidad operacional de accesos.",
    quickPrompts: [
      "Resume personas, vehículos y pórticos visibles en acceso.",
      "¿Hay diferencias relevantes entre ingresos y salidas en este momento?",
    ],
  },
  {
    match: "/productividad",
    title: "Productividad",
    description: "Estás revisando gráficos y lectura ejecutiva de operación.",
    quickPrompts: [
      "Explícame los gráficos visibles y qué lectura operativa sacarías de ellos.",
      "Qué indicadores debería priorizar en productividad hoy.",
    ],
  },
  {
    match: "/config",
    title: "Configuración",
    description: "Estás navegando maestros operacionales, personas, tags y pórticos.",
    quickPrompts: [
      "Qué entidades maestras existen en esta configuración y para qué sirven.",
      "Qué validaciones debería revisar antes de cambiar maestros operacionales.",
    ],
  },
  {
    match: "/lobby",
    title: "Zonas DET",
    description: "Estás sobre una vista espacial y de zonas de trabajo.",
    quickPrompts: [
      "Resume la distribución visible por zonas y riesgos potenciales.",
      "Qué lectura rápida puedes hacer de esta pantalla espacial.",
    ],
  },
  {
    match: "/semaforos-control-vial",
    title: "Control vial",
    description: "Estás viendo el estado operacional de circulación y flujo vehicular.",
    quickPrompts: [
      "Resume el estado vial actual y qué alertas debería vigilar.",
      "Qué lectura operacional haces del control vial visible.",
    ],
  },
  {
    match: "/",
    title: "Tracking y flota",
    description: "Estás revisando tracking, waypoints, pórticos y acumulados de flota.",
    quickPrompts: [
      "Resume tracking y flota de la pantalla activa.",
      "Qué waypoints o pórticos destacan por cantidad de personas, vehículos o equipos.",
    ],
  },
];

function getModuleContext(pathname) {
  const found = MODULE_CONTEXT.find((item) =>
    item.match === "/" ? pathname === "/" : pathname.startsWith(item.match)
  );
  return found || MODULE_CONTEXT[MODULE_CONTEXT.length - 1];
}

function buildWelcomeMessage(moduleInfo) {
  return {
    id: "floating-welcome",
    role: "assistant",
    createdAt: new Date().toISOString(),
    structured: {
      headline: "Agente IA TM One listo en esta pantalla",
      summary:
        "Puedo conversar contigo desde cualquier módulo, leer datos operacionales en modo seguro y ayudarte a interpretar lo que ves en la vista actual.",
      details: [
        `Pantalla activa: ${moduleInfo.title}.`,
        moduleInfo.description,
      ],
      actions: [
        "Pide un resumen de esta pantalla.",
        "Pregunta por hallazgos, personas, vehículos, pórticos, agentes ambientales o tendencias.",
      ],
      warnings: ["Politica activa: solo lectura, sin secretos y sin cambios sobre la data."],
      follow_ups: [
        ...moduleInfo.quickPrompts,
        "Que informacion puedes consultar de la base de datos de forma segura.",
      ],
      confidence: "alta",
    },
    answer: "Agente IA TM One listo para ayudarte desde la pantalla activa.",
    sources: ["bienvenida del asistente"],
  };
}

function formatTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function messageToHistoryContent(message) {
  if (message.structured) {
    const parts = [
      message.structured.headline,
      message.structured.summary,
      ...(message.structured.details || []),
      ...(message.structured.evidence || []),
      ...(message.structured.actions || []),
    ].filter(Boolean);
    return parts.join("\n");
  }
  return message.answer || message.content || "";
}

function buildHistory(messages) {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-8)
    .map((message) => ({
      role: message.role,
      content: messageToHistoryContent(message).slice(0, 1800),
    }))
    .filter((item) => item.content.trim());
}

function buildFactsMessage(data) {
  const synonyms = data?.synonyms || {};
  const categories = Object.keys(synonyms);

  return {
    id: `facts-${Date.now()}`,
    role: "assistant",
    createdAt: new Date().toISOString(),
    structured: {
      headline: "Diccionario operacional cargado",
      summary:
        categories.length > 0
          ? `El agente tiene ${categories.length} grupos de sinonimos mineros para interpretar mejor tus preguntas.`
          : "No se encontraron sinonimos cargados en este ambiente.",
      details: categories.map(
        (category) =>
          `${category}: ${Object.keys(synonyms[category] || {}).length} sinonimos configurados.`
      ),
      follow_ups: [
        "Explicame como usas estos sinonimos en una consulta.",
        "Dame ejemplos de preguntas operacionales que entiendes mejor con este vocabulario.",
      ],
      confidence: "alta",
    },
    answer: "Diccionario operacional cargado.",
    sources: ["mining_synonyms.json"],
  };
}

function buildCatalogMessage(data) {
  const tables = Array.isArray(data?.tables) ? data.tables : [];

  return {
    id: `catalog-${Date.now()}`,
    role: "assistant",
    createdAt: new Date().toISOString(),
    structured: {
      headline: "Catálogo de datos habilitado para IA",
      summary: `Tengo ${tables.length} estructuras habilitadas en modo solo lectura para responder consultas seguras.`,
      details: [
        "Solo se muestran tablas y campos aprobados para el agente.",
        "No se exponen usuarios del sistema, claves, tokens ni secretos.",
      ],
      follow_ups: [
        "Explicame que tablas usas para accesos y permanencias.",
        "Muestrame que datos puedes consultar sobre agentes ambientales y alertas.",
      ],
      confidence: "alta",
    },
    answer: "Catálogo de datos habilitado para IA.",
    tables: [
      {
        title: "Tablas expuestas al agente",
        columns: ["tabla", "descripcion", "campos"],
        rows: tables.map((table) => ({
          tabla: table.table,
          descripcion: table.description,
          campos: (table.columns || []).map((column) => column.label || column.name).join(", "),
        })),
      },
    ],
    sources: ["mcp/catalog"],
  };
}

function MessageList({ title, items, tone = "default" }) {
  if (!Array.isArray(items) || items.length === 0) return null;

  const toneClass =
    tone === "warning"
      ? "border-amber-200 bg-amber-50/90 text-amber-900"
      : "border-slate-200 bg-slate-50/90 text-slate-700";

  return (
    <div className={`rounded-[16px] border px-3 py-3 ${toneClass}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {title}
      </div>
      <ul className="mt-2 space-y-1.5 text-sm leading-5">
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function AssistantBubble({ message, onQuickQuestion, disabled }) {
  const structured = message.structured;

  return (
    <article className="rounded-[24px] bg-[linear-gradient(145deg,#0f172a_0%,#1e293b_100%)] p-4 text-white shadow-[0_18px_36px_rgba(15,23,42,0.22)]">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-lg text-white">
          <BsStars />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <strong className="text-sm font-semibold">Agente IA TM One</strong>
            <span className="text-[11px] text-white/70">{formatTimestamp(message.createdAt)}</span>
          </div>

          {structured ? (
            <div className="mt-3 space-y-3">
              <div>
                <div className="text-base font-semibold">{structured.headline}</div>
                <p className="mt-1 text-sm leading-6 text-white/85">{structured.summary}</p>
              </div>

              <MessageList title="Contexto" items={structured.details} />
              <MessageList title="Datos destacados" items={structured.evidence} />
              <MessageList title="Siguientes pasos" items={structured.actions} />
              <MessageList title="Advertencias" items={structured.warnings} tone="warning" />
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-white/85">{message.answer || "Sin respuesta."}</p>
          )}

          {message.tables?.length ? (
            <div className="mt-3 max-h-[280px] overflow-auto rounded-[18px] bg-white/5 p-2">
              <TablesAgents tables={message.tables} exportToken={message.exportToken} />
            </div>
          ) : null}

          {message.charts?.length ? (
            <div className="mt-3 max-h-[320px] overflow-auto rounded-[18px] bg-white/5 p-2">
              <ChartsAgents charts={message.charts} />
            </div>
          ) : null}

          {message.sources?.length ? (
            <div className="mt-3 text-[11px] text-white/65">
              Fuentes: {message.sources.join(", ")}
            </div>
          ) : null}

          {structured?.follow_ups?.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {structured.follow_ups.map((item, index) => (
                <button
                  key={`${message.id}-follow-${index}`}
                  type="button"
                  disabled={disabled}
                  onClick={() => onQuickQuestion(item)}
                  className="rounded-full border border-white/16 bg-white/8 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/14 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {item}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function UserBubble({ message }) {
  return (
    <article className="ml-10 rounded-[24px] border border-slate-200 bg-white p-4 text-slate-800 shadow-[0_16px_32px_rgba(15,23,42,0.08)]">
      <div className="flex items-center justify-between gap-3">
        <strong className="text-sm font-semibold">Tu consulta</strong>
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <span>{formatTimestamp(message.createdAt)}</span>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-100 text-sky-700">
            <BsPerson />
          </span>
        </div>
      </div>
      <p className="mt-2 text-sm leading-6">{message.content}</p>
    </article>
  );
}

function buildSelectOptions(items, valueKey = "id", labelKey = "nombre") {
  return Array.isArray(items)
    ? items.map((item) => ({
        value: item?.[valueKey] ?? "",
        label: item?.[labelKey] ?? item?.[valueKey] ?? "",
      }))
    : [];
}

const FloatingMCPChat = () => {
  const location = useLocation();
  const activeModule = useMemo(() => getModuleContext(location.pathname), [location.pathname]);
  const conversationEndRef = useRef(null);

  const [isOpen, setIsOpen] = useState(() => localStorage.getItem("tmOneFloatingChatOpen") === "true");
  const [showFilters, setShowFilters] = useState(
    () => localStorage.getItem("tmOneFloatingChatFiltersOpen") === "true"
  );
  const [showSuggestions, setShowSuggestions] = useState(
    () => localStorage.getItem("tmOneFloatingChatSuggestionsOpen") === "true"
  );
  const [bootLoaded, setBootLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState("auto");
  const [site, setSite] = useState("");
  const [zoneCandidate, setZoneCandidate] = useState("");
  const [zones, setZones] = useState([]);
  const [messages, setMessages] = useState(() => [buildWelcomeMessage(activeModule)]);
  const [status, setStatus] = useState(DEFAULT_STATUS);
  const [sites, setSites] = useState([]);
  const [availableZones, setAvailableZones] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [bootError, setBootError] = useState("");

  useEffect(() => {
    localStorage.setItem("tmOneFloatingChatOpen", String(isOpen));
  }, [isOpen]);

  useEffect(() => {
    localStorage.setItem("tmOneFloatingChatFiltersOpen", String(showFilters));
  }, [showFilters]);

  useEffect(() => {
    localStorage.setItem("tmOneFloatingChatSuggestionsOpen", String(showSuggestions));
  }, [showSuggestions]);

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading, isOpen]);

  useEffect(() => {
    setMessages((current) =>
      current.map((message) =>
        message.id === "floating-welcome"
          ? {
              ...buildWelcomeMessage(activeModule),
              createdAt: message.createdAt,
            }
          : message
      )
    );
  }, [activeModule]);

  useEffect(() => {
    if (!isOpen || bootLoaded) {
      return undefined;
    }

    let active = true;

    async function loadBootData() {
      try {
        const results = await Promise.allSettled([
          axios.get(`${API_URL}/mcp/status`, { timeout: MCP_STATUS_TIMEOUT }),
          axios.get(`${API_URL}/zenit/selector-sitios`, { timeout: MCP_STATUS_TIMEOUT }),
          axios.get(`${API_URL}/zenit/selector-zonas`, { timeout: MCP_STATUS_TIMEOUT }),
        ]);

        if (!active) return;

        const [statusResp, sitesResp, zonesResp] = results;

        if (statusResp.status === "fulfilled") {
          setStatus(statusResp.value.data || DEFAULT_STATUS);
        }
        if (sitesResp.status === "fulfilled") {
          setSites(sitesResp.value.data?.items || []);
        }
        if (zonesResp.status === "fulfilled") {
          setAvailableZones(zonesResp.value.data?.items || []);
        }

        const failed = results.filter((result) => result.status === "rejected").length;
        if (failed > 0) {
          setBootError(
            "Parte del contexto inicial no cargo completo. El agente sigue disponible, pero algunos filtros pueden verse incompletos."
          );
        }
      } catch (error) {
        if (!active) return;
        setBootError(
          "No se pudo cargar el estado inicial del agente. Aún así puedes conversar con la IA."
        );
      } finally {
        if (active) {
          setBootLoaded(true);
        }
      }
    }

    loadBootData();

    return () => {
      active = false;
    };
  }, [bootLoaded, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const interval = window.setInterval(async () => {
      try {
        const response = await axios.get(`${API_URL}/mcp/status`, { timeout: MCP_STATUS_TIMEOUT });
        setStatus(response.data || DEFAULT_STATUS);
      } catch (error) {
        setStatus((current) => ({
          ...current,
          ollama: {
            ...current.ollama,
            ready: false,
            reachable: false,
            model_available: false,
            error: "No se pudo refrescar el estado de Ollama.",
          },
        }));
      }
    }, 45000);

    return () => window.clearInterval(interval);
  }, [isOpen]);

  const siteOptions = useMemo(() => buildSelectOptions(sites), [sites]);
  const zoneOptions = useMemo(() => buildSelectOptions(availableZones), [availableZones]);
  const activeSiteLabel =
    siteOptions.find((item) => String(item.value) === String(site))?.label || "Todos los sitios";
  const currentModeLabel =
    mode === "datos"
      ? "Modo datos"
      : mode === "analisis"
      ? "Modo analisis"
      : mode === "ayuda"
      ? "Modo ayuda"
      : "Modo auto";
  const filterSummary = `${currentModeLabel} - ${activeSiteLabel} - ${
    zones.length > 0 ? `${zones.length} ${zones.length === 1 ? "zona" : "zonas"}` : "sin zonas"
  }`;

  const statusLabel = status.ollama.ready ?? status.ollama.reachable;
  const aiReady = Boolean(statusLabel);
  const statusText = aiReady
    ? `IA lista con ${status.ollama.model || status.ollama.configured_model || "modelo configurado"}`
    : status.ollama.reachable
    ? "Ollama activo sin modelo listo"
    : "IA con conectividad pendiente";

  const promptChips = useMemo(
    () => [
      ...activeModule.quickPrompts.map((item) => ({ label: item, question: item })),
      {
        label: "Catálogo IA",
        question: "Que informacion puedes consultar de la base de datos de forma segura.",
        action: "catalog",
      },
      {
        label: "Vocabulario minero",
        question: "Cargame el vocabulario minero disponible.",
        action: "facts",
      },
    ],
    [activeModule]
  );

  const addZone = () => {
    const normalized = zoneCandidate.trim();
    if (!normalized) return;
    setZones((current) => {
      if (current.includes(normalized)) return current;
      return [...current, normalized];
    });
    setZoneCandidate("");
  };

  const removeZone = (zone) => {
    setZones((current) => current.filter((item) => item !== zone));
  };

  const clearConversation = () => {
    setMessages([buildWelcomeMessage(activeModule)]);
    setDraft("");
    setErrorMsg("");
  };

  const refreshStatus = async () => {
    try {
      const response = await axios.get(`${API_URL}/mcp/status`, { timeout: MCP_STATUS_TIMEOUT });
      setStatus(response.data || DEFAULT_STATUS);
    } catch (error) {
      setStatus((current) => ({
        ...current,
        ollama: {
          ...current.ollama,
          ready: false,
          reachable: false,
          model_available: false,
          error: "No se pudo refrescar el estado de Ollama.",
        },
      }));
    }
  };

  const pushUserMessage = (content) => ({
    id: `floating-user-${Date.now()}`,
    role: "user",
    content,
    createdAt: new Date().toISOString(),
  });

  const pushAssistantFromApi = (data) => ({
    id: `floating-assistant-${Date.now()}`,
    role: "assistant",
    answer: data?.answer || "",
    structured: data?.structured || null,
    tables: Array.isArray(data?.tables) ? data.tables : [],
    charts: Array.isArray(data?.charts) ? data.charts : [],
    exportToken: data?.export_token || null,
    sources: Array.isArray(data?.sources) ? data.sources : [],
    model: data?.model || null,
    mode: data?.mode || "auto",
    createdAt: new Date().toISOString(),
  });

  const buildPayload = (questionText, historyMessages) => ({
    pregunta: questionText,
    mode,
    site: site || null,
    zonas: zones,
    history: buildHistory(historyMessages),
    active_module: activeModule.title,
    active_path: location.pathname,
  });

  const submitQuestion = async (forcedQuestion) => {
    const questionText = (forcedQuestion || draft).trim();
    if (!questionText) {
      setErrorMsg("Escribe una pregunta para continuar.");
      return;
    }

    const userMessage = pushUserMessage(questionText);
    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setErrorMsg("");
    setLoading(true);

    try {
      const response = await axios.post(
        `${API_URL}/mcp/consulta`,
        buildPayload(questionText, messages),
        { timeout: MCP_QUERY_TIMEOUT }
      );

      setMessages((current) => [...current, pushAssistantFromApi(response.data)]);
      refreshStatus();
    } catch (error) {
      setErrorMsg(
        "No pude completar la consulta en este momento. El agente no respondio a tiempo o perdio conectividad."
      );
      setMessages((current) => [
        ...current,
        {
          id: `floating-assistant-error-${Date.now()}`,
          role: "assistant",
          createdAt: new Date().toISOString(),
          structured: {
            headline: "No pude responder ahora",
            summary:
              "La consulta no terminó correctamente, pero podemos reintentarlo con más contexto o cambiar el enfoque.",
            details: [
              "Prueba filtrando por sitio o zona.",
              "Si quieres, formula una consulta de datos concreta o una pregunta de ayuda.",
            ],
            follow_ups: [
              "Que informacion puedes consultar de la base de datos de forma segura.",
              "Hazme una pregunta guiada para construir una consulta más precisa.",
            ],
            warnings: [
              error?.response?.data?.detail ||
                "El backend o la capa de IA no respondieron como se esperaba.",
            ],
            confidence: "baja",
          },
          sources: ["fallback frontend"],
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickQuestion = async (item) => {
    const question = typeof item === "string" ? item : item?.question || item?.label || "";
    const action = typeof item === "string" ? null : item?.action || null;
    const nextMode = typeof item === "string" ? null : item?.mode || null;

    if (nextMode) {
      setMode(nextMode);
    }

    if (action === "facts") {
      setLoading(true);
      setErrorMsg("");
      setMessages((current) => [...current, pushUserMessage(question)]);
      try {
        const response = await axios.get(`${API_URL}/mcp/facts`, { timeout: MCP_AUX_TIMEOUT });
        setMessages((current) => [...current, buildFactsMessage(response.data)]);
      } catch (error) {
        setErrorMsg("No se pudo cargar el diccionario minero en este momento.");
      } finally {
        setLoading(false);
      }
      return;
    }

    if (action === "catalog") {
      setLoading(true);
      setErrorMsg("");
      setMessages((current) => [...current, pushUserMessage(question)]);
      try {
        const response = await axios.get(`${API_URL}/mcp/catalog`, { timeout: MCP_AUX_TIMEOUT });
        setMessages((current) => [...current, buildCatalogMessage(response.data)]);
      } catch (error) {
        setErrorMsg("No se pudo cargar el catalogo del agente en este momento.");
      } finally {
        setLoading(false);
      }
      return;
    }

    await submitQuestion(question);
  };

  if (location.pathname.startsWith("/mcp")) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed bottom-4 left-3 right-3 z-[80] flex justify-end sm:bottom-5 sm:left-auto sm:right-5">
      {!isOpen ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="pointer-events-auto inline-flex items-center gap-3 rounded-full bg-[linear-gradient(135deg,#2563eb_0%,#4338ca_100%)] px-3 py-3 text-white shadow-[0_24px_44px_rgba(37,99,235,0.28)] transition hover:translate-y-[-1px] hover:shadow-[0_30px_52px_rgba(37,99,235,0.34)] sm:px-4"
          aria-label="Abrir chat de Agente IA TM One"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/12 text-xl shadow-inner">
            <BsChatDotsFill />
          </span>
          <span className="min-w-0 text-left">
            <span className="block truncate text-sm font-semibold">Agente IA TM One</span>
            <span className="block truncate text-xs text-white/78">
              Chat IA en la pantalla activa
            </span>
          </span>
        </button>
      ) : (
        <section className="pointer-events-auto flex h-[min(78vh,760px)] w-full max-w-[420px] flex-col overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_30px_60px_rgba(15,23,42,0.22)]">
          <div className="bg-[linear-gradient(145deg,#1d4ed8_0%,#312e81_100%)] px-5 pb-4 pt-4 text-white">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/72">
                  <BsCpu />
                  Chat IA operativo
                </div>
                <div className="mt-2 text-xl font-semibold">Agente IA TM One</div>
                <div className="mt-1 flex items-center gap-2 text-sm text-white/78">
                  <BsGeoAltFill className="shrink-0" />
                  <span className="truncate">{activeModule.title}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href="/mcp"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/14 bg-white/10 text-white transition hover:bg-white/16"
                  title="Abrir agente completo"
                >
                  <BsBoxArrowUpRight />
                </a>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/14 bg-white/10 text-white transition hover:bg-white/16"
                  aria-label="Ocultar chat IA"
                >
                  <BsChevronDown />
                </button>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 rounded-[20px] border border-white/12 bg-white/10 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                {aiReady ? (
                  <BsCheck2Circle className="shrink-0 text-emerald-300" />
                ) : (
                  <BsExclamationTriangle className="shrink-0 text-amber-300" />
                )}
                <span className="truncate text-xs text-white/82">{statusText}</span>
              </div>
              <button
                type="button"
                onClick={refreshStatus}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/14 bg-white/10 text-white transition hover:bg-white/16"
                aria-label="Actualizar estado de la IA"
              >
                <BsArrowClockwise />
              </button>
            </div>
          </div>

          <div className="border-b border-slate-200 bg-slate-50/90 px-4 py-3">
            <button
              type="button"
              onClick={() => setShowFilters((current) => !current)}
              className="flex w-full items-center justify-between gap-3 rounded-[18px] border border-slate-200 bg-white px-3 py-3 text-left transition hover:border-sky-200 hover:bg-sky-50/60"
            >
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Filtros de consulta
                </div>
                <div className="mt-1 truncate text-xs text-slate-600">{filterSummary}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                  {showFilters ? "Ocultar" : "Mostrar"}
                </span>
                <BsChevronDown
                  className={`text-sm text-slate-500 transition ${showFilters ? "rotate-180" : ""}`}
                />
              </div>
            </button>

            {showFilters ? (
              <div className="mt-3 space-y-3">
                <div className="flex items-center gap-2">
                  <select
                    value={mode}
                    onChange={(event) => setMode(event.target.value)}
                    className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-300"
                  >
                    <option value="auto">Modo auto</option>
                    <option value="datos">Modo datos</option>
                    <option value="analisis">Modo analisis</option>
                    <option value="ayuda">Modo ayuda</option>
                  </select>

                  <select
                    value={site}
                    onChange={(event) => setSite(event.target.value)}
                    className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-300"
                  >
                    <option value="">Todos los sitios</option>
                    {siteOptions.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={clearConversation}
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                    aria-label="Limpiar conversacion"
                  >
                    <BsTrash3 />
                  </button>
                </div>

                <div>
                  <div className="flex gap-2">
                    <input
                      list="floating-mcp-zones"
                      value={zoneCandidate}
                      onChange={(event) => setZoneCandidate(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addZone();
                        }
                      }}
                      placeholder="Filtrar por zona"
                      className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:bg-white"
                    />
                    <button
                      type="button"
                      onClick={addZone}
                      className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700"
                    >
                      Agregar
                    </button>
                  </div>

                  <datalist id="floating-mcp-zones">
                    {zoneOptions.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </datalist>

                  {zones.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {zones.map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => removeZone(item)}
                          className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700 transition hover:bg-sky-100"
                        >
                          {item} <span className="ml-1">x</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          {bootError ? (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {bootError}
            </div>
          ) : null}

          {errorMsg ? (
            <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {errorMsg}
            </div>
          ) : null}

          <div className="border-b border-slate-200 bg-white px-4 py-3">
            <button
              type="button"
              onClick={() => setShowSuggestions((current) => !current)}
              className="flex w-full items-center justify-between gap-3 rounded-[18px] border border-slate-200 bg-slate-50 px-3 py-3 text-left transition hover:border-sky-200 hover:bg-sky-50"
            >
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Consultas sugeridas
                </div>
                <div className="mt-1 truncate text-xs text-slate-600">
                  {promptChips.length} accesos rapidos para {activeModule.title.toLowerCase()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
                  {showSuggestions ? "Ocultar" : "Mostrar"}
                </span>
                <BsChevronDown
                  className={`text-sm text-slate-500 transition ${showSuggestions ? "rotate-180" : ""}`}
                />
              </div>
            </button>

            {showSuggestions ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {promptChips.map((item, index) => (
                  <button
                    key={`${item.label}-${index}`}
                    type="button"
                    disabled={loading}
                    onClick={() => handleQuickQuestion(item)}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex-1 overflow-y-auto bg-[linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] px-4 py-4">
            <div className="space-y-3">
              {messages.map((message) =>
                message.role === "assistant" ? (
                  <AssistantBubble
                    key={message.id}
                    message={message}
                    onQuickQuestion={handleQuickQuestion}
                    disabled={loading}
                  />
                ) : (
                  <UserBubble key={message.id} message={message} />
                )
              )}

              {loading ? (
                <div className="rounded-[22px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-[0_12px_26px_rgba(15,23,42,0.08)]">
                  Agente IA TM One esta analizando la consulta y armando una respuesta estructurada...
                </div>
              ) : null}

              <div ref={conversationEndRef} />
            </div>
          </div>

          <form
            className="border-t border-slate-200 bg-white px-4 py-4"
            onSubmit={(event) => {
              event.preventDefault();
              submitQuestion();
            }}
          >
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submitQuestion();
                }
              }}
              placeholder={`Preguntame por ${activeModule.title.toLowerCase()}, datos operacionales o lectura de esta pantalla...`}
              rows={3}
              className="w-full resize-none rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:bg-white"
            />

            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="text-xs text-slate-500">
                Chat operativo en modo solo lectura sobre la pantalla activa.
              </div>
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-full bg-[linear-gradient(135deg,#2563eb_0%,#4338ca_100%)] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(37,99,235,0.24)] transition hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <BsSendFill />
                {loading ? "Consultando..." : "Enviar"}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
};

export default FloatingMCPChat;
