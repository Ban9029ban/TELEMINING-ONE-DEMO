import React, { useEffect, useState } from 'react'
import {
  loadSismicoProductivityDashboard,
  loadSismicoProductivityFilters,
} from '../services/sismicoApi'
import {
  ProductivityChartGrid,
  ProductivitySummaryGrid,
} from '../components/productivity/SismicoProductivityCharts'

const PRODUCTIVITY_TABS = [
  'Tracking',
  'Acceso',
  'Camaras',
  'Sismico',
  'Agentes ambientales',
  'NOC',
  'Tactico',
]

const RANGE_TO_MS = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
}

function toLocalInputValue(date) {
  const parsed = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(parsed.getTime())) return ''
  const pad = (value) => String(value).padStart(2, '0')
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
}

function buildPresetRange(rangeKey) {
  const now = new Date()
  const delta = RANGE_TO_MS[rangeKey] || RANGE_TO_MS['7d']
  const start = new Date(now.getTime() - delta)
  return {
    date_from: toLocalInputValue(start),
    date_to: toLocalInputValue(now),
  }
}

function buildDefaultFilters(defaults = {}) {
  const rangeKey = defaults.range_key || '7d'
  const preset = buildPresetRange(rangeKey)
  return {
    site_code: defaults.site_code || 'all',
    map_code: defaults.map_code || 'all',
    range_key: rangeKey,
    date_from: preset.date_from,
    date_to: preset.date_to,
    interval: defaults.interval || 'auto',
    top_n: String(defaults.top_n || 8),
  }
}

function formatDateTime(value) {
  if (!value) return 'Sin dato'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return String(value)
  return parsed.toLocaleString('es-CL')
}

function buildDashboardParams(filters) {
  if (!filters) return {}
  return {
    site_code: filters.site_code,
    map_code: filters.map_code,
    range_key: filters.range_key,
    date_from: filters.date_from ? new Date(filters.date_from).toISOString() : undefined,
    date_to: filters.date_to ? new Date(filters.date_to).toISOString() : undefined,
    interval: filters.interval,
    top_n: filters.top_n,
  }
}

