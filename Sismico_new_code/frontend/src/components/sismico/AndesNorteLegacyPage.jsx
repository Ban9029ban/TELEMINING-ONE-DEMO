import ScreenLicenseGate from '../ScreenLicenseGate'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useSismicoSite } from '../../hooks/useSismicoSite'
import { loadPublicRuntimeConfig, getEmergencyState, setEmergencyState } from '../../services/sismicoApi'
import { setManualObjectState } from '../../services/sismicoOperatorApi'
import { ANDES_NORTE_CONFIG } from '../../config/andesNorteConfig'
import { hasSismicoObjectSupport, resolveSismicoObjectCode } from '../../utils/sismicoObjectResolver'

function nowLine(message) {
  const d = new Date()
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  const ss = d.getSeconds().toString().padStart(2, '0')
  return `[${hh}:${mm}:${ss}] ${message}`
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
  if (stateMode === 'traffic') {
    if (raw.includes('rojo') || raw.includes('red') || raw.includes('crit')) return 'rojo'
    if (raw.includes('amarillo') || raw.includes('yellow') || raw.includes('warn')) return 'amarillo'
    return 'verde'
  }
  if (stateMode === 'dual') {
    return raw.includes('alerta') || raw.includes('critical') || raw.includes('alta') ? 'alerta' : 'normal'
  }
  if (raw.includes('superior') || raw.includes('alta') || raw.includes('alerta') || raw.includes('critical')) return 'superior'
  if (raw.includes('inferior') || raw.includes('baja')) return 'inferior'
  return 'centro'
}

function stateOptionsForMode(stateMode) {
  if (stateMode === 'traffic') {
    return [
      { code: 'verde', label: 'VERDE' },
      { code: 'amarillo', label: 'AMARILLO' },
      { code: 'rojo', label: 'ROJO' },
    ]
  }
  if (stateMode === 'tri') {
    return [
      { code: 'inferior', label: 'INFERIOR' },
      { code: 'centro', label: 'CENTRO' },
      { code: 'superior', label: 'SUPERIOR' },
    ]
  }
  return [
    { code: 'normal', label: 'NORMAL' },
    { code: 'alerta', label: 'ALERTA' },
  ]
}

function defaultStateForMode(mode) {
  if (mode === 'traffic') return 'verde'
  if (mode === 'tri') return 'centro'
  return 'normal'
}

