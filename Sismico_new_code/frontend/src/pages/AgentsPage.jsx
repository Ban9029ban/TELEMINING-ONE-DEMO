import React, { useEffect, useMemo, useState } from 'react'
import fallbackFaqConfig from '../config/mcpFaq.json'
import AgentDataTables from '../components/agent/AgentDataTables'
import { ProductivityChartGrid } from '../components/productivity/SismicoProductivityCharts'
import { askAgent, getAgentStatus, getSismicoSites, loadFaqs } from '../services/sismicoApi'

function normalizeFaqPayload(payload) {
  if (Array.isArray(payload?.categories)) return payload.categories
  if (Array.isArray(payload?.faqs)) {
    return [
      {
        id: 'faqs',
        label: 'Preguntas frecuentes',
        description: 'Consultas sugeridas por el sistema.',
        items: payload.faqs,
      },
    ]
  }
  if (Array.isArray(payload)) {
    return [
      {
        id: 'faqs',
        label: 'Preguntas frecuentes',
        description: 'Consultas sugeridas por el sistema.',
        items: payload,
      },
    ]
  }
  return Array.isArray(fallbackFaqConfig?.categories) ? fallbackFaqConfig.categories : []
}

function formatAnswerTime(value) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleString('es-CL')
}

export default function AgentsPage() {
  const [categories, setCategories] = useState(() => normalizeFaqPayload(fallbackFaqConfig))
  const [selectedCategory, setSelectedCategory] = useState(() => normalizeFaqPayload(fallbackFaqConfig)[0]?.id || '')
  const [sites, setSites] = useState([])
  const [selectedSite, setSelectedSite] = useState('')
  const [agentStatus, setAgentStatus] = useState(null)
  const [mode, setMode] = useState('auto')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('Selecciona una pregunta frecuente o escribe una consulta del sistema.')
  const [lastResult, setLastResult] = useState(null)
  const [pendingInteraction, setPendingInteraction] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadFaqs()
      .then((data) => {
        const nextCategories = normalizeFaqPayload(data)
        setCategories(nextCategories)
        setSelectedCategory((current) =>
          nextCategories.some((category) => category.id === current) ? current : (nextCategories[0]?.id || ''),
        )
      })
      .catch(() => {
        const nextCategories = normalizeFaqPayload(fallbackFaqConfig)
        setCategories(nextCategories)
        setSelectedCategory((current) =>
          nextCategories.some((category) => category.id === current) ? current : (nextCategories[0]?.id || ''),
        )
      })

    getSismicoSites()
      .then((data) => {
        const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []
        setSites(items)
      })
      .catch(() => setSites([]))

    getAgentStatus()
      .then((data) => setAgentStatus(data || null))
      .catch(() => setAgentStatus(null))
  }, [])

  const activeCategory = useMemo(
    () => categories.find((category) => category.id === selectedCategory) || categories[0] || null,
    [categories, selectedCategory],
  )

  const visibleFaqs = useMemo(() => activeCategory?.items || [], [activeCategory])

  const run = async ({ prompt, faqId, forceCategoryId, siteCodeOverride, historyOverride } = {}) => {
    const nextQuestion = (prompt || question || '').trim()
    if (!nextQuestion) return

    setLoading(true)
    setQuestion(nextQuestion)
    if (forceCategoryId) setSelectedCategory(forceCategoryId)
    try {
      const res = await askAgent({
        question: nextQuestion,
        faq_id: faqId,
        site_code: siteCodeOverride || selectedSite || undefined,
        mode,
        history: historyOverride || (pendingInteraction ? [pendingInteraction.originalQuestion, pendingInteraction.followUpQuestion] : []),
      })
      const renderedAnswer = res?.needs_input && res?.follow_up_question
        ? `${res.answer || 'Necesito mas datos.'}\n${res.follow_up_question}`
        : (res?.answer || 'Sin respuesta')
      setAnswer(renderedAnswer)
      setLastResult(res || null)
      if (res?.needs_input) {
        setPendingInteraction({
          originalQuestion: pendingInteraction?.originalQuestion || nextQuestion,
          followUpQuestion: res.follow_up_question || '',
          options: Array.isArray(res.input_options) ? res.input_options : [],
          missingFields: Array.isArray(res.missing_fields) ? res.missing_fields : [],
        })
      } else {
        setPendingInteraction(null)
      }
      if (res?.category_id) setSelectedCategory(res.category_id)
    } catch (error) {
      setAnswer(String(error?.message || error || 'Error consultando agente'))
      setLastResult(null)
      setPendingInteraction(null)
    } finally {
      setLoading(false)
    }
  }

  const handleFaqClick = (faq) => {
    const nextQuestion = faq?.question || ''
    setQuestion(nextQuestion)
    run({
      prompt: nextQuestion,
      faqId: faq?.id,
      forceCategoryId: faq?.category_id || selectedCategory,
    })
  }

  const resolveOptionPrompt = (option) => {
    if (!option) return question
    if (option.field === 'topic') {
      const topicPrompts = {
        monitoreo: 'Dame un resumen del monitoreo actual por sitio.',
        alertas: 'Cuantas alertas abiertas hay por sitio?',
        semaforos: 'Cuantos semaforos y reglas activas hay por sitio?',
        pantallas: 'Que pantallas estan online y cuando fue su ultimo heartbeat?',
        productividad: 'Resume los eventos de productividad cargados en la base de datos.',
        zonas_det: 'Lista las zonas DET configuradas.',
      }
      return topicPrompts[option.value] || option.label || question
    }
    return pendingInteraction?.originalQuestion || question
  }

  const handleInteractionOption = (option) => {
    if (!option) return
    if (option.field === 'site_code') {
      setSelectedSite(option.value)
      run({
        prompt: pendingInteraction?.originalQuestion || question,
        siteCodeOverride: option.value,
        historyOverride: [],
      })
      return
    }
    const nextPrompt = resolveOptionPrompt(option)
    setQuestion(nextPrompt)
    run({
      prompt: nextPrompt,
      historyOverride: [pendingInteraction?.originalQuestion, pendingInteraction?.followUpQuestion].filter(Boolean),
    })
  }

  return (
    <div className="agents-grid">
      <section className="panel-card">
        <h3>Agente IA</h3>
        <p className="agent-intro">
          Consultas guiadas sobre monitoreo sismico, alertas, semaforos, pantallas, productividad y zonas configuradas.
          Tambien puede mostrar graficos del sistema, tablas exportables y data descargable por respuesta.
        </p>
        <div className={`agent-status-banner ${agentStatus?.ollama_reachable ? 'ok' : 'warn'}`}>
          <strong>{agentStatus?.ollama_reachable ? 'IA rapida disponible' : 'Modo guiado activo'}</strong>
          <span>
            {agentStatus?.ollama_reachable
              ? `Ollama conectado${agentStatus?.fast_model ? ` con ${agentStatus.fast_model}` : ''}.`
              : (agentStatus?.error || 'Ollama no esta disponible; el agente responde con consultas guiadas a la BD.')}
          </span>
        </div>
        <div className="agents-filters">
          <label className="agent-filter-field">
            <span>Sitio</span>
            <select value={selectedSite} onChange={(e) => setSelectedSite(e.target.value)}>
              <option value="">Todos los sitios</option>
              {sites.map((site) => (
                <option key={site.code} value={site.code}>
                  {site.name || site.code}
                </option>
              ))}
            </select>
          </label>
          <label className="agent-filter-field">
            <span>Modo</span>
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="auto">Auto</option>
              <option value="guided">Guiado BD</option>
              <option value="fast" disabled={!agentStatus?.ollama_reachable}>IA rapida</option>
              <option value="llm" disabled={!agentStatus?.ollama_reachable}>IA detallada</option>
            </select>
          </label>
          <label className="agent-filter-field">
            <span>Categoria activa</span>
            <input value={activeCategory?.label || 'General'} readOnly />
          </label>
          <button className="chip-btn" type="button" onClick={() => { setQuestion(''); setAnswer('Selecciona una pregunta frecuente o escribe una consulta del sistema.'); setLastResult(null); setPendingInteraction(null) }}>
            Limpiar
          </button>
        </div>
        {pendingInteraction ? (
          <div className="agent-followup-box">
            <strong>{pendingInteraction.followUpQuestion || 'Necesito un dato adicional.'}</strong>
            {pendingInteraction.options?.length ? (
              <div className="agent-option-row">
                {pendingInteraction.options.map((option) => (
                  <button
                    key={`${option.field}:${option.value}`}
                    className="chip-btn"
                    type="button"
                    onClick={() => handleInteractionOption(option)}
                    disabled={loading}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ej: Que poligonos estan en warning o critical actualmente?"
        />
        <div className="agent-actions">
          <button className="chip-btn blue" type="button" onClick={() => run()} disabled={loading}>
            {loading ? 'Consultando...' : 'Consultar'}
          </button>
        </div>
        <div className="response-box">
          <div className="response-box-title">Respuesta</div>
          <div className="agent-answer-content">{answer}</div>
          {lastResult ? (
            <div className="agent-meta">
              <span>Intent: {lastResult.intent || 'desconocido'}</span>
              <span>Fuente: {lastResult.source || 'database'}</span>
              <span>Sitio: {lastResult.site_code || 'todos'}</span>
              <span>Modo: {lastResult.mode || mode}</span>
              <span>LLM: {lastResult.used_llm ? (lastResult.model || 'si') : 'no'}</span>
              <span>Generado: {formatAnswerTime(lastResult.generated_at) || 'sin fecha'}</span>
            </div>
          ) : null}
          {lastResult?.suggestions?.length ? (
            <div className="agent-suggestions">
              <div className="agent-suggestions-title">Preguntas sugeridas</div>
              <div className="faq-list compact">
                {lastResult.suggestions.map((faq) => (
                  <button
                    key={faq.id}
                    className="faq-btn agent-faq-card compact"
                    type="button"
                    onClick={() => handleFaqClick(faq)}
                  >
                    <strong>{faq.question}</strong>
                    {faq.description ? <span>{faq.description}</span> : null}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        {lastResult?.charts?.length ? (
          <div className="agent-artifact-section">
            <div className="agent-suggestions-title">Graficos adjuntos</div>
            <ProductivityChartGrid charts={lastResult.charts} />
          </div>
        ) : null}
        {lastResult?.tables?.length ? (
          <div className="agent-artifact-section">
            <div className="agent-suggestions-title">Tablas adjuntas</div>
            <AgentDataTables tables={lastResult.tables} />
          </div>
        ) : null}
      </section>

      <section className="panel-card">
        <h3>Preguntas frecuentes</h3>
        <div className="tabs-row">
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              className={`tab-btn ${selectedCategory === category.id ? 'active' : ''}`}
              onClick={() => setSelectedCategory(category.id)}
            >
              {category.label || category.id}
            </button>
          ))}
        </div>
        {activeCategory?.description ? <p className="agent-category-copy">{activeCategory.description}</p> : null}
        <div className="faq-list">
          {visibleFaqs.length > 0 ? (
            visibleFaqs.map((faq, index) => (
              <button
                key={faq.id ?? `${selectedCategory}-${index}`}
                className="faq-btn agent-faq-card"
                type="button"
                onClick={() => handleFaqClick(faq)}
              >
                <strong>{faq.question ?? faq.pregunta ?? 'Sin pregunta'}</strong>
                <span>{faq.description ?? faq.answer ?? faq.respuesta ?? 'Selecciona para consultar con datos reales.'}</span>
              </button>
            ))
          ) : (
            <div>No hay FAQs disponibles.</div>
          )}
        </div>
      </section>
    </div>
  )
}
