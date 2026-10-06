import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  BsArrowClockwise,
  BsCheck2Circle,
  BsCpu,
  BsDatabase,
  BsExclamationTriangle,
  BsMagic,
  BsPerson,
  BsSendFill,
  BsShieldLock,
  BsStars,
  BsTrash3,
} from "react-icons/bs";

import { API_URL } from "../../api-config";
import SidebarTemas from "./SidebarTemas";
import TablesAgents from "./TablesAgents";
import ChartsAgents from "./ChartsAgents";
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

function buildWelcomeMessage() {
  return {
    id: "welcome",
    role: "assistant",
    createdAt: new Date().toISOString(),
    structured: {
      headline: "Agente IA TM One listo para ayudarte",
      summary:
        "Puedo responder como asistente conversacional, consultar datos operacionales en modo solo lectura y ayudarte a formular preguntas más precisas.",
      details: [
        "Respondo mejor si me indicas sitio, zona, fecha o el foco que quieres revisar.",
        "Puedo combinar lectura operacional, consultas estructuradas y explicaciones guiadas.",
      ],
      actions: [
        "Pide un resumen del estado actual.",
        "Pregunta por personas, vehículos, pórticos, agentes ambientales o permanencias.",
      ],
      follow_ups: [
        "Dame un resumen operativo de hoy.",
        "Que informacion puedes consultar de la base de datos de forma segura.",
        "Sugiere acciones operativas rapidas segun el estado actual del sistema.",
      ],
      warnings: ["Politica activa: solo lectura, sin secretos y sin cambios sobre la data."],
      confidence: "alta",
    },
    answer:
      "Agente IA TM One listo para ayudarte.\n\nPuedo responder como asistente conversacional, consultar datos operacionales en modo solo lectura y ayudarte a formular preguntas mas precisas.",
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
          ? `El agente tiene ${categories.length} grupos de sinonimos mineros para interpretar mejor las preguntas.`
          : "No se encontraron sinonimos cargados en este ambiente.",
      details: categories.map(
        (category) =>
          `${category}: ${Object.keys(synonyms[category] || {}).length} sinonimos configurados.`
      ),
      evidence: categories.slice(0, 6).map((category) => {
        const entries = Object.entries(synonyms[category] || {}).slice(0, 4);
        const preview = entries.map(([key, value]) => `${key} -> ${value}`).join(", ");
        return `${category}: ${preview || "sin datos visibles"}`;
      }),
      follow_ups: [
        "Explicame como usas estos sinonimos en una consulta.",
        "Hazme una pregunta guiada usando este vocabulario.",
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

function MessageSection({ title, items, tone = "default" }) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  return (
    <div className={`mcp-message-section tone-${tone}`}>
      <span className="mcp-message-section-title">{title}</span>
      <ul>
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function AssistantMessage({ message, onHide, onQuickQuestion, disabled }) {
  const structured = message.structured;

  return (
    <article className="mcp-bubble assistant">
      <div className="mcp-bubble-head">
        <div className="mcp-avatar assistant">
          <BsStars />
        </div>
        <div>
          <strong>Agente IA TM One</strong>
          <span>{formatTimestamp(message.createdAt)}</span>
        </div>
        {message.id === "welcome" && onHide ? (
          <button
            type="button"
            className="mcp-ghost-button compact"
            style={{ marginLeft: "auto" }}
            onClick={onHide}
          >
            Ocultar
          </button>
        ) : null}
      </div>

      <div className="mcp-bubble-body">
        {structured ? (
          <>
            <h3>{structured.headline}</h3>
            <p>{structured.summary}</p>
            {structured.clarification_question ? (
              <div className="mcp-clarification-box">
                <BsMagic />
                <span>{structured.clarification_question}</span>
              </div>
            ) : null}
            <MessageSection title="Contexto" items={structured.details} />
            <MessageSection title="Datos destacados" items={structured.evidence} />
            <MessageSection title="Siguientes pasos" items={structured.actions} />
            <MessageSection title="Advertencias" items={structured.warnings} tone="warning" />
          </>
        ) : (
          <p>{message.answer || "Sin respuesta."}</p>
        )}

        {message.tables?.length ? (
          <div className="mcp-extra-block">
            <TablesAgents tables={message.tables} exportToken={message.exportToken} />
          </div>
        ) : null}

        {message.charts?.length ? (
          <div className="mcp-extra-block">
            <ChartsAgents charts={message.charts} />
          </div>
        ) : null}

        <div className="mcp-bubble-footer">
          {message.model ? <span>Modelo: {message.model}</span> : null}
          {message.sources?.length ? <span>Fuentes: {message.sources.join(", ")}</span> : null}
        </div>

        {structured?.follow_ups?.length ? (
          <div className="mcp-follow-up-row">
            {structured.follow_ups.map((item, index) => (
              <button
                key={`${message.id}-follow-${index}`}
                type="button"
                className="mcp-follow-up-chip"
                disabled={disabled}
                onClick={() => onQuickQuestion(item)}
              >
                {item}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function UserMessage({ message }) {
  return (
    <article className="mcp-bubble user">
      <div className="mcp-bubble-head user">
        <div>
          <strong>Tu consulta</strong>
          <span>{formatTimestamp(message.createdAt)}</span>
        </div>
        <div className="mcp-avatar user">
          <BsPerson />
        </div>
      </div>
      <div className="mcp-bubble-body">
        <p>{message.content}</p>
      </div>
    </article>
  );
}

const MCP = () => {
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState("auto");
  const [site, setSite] = useState("");
  const [zoneCandidate, setZoneCandidate] = useState("");
  const [zones, setZones] = useState([]);
  const [messages, setMessages] = useState([buildWelcomeMessage()]);
  const [status, setStatus] = useState(DEFAULT_STATUS);
  const [sites, setSites] = useState([]);
  const [availableZones, setAvailableZones] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [bootError, setBootError] = useState("");
  const [showHero, setShowHero] = useState(true);
  const [showRuntimePanel, setShowRuntimePanel] = useState(true);

  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  useEffect(() => {
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
            "Parte del contexto inicial no cargo completo. El agente sigue disponible, pero algunos selectores pueden mostrarse incompletos."
          );
        }
      } catch (error) {
        if (!active) return;
        setBootError(
          "No se pudo cargar el estado inicial del agente. Aún así puedes intentar consultar manualmente."
        );
      }
    }

    loadBootData();

    return () => {
      active = false;
    };
  }, []);

  const metrics = useMemo(() => {
    const assistantMessages = messages.filter((message) => message.role === "assistant").length;
    const userMessages = messages.filter((message) => message.role === "user").length;

    return {
      assistantMessages,
      userMessages,
    };
  }, [messages]);

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
    setMessages([buildWelcomeMessage()]);
    setDraft("");
    setErrorMsg("");
  };

  const hideWelcomeMessage = () => {
    setMessages((current) => current.filter((message) => message.id !== "welcome"));
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
    id: `user-${Date.now()}`,
    role: "user",
    content,
    createdAt: new Date().toISOString(),
  });

  const pushAssistantFromApi = (data) => ({
    id: `assistant-${Date.now()}`,
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
  });

  const submitQuestion = async (forcedQuestion) => {
    const questionText = (forcedQuestion || draft).trim();
    if (!questionText) {
      setErrorMsg("Escribe una pregunta para continuar.");
      return;
    }

    const userMessage = pushUserMessage(questionText);
    const nextMessages = [...messages, userMessage];

    setMessages(nextMessages);
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
      console.error("[MCP] consulta error", error);
      setErrorMsg(
        "No pude completar la consulta en este momento. El agente no respondio a tiempo o perdio conectividad."
      );
      setMessages((current) => [
        ...current,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          createdAt: new Date().toISOString(),
          structured: {
            headline: "No pude responder ahora",
            summary:
              "La consulta no termino correctamente, pero podemos reintentarlo con mas contexto o cambiar el enfoque.",
            details: [
              "Prueba filtrando por sitio o zona.",
              "Si quieres, formula una consulta de datos concreta o una pregunta de ayuda.",
            ],
            follow_ups: [
              "Que informacion puedes consultar de la base de datos de forma segura.",
              "Hazme una pregunta guiada para construir una consulta mas precisa.",
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
    const question = typeof item === "string" ? item : item?.text || "";
    const action = typeof item === "string" ? null : item?.action || null;
    const nextMode = typeof item === "string" ? null : item?.mode || null;

    if (nextMode) {
      setMode(nextMode);
    }

    if (action === "facts") {
      setLoading(true);
      setErrorMsg("");
      const userMessage = pushUserMessage(question);
      setMessages((current) => [...current, userMessage]);
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
      const userMessage = pushUserMessage(question);
      setMessages((current) => [...current, userMessage]);
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

  const hasStatusSnapshot = Boolean(
    status.ollama.host ||
      status.ollama.model ||
      status.ollama.configured_model ||
      status.ollama.error ||
      status.ollama.available_models.length
  );
  const aiReady = Boolean(status.ollama.ready ?? status.ollama.reachable);
  const usingFallbackModel = Boolean(status.ollama.fallback_model_active);
  const statusBanner = !hasStatusSnapshot
    ? ""
    : !status.ollama.reachable
    ? "Ollama no esta respondiendo ahora mismo. El agente seguira intentando responder en modo contingencia cuando haya contexto disponible."
    : !aiReady
    ? "Ollama esta activo, pero aun no tiene un modelo listo para conversar. Revisa la descarga del modelo configurado."
    : usingFallbackModel
    ? `El modelo configurado no estaba disponible y el agente esta usando ${status.ollama.model || "un modelo alternativo"} para seguir respondiendo.`
    : status.ollama.error
    ? status.ollama.error
    : "";

  return (
    <div className="mcp-page">
      <div className="mcp-hero-toggle-row">
        <button
          type="button"
          className="mcp-ghost-button"
          onClick={() => setShowHero((current) => !current)}
        >
          {showHero ? "Ocultar resumen IA" : "Mostrar resumen IA"}
        </button>
      </div>

      {showHero ? (
        <section className="mcp-hero">
          <div className="mcp-hero-copy">
            <div className="mcp-badge-row">
              <span className="mcp-badge">
                <BsCpu />
                Agente IA TM One
              </span>
              <span className={`mcp-status-pill ${aiReady ? "ok" : "warn"}`}>
                {aiReady ? <BsCheck2Circle /> : <BsExclamationTriangle />}
                {aiReady
                  ? `IA lista con ${status.ollama.model || "modelo configurado"}`
                  : status.ollama.reachable
                  ? "Ollama activo sin modelo listo"
                  : "Ollama con conectividad pendiente"}
              </span>
            </div>

            <h1>Agente IA TM One</h1>
            <p>
              Consulta la operacion como en un chat, con contexto guiado, lectura segura de la base
              de datos y respuestas estructuradas para monitoreo, control y analisis.
            </p>
          </div>
        </section>
      ) : null}

      <div className="mcp-workspace">
        <section className="mcp-chat-panel">
          <div className="mcp-toolbar">
            <div className="mcp-toolbar-title">
              <h2>Conversacion guiada</h2>
              <p>
                {metrics.userMessages} consultas del usuario y {metrics.assistantMessages} respuestas del agente en esta sesión.
              </p>
            </div>

            <div className="mcp-toolbar-actions">
              <button type="button" className="mcp-ghost-button" onClick={refreshStatus}>
                <BsArrowClockwise />
                Estado IA
              </button>
              <button type="button" className="mcp-ghost-button danger" onClick={clearConversation}>
                <BsTrash3 />
                Limpiar
              </button>
            </div>
          </div>

          <div className="mcp-filters-grid">
            <label className="mcp-field">
              <span>Sitio</span>
              <select value={site} onChange={(event) => setSite(event.target.value)}>
                <option value="">Todos los sitios</option>
                {sites.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.nombre}
                  </option>
                ))}
              </select>
            </label>

            <label className="mcp-field">
              <span>Modo</span>
              <select value={mode} onChange={(event) => setMode(event.target.value)}>
                <option value="auto">Auto</option>
                <option value="datos">Datos</option>
                <option value="analisis">Análisis IA</option>
                <option value="ayuda">Ayuda</option>
              </select>
            </label>

            <div className="mcp-field zone-field">
              <span>Zonas</span>
              <div className="mcp-zone-input">
                <input
                  list="mcp-zones"
                  placeholder="Selecciona o escribe una zona"
                  value={zoneCandidate}
                  onChange={(event) => setZoneCandidate(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addZone();
                    }
                  }}
                />
                <button type="button" onClick={addZone}>
                  Agregar
                </button>
                <datalist id="mcp-zones">
                  {availableZones.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.nombre}
                    </option>
                  ))}
                </datalist>
              </div>
              {zones.length ? (
                <div className="mcp-zone-chip-row">
                  {zones.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className="mcp-zone-chip"
                      onClick={() => removeZone(item)}
                    >
                      {item} <span>x</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {bootError ? <div className="mcp-banner warning">{bootError}</div> : null}
          {statusBanner ? <div className="mcp-banner warning">{statusBanner}</div> : null}
          {errorMsg ? <div className="mcp-banner error">{errorMsg}</div> : null}

          <div className="mcp-conversation">
            {messages.map((message) =>
              message.role === "assistant" ? (
                <AssistantMessage
                  key={message.id}
                  message={message}
                  onHide={hideWelcomeMessage}
                  onQuickQuestion={handleQuickQuestion}
                  disabled={loading}
                />
              ) : (
                <UserMessage key={message.id} message={message} />
              )
            )}

            {loading ? (
              <div className="mcp-typing">
                <div className="mcp-avatar assistant">
                  <BsStars />
                </div>
                <div className="mcp-typing-bubble">
                  <strong>Agente IA TM One</strong>
                  <span>Analizando la consulta y armando una respuesta estructurada...</span>
                </div>
              </div>
            ) : null}

            <div ref={endRef} />
          </div>

          <form
            className="mcp-composer"
            onSubmit={(event) => {
              event.preventDefault();
              submitQuestion();
            }}
          >
            <label className="mcp-composer-label" htmlFor="mcp-draft">
              Escribe tu consulta
            </label>
            <textarea
              id="mcp-draft"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ejemplo: explicame en lenguaje simple que esta pasando en el sitio principal y que deberia revisar primero."
              rows={4}
            />

            <div className="mcp-composer-footer">
              <p>
                El agente puede pedirte mas contexto si la consulta es muy amplia y respondera
                siempre en modo solo lectura.
              </p>
              <button type="submit" className="mcp-primary-button" disabled={loading}>
                <BsSendFill />
                {loading ? "Consultando..." : "Consultar"}
              </button>
            </div>
          </form>
        </section>

        <aside className="mcp-sidebar-panel">
          <div className="mcp-sidebar-card">
            <div className="mcp-sidebar-card-head">
              <h3>Preguntas frecuentes</h3>
              <p>Prompts mejor estructurados para que el agente converse mejor contigo.</p>
            </div>
            <SidebarTemas onPreguntaSeleccionada={handleQuickQuestion} />
          </div>

          <div className="mcp-sidebar-card compact">
            <div className="mcp-sidebar-card-head compact">
              <div>
                <h3>Estado tecnico</h3>
                <p>Modelo, politica y catalogo visible del agente.</p>
              </div>
              <button
                type="button"
                className="mcp-ghost-button compact"
                onClick={() => setShowRuntimePanel((current) => !current)}
              >
                {showRuntimePanel ? "Ocultar" : "Mostrar"}
              </button>
            </div>

            {showRuntimePanel ? (
              <>
                <div className="mcp-mini-stat">
                  <BsCpu />
                  <div>
                    <strong>Modelo activo</strong>
                    <span>{status.ollama.model || status.ollama.configured_model || "No configurado"}</span>
                  </div>
                </div>
                <div className="mcp-mini-stat">
                  <BsShieldLock />
                  <div>
                    <strong>Política</strong>
                    <span>Solo lectura y secretos bloqueados</span>
                  </div>
                </div>
                <div className="mcp-mini-stat">
                  <BsDatabase />
                  <div>
                    <strong>Modelos visibles</strong>
                    <span>
                      {(status.ollama.available_models || []).slice(0, 3).join(", ") ||
                        "Sin catalogo visible"}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div className="mcp-panel-hidden">Panel oculto. Pulsa mostrar para ver el detalle del agente.</div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};

export default MCP;
