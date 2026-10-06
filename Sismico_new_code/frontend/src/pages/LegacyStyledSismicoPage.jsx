import ScreenLicenseGate from '../components/ScreenLicenseGate'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useSismicoSite } from '../../hooks/useSismicoSite'
import { loadPublicRuntimeConfig } from '../../services/sismicoApi'

function nowLine(message) {
  const d = new Date()
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  const ss = d.getSeconds().toString().padStart(2, '0')
  return `[${hh}:${mm}:${ss}] ${message}`
}

function runtimeFromPayload(data) {
  return {
    environment: data.environment || data.app_env || 'local',
    externalSourcesOn: Boolean(
      data.externalSourcesOn ??
        data.external_sources_on ??
        data.external_sources_enabled ??
        false,
    ),
    semaforosMode:
      data.semaforosMode ||
      data.semaforos_mode ||
      (data.semaforoDryRun ?? data.plc_dry_run ? 'DRY-RUN' : 'LIVE'),
  }
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function normalizeState(rawValue, stateMode) {
  const raw = normalizeText(rawValue)
  if (stateMode === 'dual') {
    return raw.includes('alerta') || raw.includes('critical') || raw.includes('alta')
      ? 'alerta'
      : 'normal'
  }
  if (raw.includes('superior') || raw.includes('alta') || raw.includes('alerta') || raw.includes('critical')) {
    return 'superior'
  }
  if (raw.includes('inferior') || raw.includes('baja')) {
    return 'inferior'
  }
  return 'centro'
}

function stateOptionsForMode(stateMode) {
  return stateMode === 'tri'
    ? [
        { code: 'inferior', label: 'INFERIOR' },
        { code: 'centro', label: 'CENTRO' },
        { code: 'superior', label: 'SUPERIOR' },
      ]
    : [
        { code: 'normal', label: 'NORMAL' },
        { code: 'alerta', label: 'ALERTA' },
      ]
}

function overlayUrl(item, stateCode) {
  const assets = item.overlayAssets || item.overlay_assets || {}
  if (item.stateMode === 'tri' || item.state_mode === 'tri') {
    if (stateCode === 'inferior') return null
    if (stateCode === 'centro') return assets.normal || assets.safe || null
    if (stateCode === 'superior') return assets.critical || assets.alert || null
    return null
  }
  return stateCode === 'alerta'
    ? assets.critical || assets.alert || assets.normal || assets.safe || null
    : assets.normal || assets.safe || assets.critical || assets.alert || null
}

function mergeObjects(configObjects, detailObjects) {
  const merged = configObjects.map((item) => ({ ...item }))
  for (const source of detailObjects || []) {
    const raw = normalizeText(source.code || source.object_code || source.name || source.object_name)
    const idx = merged.findIndex((item) =>
      (item.keys || []).some((key) => raw === normalizeText(key) || raw.includes(normalizeText(key))),
    )
    if (idx >= 0) {
      merged[idx] = {
        ...merged[idx],
        ...source,
        code: merged[idx].code,
        name: merged[idx].name,
        stateMode: merged[idx].stateMode,
        group: merged[idx].group,
        overlayAssets: {
          ...(merged[idx].overlayAssets || {}),
          ...(source.overlay_assets || {}),
        },
      }
    }
  }
  return merged
}

export default function LegacyStyledSismicoPage({ config }) {
  const { detail, state, refresh, accessDenied, licenseInfo } = useSismicoSite(config.siteCode)
  const [runtime, setRuntime] = useState({
    environment: 'local',
    externalSourcesOn: false,
    semaforosMode: 'DRY-RUN',
  })
  const [backendStates, setBackendStates] = useState({})
  const [manualOverrides, setManualOverrides] = useState({})
  const [logs, setLogs] = useState([nowLine('Fuentes externas OFF')])
  const [zoom, setZoom] = useState(1)
  const [refreshTick, setRefreshTick] = useState(0)
  const [flashTick, setFlashTick] = useState(0)
  const [emergencyActive, setEmergencyActive] = useState(false)
  const [mapIndex, setMapIndex] = useState(0)
  const sirenRef = useRef(null)

  const addLog = (message) => setLogs((prev) => [nowLine(message), ...prev].slice(0, 16))

  const projectObjects = useMemo(() => mergeObjects(config.objects, detail?.objects || []), [config.objects, detail])

  useEffect(() => {
    loadPublicRuntimeConfig()
      .then((data) => setRuntime(runtimeFromPayload(data)))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const nextStates = {}
    for (const item of state?.object_states || []) {
      const rawCode = normalizeText(item.object_code || item.name || item.object_name)
      const found = projectObjects.find((obj) => (obj.keys || []).some((k) => rawCode === normalizeText(k) || rawCode.includes(normalizeText(k))))
      if (!found) continue
      nextStates[found.code] = normalizeState(item.value || item.state_code || item.label || item.state, found.stateMode)
    }
    if (Object.keys(nextStates).length) {
      setBackendStates((prev) => ({ ...prev, ...nextStates }))
    }
  }, [state, projectObjects])

  useEffect(() => {
    if (runtime.externalSourcesOn) {
      setManualOverrides({})
    }
  }, [runtime.externalSourcesOn])

  useEffect(() => {
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined)
      loadPublicRuntimeConfig().then((data) => setRuntime(runtimeFromPayload(data))).catch(() => undefined)
      setFlashTick((prev) => prev + 1)
      window.setTimeout(() => setRefreshTick((prev) => prev + 1), 450)
    }, config.refreshMs || 6500)
    return () => window.clearInterval(timer)
  }, [config.refreshMs, refresh])

  const effectiveStates = useMemo(() => {
    const out = {}
    for (const item of projectObjects) {
      out[item.code] = item.stateMode === 'tri' ? 'centro' : 'normal'
    }
    Object.assign(out, backendStates)
    if (!runtime.externalSourcesOn) Object.assign(out, manualOverrides)
    return out
  }, [projectObjects, backendStates, manualOverrides, runtime.externalSourcesOn])

  const groupedObjects = useMemo(() => {
    const groups = new Map()
    for (const item of projectObjects) {
      const g = item.group || 'Polígonos Sismicidad'
      if (!groups.has(g)) groups.set(g, [])
      groups.get(g).push(item)
    }
    return Array.from(groups.entries())
  }, [projectObjects])

  const baseMapSrc = useMemo(() => {
    const candidates = []
    if (detail?.map?.image_url) candidates.push(detail.map.image_url)
    candidates.push(...(config.mapFallbacks || []))
    const idx = Math.min(mapIndex, Math.max(0, candidates.length - 1))
    return `${candidates[idx] || ''}?v=${refreshTick}`
  }, [detail, config.mapFallbacks, mapIndex, refreshTick])

  const overlayItems = useMemo(() => {
    return projectObjects
      .map((item, index) => {
        const stateCode = effectiveStates[item.code] || (item.stateMode === 'tri' ? 'centro' : 'normal')
        const src = overlayUrl(item, stateCode)
        if (!src) return null
        return { code: item.code, src: `${src}?v=${refreshTick}`, stateCode, zIndex: 10 + index }
      })
      .filter(Boolean)
  }, [projectObjects, effectiveStates, refreshTick])

  const manualAllowed = !runtime.externalSourcesOn

  const handleState = (item, stateCode) => {
    if (!manualAllowed) {
      addLog('Fuentes externas ON: cambio manual bloqueado.')
      return
    }
    setManualOverrides((prev) => ({ ...prev, [item.code]: stateCode }))
    setFlashTick((prev) => prev + 1)
    window.setTimeout(() => setRefreshTick((prev) => prev + 1), 450)
    addLog(`${item.name} => ${stateCode.toUpperCase()}`)
  }

  const handleRefresh = () => {
    refresh().catch(() => undefined)
    loadPublicRuntimeConfig().then((data) => setRuntime(runtimeFromPayload(data))).catch(() => undefined)
    setFlashTick((prev) => prev + 1)
    window.setTimeout(() => setRefreshTick((prev) => prev + 1), 450)
    addLog('Refresco manual ejecutado.')
  }

  const toggleEmergency = async () => {
    const next = !emergencyActive
    setEmergencyActive(next)
    if (!sirenRef.current) return
    try {
      if (next) {
        sirenRef.current.pause()
        sirenRef.current.currentTime = 0
        await sirenRef.current.play()
      } else {
        sirenRef.current.pause()
        sirenRef.current.currentTime = 0
      }
    } catch {
      addLog('No fue posible reproducir la sirena.')
    }
  }

  if (accessDenied) return <ScreenLicenseGate licenseInfo={licenseInfo} />

  return (
    <div className={`legacy-site-page ${config.pageClass}`}>
      <audio ref={sirenRef} src="/sounds/alert_siren.mp3" preload="auto" loop />
      {emergencyActive ? (
        <div className="legacy-site-emergency-overlay" onClick={toggleEmergency}>
          <div className="legacy-site-emergency-box">
            <div className="legacy-site-emergency-title">EMERGENCIA</div>
            <div className="legacy-site-emergency-subtitle">Sirena activa — pulse para detener</div>
          </div>
        </div>
      ) : null}

      <div className="legacy-site-toolbar">
        <button className="legacy-site-btn emergency" onClick={toggleEmergency}>Emergencia</button>
      </div>

      <div className="legacy-site-shell">
        <div className="legacy-site-left">
          <section className="legacy-site-card legacy-site-table-card">
            <div className="legacy-site-card-title">{config.title}</div>
            <div className="legacy-site-table-scroll">
              {groupedObjects.map(([groupName, items]) => (
                <div key={groupName} className="legacy-site-group">
                  <div className="legacy-site-group-title">{groupName}</div>
                  {items.map((item) => (
                    <div key={item.code} className="legacy-site-row">
                      <div className="legacy-site-row-label">{item.name}</div>
                      <div className={`legacy-site-row-actions mode-${item.stateMode}`}>
                        {stateOptionsForMode(item.stateMode).map((option) => (
                          <button
                            key={option.code}
                            className={`legacy-site-state-btn ${effectiveStates[item.code] === option.code ? `active ${option.code}` : ''}`}
                            onClick={() => handleState(item, option.code)}
                            disabled={!manualAllowed}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>

          <section className="legacy-site-card legacy-site-conn-card">
            <div className="legacy-site-card-title">Estado de Conexión</div>
            <div className="legacy-site-conn-body">
              {logs.map((line, idx) => (
                <div key={`${line}-${idx}`} className="legacy-site-log-line">{line}</div>
              ))}
            </div>
          </section>
        </div>

        <section className="legacy-site-card legacy-site-map-card">
          <div className="legacy-site-card-title legacy-site-map-header">
            <div>{config.mapTitle}</div>
          </div>
          <div className="legacy-site-map-area">
            <div className={`legacy-site-map-viewport pulse-${flashTick % 2}`}>
              <div className="legacy-site-map-toolbar">
                <button type="button" onClick={() => setZoom((z) => Math.min(2.4, +(z + 0.12).toFixed(2)))}>+</button>
                <button type="button" onClick={() => setZoom((z) => Math.max(0.76, +(z - 0.12).toFixed(2)))}>−</button>
                <button type="button" onClick={() => { setZoom(1); handleRefresh() }}>⟳</button>
              </div>
              <div className="legacy-site-map-stack" style={{ transform: `scale(${zoom})` }}>
                <img className="legacy-site-map-base" src={baseMapSrc} alt={`${config.siteCode} map`} onError={() => setMapIndex((i) => i + 1)} />
                {overlayItems.map((item) => (
                  <img key={`${item.code}-${item.stateCode}-${refreshTick}`} className={`legacy-site-map-overlay state-${item.stateCode}`} src={item.src} alt="" style={{ zIndex: item.zIndex }} />
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
