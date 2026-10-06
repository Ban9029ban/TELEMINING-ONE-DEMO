import { useSharedMapState } from '../hooks/useSharedMapState'
import { VisualBox } from './visual/VisualLayout'
import ScreenLicenseGate from './ScreenLicenseGate'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useSismicoSite } from '../hooks/useSismicoSite'
import { getEmergencyState, setEmergencyState } from '../services/sismicoApi'
import { setManualObjectState } from '../services/sismicoOperatorApi'
import { ANDES_NORTE_CONFIG } from '../config/andesNorteConfig'
import '../pages/AndesNortePage.css'
import { getLastRecordInfo } from '../utils/lastRecord'
import { hasSismicoObjectSupport, resolveSismicoObjectCode } from '../utils/sismicoObjectResolver'
import { useAuth } from '../context/AuthContext'
import { canManageSismicoManualState } from '../utils/sismicoPermissions'
import {
  buildDisplayStateFromManualEntries,
  createManualEntry,
  findLinkedManualItemCodes,
  manualEntriesToStateMap,
  reconcileManualEntries,
  rollbackManualEntries,
} from '../utils/sismicoManualState'
import { usePersistentBoxVisibility } from '../hooks/usePersistentBoxVisibility'

function norm(v) {
  return String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function defaultState(mode) {
  if (mode === 'traffic') return 'verde'
  if (mode === 'dual') return 'normal'
  return 'centro'
}

function stateFromRaw(rawValue, mode) {
  const raw = norm(rawValue)
  if (mode === 'traffic') {
    if (raw.includes('rojo') || raw.includes('red') || raw.includes('crit')) return 'rojo'
    if (raw.includes('amarillo') || raw.includes('yellow') || raw.includes('warn')) return 'amarillo'
    return 'verde'
  }
  if (mode === 'dual') {
    return raw.includes('alerta') || raw.includes('critical') || raw.includes('alta') ? 'alerta' : 'normal'
  }
  if (raw.includes('superior') || raw.includes('alta') || raw.includes('alerta') || raw.includes('critical')) return 'superior'
  if (raw.includes('inferior') || raw.includes('baja')) return 'inferior'
  return 'centro'
}

function optionsForMode(mode) {
  if (mode === 'traffic') {
    return [
      { code: 'verde', label: 'VERDE' },
      { code: 'amarillo', label: 'AMARILLO' },
      { code: 'rojo', label: 'ROJO' },
    ]
  }
  if (mode === 'dual') {
    return [
      { code: 'normal', label: 'NORMAL' },
      { code: 'alerta', label: 'ALERTA' },
    ]
  }
  return [
    { code: 'inferior', label: 'INFERIOR' },
    { code: 'centro', label: 'CENTRO' },
    { code: 'superior', label: 'SUPERIOR' },
  ]
}

function assetForState(item, stateCode) {
  if (item.mode === 'traffic') return item.assets[stateCode] || item.assets.rojo || item.assets.amarillo || item.assets.verde || null
  if (item.mode === 'dual') return stateCode === 'alerta' ? (item.assets.alerta || item.assets.normal) : (item.assets.normal || item.assets.alerta || null)
  if (stateCode === 'inferior') return item.assets.inferior || item.assets.superior || item.assets.centro || null
  if (stateCode === 'superior') return item.assets.superior || item.assets.inferior || item.assets.centro || null
  return item.assets.centro || item.assets.normal || null
}

function stateLayerPriority(stateCode) {
  if (stateCode === 'inferior' || stateCode === 'superior' || stateCode === 'rojo' || stateCode === 'alerta') return 300
  if (stateCode === 'amarillo') return 220
  if (stateCode === 'centro' || stateCode === 'verde' || stateCode === 'normal') return 140
  return 100
}

function removeManualState(prev, codes) {
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

export default function AndesNorteLegacyPage({ config = ANDES_NORTE_CONFIG }) {
  const { user } = useAuth()
  const { detail, state, refresh, accessDenied, licenseInfo } = useSismicoSite(config.siteCode)
  const [manual, setManual] = useSharedMapState(config.siteCode, user?.username)
  const [zoom, setZoom] = useState(1)
  const [flashTick, setFlashTick] = useState(0)
  const [selectedObjectCode, setSelectedObjectCode] = useSharedMapState(config.siteCode, user?.username, 'selection', null)
  const [emergencyActive, setEmergencyActive] = useState(false)
  const sirenRef = useRef(null)
  const wallMode = useMemo(() => new URLSearchParams(window.location.search).has('pantalla'), [])
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), [])
  const sicLock = urlParams.get('sic_lock') === '1'
  const forceHideLeft = urlParams.get('sic_left') === '0'
  const forceHideMap = urlParams.get('sic_map') === '0'
  const allItems = useMemo(() => config.groups.flatMap((group) => group.items), [config.groups])
  const manualStates = useMemo(() => manualEntriesToStateMap(manual), [manual])
  const displayState = useMemo(() => buildDisplayStateFromManualEntries(state, manual), [state, manual])
  const manualAllowed = canManageSismicoManualState(user)
  const [controlError, setControlError] = useState('')
  const visibilityStorageKey = useMemo(
    () => config.visibilityStorageKey || `legacy-site-boxes:${config.siteCode || 'andes_norte'}`,
    [config.visibilityStorageKey, config.siteCode],
  )
  const {
    isHidden,
    hideBox,
    showBox,
    hiddenIds,
  } = usePersistentBoxVisibility(visibilityStorageKey, ['left', 'map'])
  const bothHidden = isHidden('left') && isHidden('map')
  const leftHidden = forceHideLeft || isHidden('left')
  const mapHidden = forceHideMap || isHidden('map')
  const bothEffectiveHidden = leftHidden && mapHidden
  const mapBrandLogos = useMemo(
    () => (Array.isArray(config.mapBrandLogos) && config.mapBrandLogos.length ? config.mapBrandLogos : [config.mapLogoIcon]),
    [config.mapBrandLogos, config.mapLogoIcon],
  )
  const mapBrandText = config.mapBrandText === undefined
    ? { main: 'ANDES NORTE', sub: 'CARTERA DE PROYECTOS', strong: 'TENIENTE' }
    : config.mapBrandText

  useEffect(() => {
    const pollEmergency = () => {
      getEmergencyState().then((data) => setEmergencyActive(Boolean(data?.is_active))).catch(() => undefined)
    }
    pollEmergency()
    const timer = setInterval(pollEmergency, 5000)
    return () => clearInterval(timer)
  }, [])

  const lastRecordInfo = getLastRecordInfo(displayState)
  const lastRecordLabel = lastRecordInfo.text

  useEffect(() => {
    setManual((prev) => reconcileManualEntries(prev, state?.object_states || [], config.siteCode))
  }, [state, config.siteCode])

  const effectiveStates = useMemo(() => {
    const out = {}
    for (const group of config.groups) {
      for (const item of group.items) out[item.code] = defaultState(item.mode)
    }
    for (const entry of state?.object_states || []) {
      const rawCode = norm(entry.object_code || entry.name || entry.object_name)
      for (const group of config.groups) {
        for (const item of group.items) {
          if ((item.keys || []).some((k) => rawCode === norm(k) || rawCode.includes(norm(k)))) {
            out[item.code] = stateFromRaw(entry.value || entry.state_code || entry.label || entry.state, item.mode)
          }
        }
      }
    }
    return { ...out, ...manualStates }
  }, [state, manualStates, config.groups])

  const overlays = useMemo(() => {
    let idx = 0
    const list = []
    for (const group of config.groups) {
      for (const item of group.items) {
        const stateCode = effectiveStates[item.code] || defaultState(item.mode)
        const src = assetForState(item, stateCode)
        if (!src) continue
        const zIndex = stateLayerPriority(stateCode) + (selectedObjectCode === item.code ? 1000 : 0) + idx++
        list.push({ key: item.code, src, zIndex, stateCode })
      }
    }
    return list.sort((a, b) => a.zIndex - b.zIndex)
  }, [effectiveStates, config.groups, selectedObjectCode])

  const handleState = async (item, stateCode) => {
    if (!manualAllowed) return

    const previousManual = manual
    const linkedCodes = findLinkedManualItemCodes(allItems, item, detail?.objects, state?.object_states)
    const entry = createManualEntry(item, stateCode, detail?.objects, state?.object_states)
    setSelectedObjectCode(item.code)
    setManual((prev) => {
      const next = { ...prev }
      for (const code of linkedCodes) {
        next[code] = { ...entry }
      }
      return next
    })
    setFlashTick((v) => v + 1)
    if (!hasSismicoObjectSupport(item, detail?.objects, state?.object_states)) {
      console.warn('[SISMICO OPERATOR] Andes Norte sin soporte backend actual; override local mantenido', {
        siteCode: config.siteCode,
        objectCode: item.backendObjectCode || item.code,
      })
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
      setManual(current => rollbackManualEntries(current, previousManual, linkedCodes, entry))
      setControlError(response?.error || 'No se pudo guardar el estado del polígono.')
      return
    }
    setControlError('')
    refresh().catch(() => undefined)
  }

  const toggleEmergency = async () => {
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
    <div className={`andesnorte-page ${wallMode ? 'wall-mode' : ''} ${sicLock ? 'sic-lock' : ''}`}>
      <audio ref={sirenRef} src="/sounds/alert_siren.mp3" preload="auto" loop />
      {controlError && <p className="polygon-control-error" role="alert">{controlError}</p>}
      {emergencyActive ? (
        <div className="andesnorte-emergency-overlay" onClick={toggleEmergency}>
          <div className="andesnorte-emergency-box">
            <div className="andesnorte-emergency-title">EMERGENCIA</div>
            <div className="andesnorte-emergency-subtitle">Sirena activa — pulse para detener</div>
          </div>
        </div>
      ) : null}
      {!sicLock ? (
      <VisualBox id="actions" label="Controles del dashboard"><div className="andesnorte-toolbar">
        <button className="andesnorte-emergency" onClick={toggleEmergency}>Emergencia</button>
        <div className="legacy-site-box-toggle-wrap">
          {leftHidden ? <button className="legacy-site-btn" onClick={() => showBox('left')}>Mostrar panel izquierdo</button> : null}
          {mapHidden ? <button className="legacy-site-btn" onClick={() => showBox('map')}>Mostrar plano</button> : null}
          {bothEffectiveHidden ? <button className="legacy-site-btn" onClick={() => { showBox('left'); showBox('map') }}>Mostrar todo</button> : null}
        </div>
      </div></VisualBox>
      ) : null}

      <div className={`andesnorte-shell ${leftHidden ? 'left-hidden' : ''} ${mapHidden ? 'map-hidden' : ''}`}>
        {!leftHidden ? (
        <VisualBox id="buttons" label="Botones y estados"><section className="andesnorte-left-card">
          <div className="andesnorte-card-title legacy-site-card-title-with-toggle"><span>{config.title}</span>{!sicLock ? <button className="legacy-site-hide-btn" onClick={() => hideBox('left')}>Ocultar</button> : null}</div>
          <div className="andesnorte-groups-scroll">
            {config.groups.map((group) => (
              <div key={group.title} className="andesnorte-group">
                <div className="andesnorte-group-title">{group.title}</div>
                {group.items.map((item) => (
                  <div key={item.code} className="andesnorte-row">
                    <div className="andesnorte-label">{item.name}</div>
                    <div className={`andesnorte-actions mode-${item.mode}`}>
                      {optionsForMode(item.mode).map((opt) => (
                        <button
                          key={opt.code}
                          className={`andesnorte-state ${effectiveStates[item.code] === opt.code ? `active ${opt.code}` : ''}`}
                          onClick={() => handleState(item, opt.code)}
                          disabled={!manualAllowed}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <img className="andesnorte-footer-logo" src={config.footerLogo} alt="Telemining" />
        </section></VisualBox>
        ) : null}

        {!mapHidden ? (
        <VisualBox id="map" label="Mapa"><section className="andesnorte-map-card">
          <div className="andesnorte-card-title legacy-site-card-title-with-toggle"><span>{config.mapTitle}</span>{!sicLock ? <button className="legacy-site-hide-btn" onClick={() => hideBox('map')}>Ocultar</button> : null}</div>
          <div className="andesnorte-map-body">
            <div className="andesnorte-map-toolbar">
              <button type="button" onClick={() => setZoom((z) => Math.min(2.4, +(z + 0.12).toFixed(2)))}>+</button>
              <button type="button" onClick={() => setZoom((z) => Math.max(0.76, +(z - 0.12).toFixed(2)))}>−</button>
              <button type="button" onClick={() => { setZoom(1); refresh().catch(() => undefined) }}>⟳</button>
              <button type="button" onClick={() => { const url = new URL(window.location.href); if (!url.searchParams.get('pantalla')) url.searchParams.set('pantalla', '1'); window.location.href = url.toString() }}>▣</button>
            </div>
            <div className={`andesnorte-map-viewport pulse-${flashTick % 2}`}>
              <div className="andesnorte-map-stack" style={{ transform: `scale(${zoom})` }}>
                <img className="andesnorte-map-base" src={config.mapBase} alt="Plano Andes Norte" />
                {overlays.map((item, index) => (
                  <img
                    key={item.key}
                    className={`andesnorte-map-overlay state-${item.stateCode} blink-slot-${index % 7}`}
                    src={item.src}
                    alt=""
                    style={{ zIndex: item.zIndex }}
                  />
                ))}
                <div className="andesnorte-map-brand">
                  <div className="andesnorte-map-brand-logos">
                    {mapBrandLogos.filter(Boolean).map((logo, idx) => (
                      <img key={`${logo}-${idx}`} src={logo} alt="logo" />
                    ))}
                  </div>
                  {mapBrandText ? (
                    <div className="andesnorte-map-brand-text">
                      <div className="main">{mapBrandText.main || ''}</div>
                      <div className="sub">{mapBrandText.sub || ''}</div>
                      <div className="strong">{mapBrandText.strong || ''}</div>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className={`andesnorte-last-register ${lastRecordInfo.toneClass}`}>Último registro:<br /><span style={{ fontSize: '11px', fontWeight: 700 }}>{lastRecordLabel}</span></div>
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