function overlayUrl(item, stateCode) {
  const assets = item.overlayAssets || {}
  if (item.stateMode === 'traffic') {
    if (stateCode === 'rojo') return assets.critical || assets.normal || null
    if (stateCode === 'amarillo') return assets.warn || assets.normal || assets.critical || null
    return assets.normal || null
  }
  if (item.stateMode === 'tri') {
    if (stateCode === 'inferior') return null
    if (stateCode === 'superior') return assets.critical || null
    return assets.normal || null
  }
  return stateCode === 'alerta'
    ? assets.critical || assets.normal || null
    : assets.normal || assets.critical || null
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

export default function AndesNorteLegacyPage() {
  const config = ANDES_NORTE_CONFIG
  const { detail, state, refresh, accessDenied, licenseInfo } = useSismicoSite(config.siteCode)
  const [runtime, setRuntime] = useState({ environment: 'local', externalSourcesOn: false, semaforosMode: 'DRY-RUN' })
  const [backendStates, setBackendStates] = useState({})
  const [manualOverrides, setManualOverrides] = useState({})
  const [zoom, setZoom] = useState(1)
  const [refreshTick, setRefreshTick] = useState(0)
  const [emergencyActive, setEmergencyActive] = useState(false)
  const sirenRef = useRef(null)
  const wallMode = useMemo(() => new URLSearchParams(window.location.search).has('pantalla'), [])
  const [logs, setLogs] = useState([nowLine('Fuentes externas OFF')])

  const allItems = useMemo(() => config.groups.flatMap(group => group.items.map(item => ({ ...item, group: group.title }))), [])

  useEffect(() => {
    loadPublicRuntimeConfig().then((data) => setRuntime(runtimeFromPayload(data))).catch(() => undefined)
  }, [])

  useEffect(() => {
    const nextStates = {}
    for (const item of state?.object_states || []) {
      const rawCode = normalizeText(item.object_code || item.name || item.object_name)
      const found = allItems.find((obj) => obj.keys.some((k) => rawCode === normalizeText(k) || rawCode.includes(normalizeText(k))))
      if (!found) continue
      nextStates[found.code] = normalizeState(item.value || item.state_code || item.label || item.state, found.stateMode)
    }
    if (Object.keys(nextStates).length) setBackendStates((prev) => ({ ...prev, ...nextStates }))
  }, [state, allItems])

  useEffect(() => {
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined)
      loadPublicRuntimeConfig().then((data) => setRuntime(runtimeFromPayload(data))).catch(() => undefined)
      setRefreshTick((prev) => prev + 1)
    }, config.refreshMs)
    return () => window.clearInterval(timer)
  }, [config.refreshMs, refresh])

  useEffect(() => {
    const pollEmergency = () => {
      getEmergencyState().then((data) => setEmergencyActive(Boolean(data?.is_active))).catch(() => undefined)
    }
    pollEmergency()
    const timer = window.setInterval(pollEmergency, 5000)
    return () => window.clearInterval(timer)
  }, [])

  const effectiveStates = useMemo(() => {
    const out = {}
    for (const item of allItems) out[item.code] = defaultStateForMode(item.stateMode)
    Object.assign(out, backendStates)
    Object.assign(out, manualOverrides)
    return out
  }, [allItems, backendStates, manualOverrides, runtime.externalSourcesOn])

  const overlayItems = useMemo(() => {
    return allItems
      .map((item, index) => {
        const stateCode = effectiveStates[item.code] || defaultStateForMode(item.stateMode)
        const src = overlayUrl(item, stateCode)
        if (!src) return null
        return { code: item.code, src: `${src}?v=${refreshTick}`, stateCode, zIndex: 10 + index }
      })
      .filter(Boolean)
  }, [allItems, effectiveStates, refreshTick])

  async function handleState(item, stateCode) {
    setManualOverrides((prev) => ({ ...prev, [item.code]: stateCode }))
    if (!hasSismicoObjectSupport(item, detail?.objects, state?.object_states)) {
      setLogs((prev) => [nowLine(`Backend aun no publica ${item.name}; override local mantenido.`), ...prev].slice(0, 12))
      return
    }
    const backendObjectCode = resolveSismicoObjectCode(item, detail?.objects, state?.object_states)
    const response = await setManualObjectState({
      siteCode: config.siteCode,
      objectCode: backendObjectCode,
      stateCode,
      requestedBy: 'andes_norte_ui',
    })
    if (!response?.ok) {
      setLogs((prev) => [nowLine(`Backend sin aplicar ${item.name}; override local mantenido: ${response.error || response.status || 'sin detalle'}`), ...prev].slice(0, 12))
      return
    }
    refresh().catch(() => undefined)
  }

  async function toggleEmergency() {
    const next = !emergencyActive
    setEmergencyActive(next)
    try {
      await setEmergencyState({
        is_active: next,
        site_code: config.siteCode,
        screen_number: wallMode ? Number(new URLSearchParams(window.location.search).get('pantalla') || 0) || null : null,
        siren_type: 'police',
      })
    } catch {}
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
    } catch {}
  }

  if (accessDenied) return <ScreenLicenseGate licenseInfo={licenseInfo} />

  return (
    <div className={`andes-norte-legacy ${wallMode ? 'andes-norte-legacy--wall' : 'andes-norte-legacy--dashboard'}`}>
      <audio ref={sirenRef} src="/sounds/alert_siren.mp3" preload="auto" loop />
      <div className="andes-norte-legacy__toolbar">
        <button className="andes-norte-legacy__emergency" onClick={toggleEmergency}>Emergencia</button>
      </div>

      <div className="andes-norte-legacy__grid">
        <section className="andes-norte-legacy__panel andes-norte-legacy__panel--left">
          <div className="andes-norte-legacy__panel-title">{config.title}</div>
          <div className="andes-norte-legacy__left-scroll">
            {config.groups.map((group) => (
              <div key={group.title} className="andes-norte-legacy__group">
                <div className="andes-norte-legacy__group-title">{group.title}</div>
                {group.items.map((item) => (
                  <div key={item.code} className="andes-norte-legacy__row">
                    <div className="andes-norte-legacy__label">{item.name}</div>
                    <div className={`andes-norte-legacy__actions andes-norte-legacy__actions--${item.stateMode}`}>
                      {stateOptionsForMode(item.stateMode).map((option) => (
                        <button
                          key={option.code}
                          className={`andes-norte-legacy__state ${effectiveStates[item.code] === option.code ? `is-active is-${option.code}` : ''}`}
                          disabled={false}
                          onClick={() => handleState(item, option.code)}
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
          <img className="andes-norte-legacy__footer-logo" src={config.footerLogo} alt="Telemining" />
        </section>

        <section className="andes-norte-legacy__panel andes-norte-legacy__panel--map">
          <div className="andes-norte-legacy__panel-title">{config.mapTitle}</div>
          <div className="andes-norte-legacy__map-wrap">
            <div className="andes-norte-legacy__map-toolbar">
              <button type="button" onClick={() => setZoom((z) => Math.min(2.4, +(z + 0.12).toFixed(2)))}>+</button>
              <button type="button" onClick={() => setZoom((z) => Math.max(0.76, +(z - 0.12).toFixed(2)))}>−</button>
              <button type="button" onClick={() => { setZoom(1); refresh().catch(() => undefined); setRefreshTick((v) => v + 1) }}>⟳</button>
              <button type="button" onClick={() => { const url = new URL(window.location.href); if (!url.searchParams.get('pantalla')) url.searchParams.set('pantalla', '1'); window.location.href = url.toString() }}>▣</button>
            </div>
            <div className="andes-norte-legacy__map-stack" style={{ transform: `scale(${zoom})` }}>
              <img className="andes-norte-legacy__map-base" src={`${config.mapBase}?v=${refreshTick}`} alt="Plano Andes Norte" />
              {overlayItems.map((item) => (
                <img key={`${item.code}-${item.stateCode}-${refreshTick}`} className={`andes-norte-legacy__overlay state-${item.stateCode}`} src={item.src} alt="" style={{ zIndex: item.zIndex }} />
              ))}
              <img className="andes-norte-legacy__map-logo" src={config.mapLogo} alt="Andes Norte" />
            </div>
            <div className="andes-norte-legacy__last-register">Último registro:</div>
          </div>
        </section>
      </div>
    </div>
  )
}