export default function ProductivityPage() {
  const [filterOptions, setFilterOptions] = useState(null)
  const [draftFilters, setDraftFilters] = useState(null)
  const [appliedFilters, setAppliedFilters] = useState(null)
  const [dashboard, setDashboard] = useState({ summary: [], charts: [] })
  const [loadingFilters, setLoadingFilters] = useState(true)
  const [loadingDashboard, setLoadingDashboard] = useState(false)
  const [error, setError] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoadingFilters(true)
    loadSismicoProductivityFilters()
      .then((data) => {
        if (cancelled) return
        const defaults = buildDefaultFilters(data?.defaults || {})
        setFilterOptions(data || { sites: [], maps: [], defaults: {} })
        setDraftFilters(defaults)
        setAppliedFilters(defaults)
      })
      .catch((fetchError) => {
        if (cancelled) return
        setError(fetchError?.message || 'No se pudieron cargar los filtros de productividad.')
      })
      .finally(() => {
        if (!cancelled) setLoadingFilters(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  function loadDashboard(filtersState, { silent = false } = {}) {
    if (!filtersState) return
    if (!silent) setLoadingDashboard(true)
    setError('')
    loadSismicoProductivityDashboard(buildDashboardParams(filtersState))
      .then((data) => {
        setDashboard({
          summary: Array.isArray(data?.summary) ? data.summary : [],
          charts: Array.isArray(data?.charts) ? data.charts : [],
          filters: data?.filters || {},
          generated_at: data?.generated_at || null,
        })
        setLastUpdatedAt(new Date().toISOString())
      })
      .catch((fetchError) => {
        setError(fetchError?.message || 'No se pudieron cargar los graficos sismicos.')
      })
      .finally(() => {
        if (!silent) setLoadingDashboard(false)
      })
  }

  useEffect(() => {
    if (!appliedFilters) return
    loadDashboard(appliedFilters)
  }, [appliedFilters])

  useEffect(() => {
    if (!autoRefresh || !appliedFilters) return undefined
    const refreshSeconds = Number(dashboard?.filters?.refresh_seconds || 45)
    const timer = window.setInterval(() => {
      loadDashboard(appliedFilters, { silent: true })
    }, Math.max(refreshSeconds, 15) * 1000)
    return () => window.clearInterval(timer)
  }, [autoRefresh, appliedFilters, dashboard?.filters?.refresh_seconds])

  if (loadingFilters && !draftFilters) {
    return (
      <div className="panel-card page-screen full-panel">
        <h3>Productividad sismica</h3>
        <p>Cargando filtros y estructura analitica...</p>
      </div>
    )
  }

  const visibleMaps = (filterOptions?.maps || []).filter((item) => (
    !draftFilters?.site_code ||
    draftFilters.site_code === 'all' ||
    item.site_code === draftFilters.site_code
  ))

  const refreshSeconds = Number(dashboard?.filters?.refresh_seconds || 45)

  function updateDraftField(field, value) {
    setDraftFilters((current) => ({
      ...(current || {}),
      [field]: value,
    }))
  }

  function handleRangeChange(nextRange) {
    const preset = nextRange === 'custom' ? {} : buildPresetRange(nextRange)
    setDraftFilters((current) => ({
      ...(current || {}),
      range_key: nextRange,
      ...preset,
    }))
  }

  function handleSiteChange(nextSite) {
    setDraftFilters((current) => {
      const nextState = {
        ...(current || {}),
        site_code: nextSite,
      }
      if (nextState.map_code && nextState.map_code !== 'all') {
        const selectedMap = (filterOptions?.maps || []).find((item) => item.code === nextState.map_code)
        if (!selectedMap || (nextSite !== 'all' && selectedMap.site_code !== nextSite)) {
          nextState.map_code = 'all'
        }
      }
      return nextState
    })
  }

  function handleDateField(field, value) {
    setDraftFilters((current) => ({
      ...(current || {}),
      range_key: 'custom',
      [field]: value,
    }))
  }

  function handleApply() {
    if (!draftFilters) return
    setAppliedFilters({ ...draftFilters })
  }

  return (
    <div className="panel-card page-screen productivity-page">
      <div className="productivity-page-head">
        <div>
          <h3>Productividad sismica</h3>
          <p>
            Analitica dedicada solo al modulo sismico. Los graficos se alimentan desde
            eventos, estados actuales, alertas, polling y planos registrados en base de datos.
          </p>
        </div>
        <div className="productivity-head-meta">
          <span>Ultima actualizacion: {formatDateTime(lastUpdatedAt || dashboard?.generated_at)}</span>
          <span>{autoRefresh ? `Auto refresh cada ${refreshSeconds}s` : 'Auto refresh pausado'}</span>
        </div>
      </div>

      <div className="tabs-row">
        {PRODUCTIVITY_TABS.map((tab) => (
          <button
            key={tab}
            className={`tab-btn ${tab === 'Sismico' ? 'active' : ''}`}
            disabled={tab !== 'Sismico'}
            type="button"
          >
            {tab}
          </button>
        ))}
      </div>

      <section className="productivity-filter-panel">
        <div className="productivity-filter-grid">
          <label className="productivity-filter-field">
            <span>Sitio</span>
            <select
              value={draftFilters?.site_code || 'all'}
              onChange={(event) => handleSiteChange(event.target.value)}
            >
              <option value="all">Todos los sitios</option>
              {(filterOptions?.sites || []).map((site) => (
                <option key={site.code} value={site.code}>{site.name}</option>
              ))}
            </select>
          </label>

          <label className="productivity-filter-field">
            <span>Plano</span>
            <select
              value={draftFilters?.map_code || 'all'}
              onChange={(event) => updateDraftField('map_code', event.target.value)}
            >
              <option value="all">Todos los planos</option>
              {visibleMaps.map((item) => (
                <option key={item.code} value={item.code}>{item.name}</option>
              ))}
            </select>
          </label>

          <label className="productivity-filter-field">
            <span>Rango</span>
            <select
              value={draftFilters?.range_key || '7d'}
              onChange={(event) => handleRangeChange(event.target.value)}
            >
              {(filterOptions?.range_options || []).map((item) => (
                <option key={item.code} value={item.code}>{item.label}</option>
              ))}
            </select>
          </label>

          <label className="productivity-filter-field">
            <span>Intervalo</span>
            <select
              value={draftFilters?.interval || 'auto'}
              onChange={(event) => updateDraftField('interval', event.target.value)}
            >
              {(filterOptions?.interval_options || []).map((item) => (
                <option key={item.code} value={item.code}>{item.label}</option>
              ))}
            </select>
          </label>

          <label className="productivity-filter-field">
            <span>Desde</span>
            <input
              type="datetime-local"
              value={draftFilters?.date_from || ''}
              onChange={(event) => handleDateField('date_from', event.target.value)}
            />
          </label>

          <label className="productivity-filter-field">
            <span>Hasta</span>
            <input
              type="datetime-local"
              value={draftFilters?.date_to || ''}
              onChange={(event) => handleDateField('date_to', event.target.value)}
            />
          </label>

          <label className="productivity-filter-field">
            <span>Top ranking</span>
            <select
              value={draftFilters?.top_n || '8'}
              onChange={(event) => updateDraftField('top_n', event.target.value)}
            >
              {[5, 6, 8, 10, 12].map((value) => (
                <option key={value} value={String(value)}>{value}</option>
              ))}
            </select>
          </label>

          <label className="productivity-filter-field productivity-toggle-field">
            <span>Actualizacion</span>
            <button
              type="button"
              className={`productivity-toggle-btn ${autoRefresh ? 'active' : ''}`}
              onClick={() => setAutoRefresh((current) => !current)}
            >
              {autoRefresh ? 'Auto refresh ON' : 'Auto refresh OFF'}
            </button>
          </label>
        </div>

        <div className="productivity-filter-actions">
          <button type="button" className="pill-btn green" onClick={handleApply}>
            Aplicar filtros
          </button>
          <button
            type="button"
            className="pill-btn"
            onClick={() => loadDashboard(appliedFilters || draftFilters)}
          >
            Actualizar ahora
          </button>
          {loadingDashboard ? <span className="productivity-loading-chip">Actualizando dashboard...</span> : null}
        </div>
      </section>

      {error ? <div className="productivity-error-banner">{error}</div> : null}

      <ProductivitySummaryGrid items={dashboard?.summary || []} />
      <ProductivityChartGrid charts={dashboard?.charts || []} />
    </div>
  )
}
