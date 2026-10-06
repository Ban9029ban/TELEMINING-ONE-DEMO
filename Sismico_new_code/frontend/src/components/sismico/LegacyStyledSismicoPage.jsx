import { useSharedMapState } from '../../hooks/useSharedMapState'
import { VisualBox } from '../visual/VisualLayout'
import ScreenLicenseGate from '../ScreenLicenseGate'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useSismicoSite } from '../../hooks/useSismicoSite'
import { loadPublicRuntimeConfig, getEmergencyState, setEmergencyState } from '../../services/sismicoApi'
import { getSismicoLegacySiteConfig } from '../../config/sismicoLegacySiteConfigs'
import { normalizeSiteCode } from '../../utils/siteNormalizer'
import { setManualObjectState } from '../../services/sismicoOperatorApi'
import { getLastRecordInfo } from '../../utils/lastRecord'
import { hasSismicoObjectSupport, resolveSismicoObjectCode } from '../../utils/sismicoObjectResolver'
import { useAuth } from '../../context/AuthContext'
import { canManageSismicoManualState } from '../../utils/sismicoPermissions'
import {
  buildDisplayStateFromManualEntries,
  createManualEntry,
  findLinkedManualItemCodes,
  manualEntriesToStateMap,
  reconcileManualEntries,
  rollbackManualEntries,
} from '../../utils/sismicoManualState'
import { usePersistentBoxVisibility } from '../../hooks/usePersistentBoxVisibility'
import '../../pages/LegacyDashboardResponsive.css'

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
  if (stateMode === 'traffic') {
    if (raw.includes('rojo') || raw.includes('red') || raw.includes('crit')) return 'rojo'
    if (raw.includes('amarillo') || raw.includes('yellow') || raw.includes('warn')) return 'amarillo'
    return 'verde'
  }
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
  if (stateMode === 'traffic') {
    return [
      { code: 'verde', label: 'VERDE' },
      { code: 'amarillo', label: 'AMARILLO' },
      { code: 'rojo', label: 'ROJO' },
    ]
  }
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
  if (item.stateMode === 'traffic' || item.state_mode === 'traffic') {
    if (stateCode === 'rojo') return assets.rojo || assets.critical || assets.alert || assets.normal || assets.safe || null
    if (stateCode === 'amarillo') return assets.amarillo || assets.warning || assets.warn || assets.normal || assets.safe || null
    return assets.verde || assets.normal || assets.safe || null
  }
  if (item.stateMode === 'tri' || item.state_mode === 'tri') {
    if (stateCode === 'inferior') return assets.inferior || assets.critical || assets.alert || null
    if (stateCode === 'centro') return assets.normal || assets.safe || null
    if (stateCode === 'superior') return assets.superior || assets.critical || assets.alert || null
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

function getProjectMeta(siteCode) {
  if (siteCode === 'diamante') {
    return {
      title: 'DIAMANTE',
      subtitle: 'CARTERA DE PROYECTOS',
      strong: 'TENIENTE',
      footerLogo: '/legacy/TELE.png',
    }
  }
  return { title: '', subtitle: '', strong: '', footerLogo: '/legacy/TELE.png' }
}

function overlayPriority(code, stateCode, manualOverrides) {
  const manual = Object.prototype.hasOwnProperty.call(manualOverrides || {}, code)
  if (manual) return 400
  if (stateCode === 'inferior' || stateCode === 'superior' || stateCode === 'alerta' || stateCode === 'rojo') return 300
  if (stateCode === 'amarillo') return 240
  if (stateCode === 'centro' || stateCode === 'normal' || stateCode === 'verde') return 200
  return 100
}

function removeOverrides(prev, codes) {
  let changed = false
  const next = { ...prev }
  for (const code of codes) {
    if (Object.prototype.hasOwnProperty.call(next, code)) {
      delete next[code]
      changed = true
    }
  }
  return changed ? next : prev
}

export default function LegacyStyledSismicoPage({ config }) {
  const { user } = useAuth()
  const resolvedConfig = useMemo(() => {
    if (config?.siteCode) return config
    const pathSite = normalizeSiteCode(window.location.pathname.split('/').pop())
    return getSismicoLegacySiteConfig(pathSite)
  }, [config])

  const { detail, state, refresh, accessDenied, licenseInfo } = useSismicoSite(resolvedConfig?.siteCode || '')
  const [runtime, setRuntime] = useState({
    environment: 'local',
    externalSourcesOn: false,
    semaforosMode: 'DRY-RUN',
  })
  const [backendStates, setBackendStates] = useState({})
  const [manualOverrides, setManualOverrides] = useSharedMapState(resolvedConfig?.siteCode, user?.username)
  const [logs, setLogs] = useState([nowLine('Fuentes externas OFF')])
  const [zoom, setZoom] = useState(1)
  const [refreshTick, setRefreshTick] = useState(0)
  const [flashTick, setFlashTick] = useState(0)
  const [emergencyActive, setEmergencyActive] = useState(false)
  const [mapIndex, setMapIndex] = useState(0)
  const sirenRef = useRef(null)
  const wallMode = useMemo(() => new URLSearchParams(window.location.search).has('pantalla'), [])
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), [])
  const sicLock = urlParams.get('sic_lock') === '1'
  const forceHideLeft = urlParams.get('sic_left') === '0'
  const forceHideMap = urlParams.get('sic_map') === '0'
  const projectMeta = useMemo(() => getProjectMeta(resolvedConfig?.siteCode || ''), [resolvedConfig?.siteCode])
  const allManualEntries = useMemo(() => manualEntriesToStateMap(manualOverrides), [manualOverrides])
  const displayState = useMemo(() => buildDisplayStateFromManualEntries(state, manualOverrides), [state, manualOverrides])
  const manualAllowed = canManageSismicoManualState(user)
  const [controlError, setControlError] = useState('')
  const lastRecordInfo = getLastRecordInfo(displayState)
  const lastRecordLabel = lastRecordInfo.text
  const layoutKey = useMemo(() => `legacy-site-boxes:${resolvedConfig?.siteCode || 'unknown'}`, [resolvedConfig?.siteCode])
  const {
    isHidden,
    hideBox,
    showBox,
    hiddenIds,
  } = usePersistentBoxVisibility(layoutKey, ['left', 'map'])
  const bothHidden = isHidden('left') && isHidden('map')
  const leftHidden = forceHideLeft || isHidden('left')
  const mapHidden = forceHideMap || isHidden('map')
  const bothEffectiveHidden = leftHidden && mapHidden

  const addLog = (message) => setLogs((prev) => [nowLine(message), ...prev].slice(0, 16))
  const projectObjects = useMemo(() => mergeObjects(resolvedConfig?.objects || [], detail?.objects || []), [resolvedConfig, detail])

  useEffect(() => {
    loadPublicRuntimeConfig()
      .then((data) => setRuntime(runtimeFromPayload(data)))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const objectStates = state?.object_states || []
    const nextStates = {}
    for (const item of objectStates) {
      const rawCode = normalizeText(item.object_code || item.name || item.object_name)
      const found = projectObjects.find((obj) => (obj.keys || []).some((k) => rawCode === normalizeText(k) || rawCode.includes(normalizeText(k))))
      if (!found) continue
      nextStates[found.code] = normalizeState(item.value || item.state_code || item.label || item.state, found.stateMode)
    }
    if (Object.keys(nextStates).length) {
      setBackendStates((prev) => ({ ...prev, ...nextStates }))
    }
    setManualOverrides((prev) => reconcileManualEntries(prev, objectStates, resolvedConfig.siteCode))
  }, [state, projectObjects, resolvedConfig.siteCode])


  useEffect(() => {
    if (!resolvedConfig?.siteCode) return undefined
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined)
      loadPublicRuntimeConfig().then((data) => setRuntime(runtimeFromPayload(data))).catch(() => undefined)
      setFlashTick((prev) => prev + 1)
      window.setTimeout(() => setRefreshTick((prev) => prev + 1), 450)
    }, config.refreshMs || 6500)
    return () => window.clearInterval(timer)
  }, [resolvedConfig?.refreshMs, refresh])

  useEffect(() => {
    const pollEmergency = () => {
      getEmergencyState().then((data) => {
        setEmergencyActive(Boolean(data?.is_active))
      }).catch(() => undefined)
    }
    pollEmergency()
    const timer = window.setInterval(pollEmergency, 5000)
    return () => window.clearInterval(timer)
  }, [])

  const effectiveStates = useMemo(() => {
    const out = {}
    for (const item of projectObjects) {
      out[item.code] =
        item.stateMode === 'tri'
          ? 'centro'
          : item.stateMode === 'traffic'
            ? 'verde'
            : 'normal'
    }
    Object.assign(out, backendStates)
    Object.assign(out, allManualEntries)
    return out
  }, [projectObjects, backendStates, allManualEntries, runtime.externalSourcesOn])

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
    candidates.push(...(resolvedConfig?.mapFallbacks || []))
    const idx = Math.min(mapIndex, Math.max(0, candidates.length - 1))
    return `${candidates[idx] || ''}?v=${refreshTick}`
  }, [detail, resolvedConfig, mapIndex, refreshTick])

  const overlayItems = useMemo(() => {
    return projectObjects
      .map((item, index) => {
        const defaultState =
          item.stateMode === 'tri'
            ? 'centro'
            : item.stateMode === 'traffic'
              ? 'verde'
              : 'normal'
        const stateCode = effectiveStates[item.code] || defaultState
        const src = overlayUrl(item, stateCode)
        if (!src) return null
        return {
          code: item.code,
          src: `${src}?v=${refreshTick}`,
          stateCode,
          zIndex: overlayPriority(item.code, stateCode, manualOverrides) + index,
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.zIndex - b.zIndex)
  }, [projectObjects, effectiveStates, manualOverrides, refreshTick])

  const handleState = async (item, stateCode) => {
    if (!manualAllowed) {
      addLog('Perfil sin permisos para cambio manual.')
      return
    }

    const previousManual = manualOverrides
    const linkedCodes = findLinkedManualItemCodes(projectObjects, item, detail?.objects, state?.object_states)
    const entry = createManualEntry(item, stateCode, detail?.objects, state?.object_states)
    setManualOverrides((prev) => {
      const next = { ...prev }
      for (const code of linkedCodes) {
        next[code] = { ...entry }
      }
      return next
    })
    setFlashTick((prev) => prev + 1)
    window.setTimeout(() => setRefreshTick((prev) => prev + 1), 450)
    addLog(`${item.name} => ${stateCode.toUpperCase()}`)

    if (!hasSismicoObjectSupport(item, detail?.objects, state?.object_states)) {
      addLog(`Backend aun no publica ${item.name}; override local mantenido.`)
      return
    }

    const backendObjectCode = resolveSismicoObjectCode(item, detail?.objects, state?.object_states)
    const response = await setManualObjectState({
      siteCode: resolvedConfig.siteCode,
      objectCode: backendObjectCode,
      stateCode,
      requestedBy: 'legacy_site_ui',
    })

    if (!response?.ok) {
      setManualOverrides(current => rollbackManualEntries(current, previousManual, linkedCodes, entry))
      setControlError(response?.error || 'No se pudo guardar el estado del polígono.')
      return
    }
    setControlError('')

    addLog(`Cambio manual aplicado en backend para ${item.name}`)
    refresh().catch(() => undefined)
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
    try {
      await setEmergencyState({
        is_active: next,
        site_code: resolvedConfig.siteCode,
        screen_number: wallMode ? Number(new URLSearchParams(window.location.search).get('pantalla') || 0) || null : null,
        siren_type: 'police',
      })
    } catch {
      addLog('No fue posible actualizar la emergencia global.')
    }
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

  useEffect(() => {
    if (!sirenRef.current) return
    const audio = sirenRef.current
    const run = async () => {
      try {
        if (emergencyActive) {
          audio.pause()
          audio.currentTime = 0
          await audio.play()
        } else {
          audio.pause()
          audio.currentTime = 0
        }
      } catch {}
    }
    run()
  }, [emergencyActive])

  if (accessDenied) return <ScreenLicenseGate licenseInfo={licenseInfo} />

  if (!resolvedConfig) {
    return <div style={{ padding: 24, color: '#b42318', fontWeight: 800 }}>ERROR: No existe configuración para este sitio.</div>
  }

  return (
    <div className={`legacy-site-page ${resolvedConfig.pageClass} ${wallMode ? 'wall-mode' : ''} ${sicLock ? 'sic-lock' : ''}`}>
      <audio ref={sirenRef} src="/sounds/alert_siren.mp3" preload="auto" loop />
      {controlError && <p className="polygon-control-error" role="alert">{controlError}</p>}
      {emergencyActive ? (
        <div className="legacy-site-emergency-overlay" onClick={toggleEmergency}>
          <div className="legacy-site-emergency-box">
            <div className="legacy-site-emergency-title">EMERGENCIA</div>
            <div className="legacy-site-emergency-subtitle">Sirena activa — pulse para detener</div>
          </div>
        </div>
      ) : null}

      {!sicLock ? (
      <VisualBox id="actions" label="Controles del dashboard"><div className="legacy-site-toolbar">
        <button className="legacy-site-btn emergency" onClick={toggleEmergency}>Emergencia</button>
        <div className="legacy-site-box-toggle-wrap">
          {leftHidden ? <button className="legacy-site-btn" onClick={() => showBox('left')}>Mostrar panel izquierdo</button> : null}
          {mapHidden ? <button className="legacy-site-btn" onClick={() => showBox('map')}>Mostrar plano</button> : null}
          {bothEffectiveHidden ? <button className="legacy-site-btn" onClick={() => { showBox('left'); showBox('map') }}>Mostrar todo</button> : null}
        </div>
      </div></VisualBox>
      ) : null}

      <div className={`legacy-site-shell ${leftHidden ? 'left-hidden' : ''} ${mapHidden ? 'map-hidden' : ''}`}>
        {!leftHidden ? (
        <div className="legacy-site-left">
          {resolvedConfig.projectImage ? (
            <VisualBox id="project" label="Información del proyecto"><section className="legacy-site-card legacy-site-project-card">
              <div className="legacy-site-card-title legacy-site-card-title-with-toggle"><span>{resolvedConfig.projectTitle || resolvedConfig.mapTitle || resolvedConfig.title}</span></div>
              <div className="legacy-site-project-image-wrap">
                <div className="legacy-site-project-hero">
                  <img className="legacy-site-project-image" src={resolvedConfig.projectImage} alt={resolvedConfig.projectTitle || resolvedConfig.title} />
                  {projectMeta.title ? (
                    <div className="legacy-site-project-copy">
                      <div className="legacy-site-project-copy-main">{projectMeta.title}</div>
                      <div className="legacy-site-project-copy-sub">{projectMeta.subtitle}</div>
                      <div className="legacy-site-project-copy-strong">{projectMeta.strong}</div>
                    </div>
                  ) : null}
                </div>
              </div>
            </section></VisualBox>
          ) : null}

          <VisualBox id="buttons" label="Botones y estados"><section className="legacy-site-card legacy-site-table-card">
            <div className="legacy-site-card-title legacy-site-card-title-with-toggle"><span>{resolvedConfig.title}</span>{!sicLock ? <button className="legacy-site-hide-btn" onClick={() => hideBox('left')}>Ocultar</button> : null}</div>
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
            <img className="legacy-site-footer-logo" src={projectMeta.footerLogo} alt="Telemining" />
          </section></VisualBox>

          {!wallMode && (
            <VisualBox id="connection" label="Estado de conexión"><section className="legacy-site-card legacy-site-conn-card">
              <div className="legacy-site-card-title">Estado de Conexión</div>
              <div className="legacy-site-conn-body">
                {logs.map((line, idx) => (
                  <div key={`${line}-${idx}`} className="legacy-site-log-line">{line}</div>
                ))}
              </div>
            </section></VisualBox>
          )}
        </div>
        ) : null}

        {!mapHidden ? (
        <VisualBox id="map" label="Mapa"><section className="legacy-site-card legacy-site-map-card">
          <div className="legacy-site-card-title legacy-site-map-header legacy-site-card-title-with-toggle">
            <div>{resolvedConfig.mapTitle}</div>
            {!sicLock ? <button className="legacy-site-hide-btn" onClick={() => hideBox('map')}>Ocultar</button> : null}
          </div>
          <div className="legacy-site-map-area">
            <div className={`legacy-site-map-viewport pulse-${flashTick % 2}`}>
              <div className="legacy-site-map-toolbar">
                <button type="button" onClick={() => setZoom((z) => Math.min(2.4, +(z + 0.12).toFixed(2)))}>+</button>
                <button type="button" onClick={() => setZoom((z) => Math.max(0.76, +(z - 0.12).toFixed(2)))}>−</button>
                <button type="button" onClick={() => { setZoom(1); handleRefresh() }}>⟳</button>
                <button type="button" onClick={() => { const url = new URL(window.location.href); if (!url.searchParams.get('pantalla')) url.searchParams.set('pantalla', '1'); window.location.href = url.toString() }}>▣</button>
              </div>
              <div className="legacy-site-map-stack" style={{ transform: `scale(${zoom})` }}>
                <img className="legacy-site-map-base" src={baseMapSrc} alt={`${resolvedConfig.siteCode} map`} onError={() => setMapIndex((i) => i + 1)} />
                {overlayItems.map((item, index) => (
                  <img
                    key={`${item.code}-${item.stateCode}-${refreshTick}`}
                    className={`legacy-site-map-overlay state-${item.stateCode} blink-slot-${index % 7}`}
                    src={item.src}
                    alt=""
                    style={{ zIndex: item.zIndex }}
                  />
                ))}
              </div>
              <div className={`legacy-site-map-last-register ${lastRecordInfo.toneClass}`}>Último registro:<br /><span style={{ fontSize: '11px', fontWeight: 700 }}>{lastRecordLabel}</span></div>
            </div>
          </div>
        </section></VisualBox>
        ) : null}

        {!sicLock && (leftHidden || mapHidden) ? (
          <section className="legacy-site-card legacy-site-hidden-box-card">
            <div className="legacy-site-card-title">Boxes ocultos</div>
            <div className="legacy-site-hidden-box-body">
              {leftHidden ? <button className="legacy-site-btn" onClick={() => showBox('left')}>Mostrar panel izquierdo</button> : null}
              {mapHidden ? <button className="legacy-site-btn" onClick={() => showBox('map')}>Mostrar plano</button> : null}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}
