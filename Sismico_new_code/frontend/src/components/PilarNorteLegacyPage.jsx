import { useSharedMapState } from '../hooks/useSharedMapState'
import { VisualBox } from './visual/VisualLayout'
import ScreenLicenseGate from './ScreenLicenseGate'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useSismicoSite } from '../hooks/useSismicoSite'
import { getEmergencyState, setEmergencyState } from '../services/sismicoApi'
import { setManualObjectState } from '../services/sismicoOperatorApi'
import { PILAR_NORTE_CONFIG } from '../config/pilarNorteConfig'
import '../pages/PilarNortePage.css'
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

function defaultState() {
  return 'centro'
}

function stateFromRaw(rawValue) {
  const raw = norm(rawValue)
  if (raw.includes('superior') || raw.includes('alta') || raw.includes('alerta') || raw.includes('critical')) return 'superior'
  if (raw.includes('inferior') || raw.includes('baja')) return 'inferior'
  return 'centro'
}

function assetForState(item, stateCode) {
  if (stateCode === 'inferior') return item.assets.inferior || item.assets.superior || item.assets.centro || null
  if (stateCode === 'superior') return item.assets.superior || item.assets.inferior || item.assets.centro || null
  return item.assets.centro || item.assets.normal || null
}

function stateLayerPriority(stateCode) {
  if (stateCode === 'inferior' || stateCode === 'superior') return 300
  if (stateCode === 'centro') return 140
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

export default function PilarNorteLegacyPage() {
  const config = PILAR_NORTE_CONFIG
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
  const {
    isHidden,
    hideBox,
    showBox,
    hiddenIds,
  } = usePersistentBoxVisibility('legacy-site-boxes:pilar_norte', ['left', 'map'])
  const bothHidden = isHidden('left') && isHidden('map')
  const leftHidden = forceHideLeft || isHidden('left')
  const mapHidden = forceHideMap || isHidden('map')
  const bothEffectiveHidden = leftHidden && mapHidden

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
    setManual((prev) => reconcileManualEntries(prev, state?.object_states || []))
  }, [state])

  const effectiveStates = useMemo(() => {
    const out = {}
    for (const group of config.groups) {
      for (const item of group.items) out[item.code] = defaultState()
    }
    for (const entry of state?.object_states || []) {
      const rawCode = norm(entry.object_code || entry.name || entry.object_name)
      for (const group of config.groups) {
        for (const item of group.items) {
          if ((item.keys || []).some((k) => rawCode === norm(k) || rawCode.includes(norm(k)))) {
            out[item.code] = stateFromRaw(entry.value || entry.state_code || entry.label || entry.state)
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
        const stateCode = effectiveStates[item.code] || defaultState()
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

    const impactedCodes = findLinkedManualItemCodes(allItems, item, detail?.objects, state?.object_states)
    const entry = createManualEntry(item, stateCode, detail?.objects, state?.object_states)
    setSelectedObjectCode(item.code)
    setManual((prev) => {
      const next = { ...prev }
      for (const code of impactedCodes) next[code] = { ...entry }
      return next
    })
    setFlashTick((v) => v + 1)
    if (!hasSismicoObjectSupport(item, detail?.objects, state?.object_states)) {
      console.warn('[SISMICO OPERATOR] Pilar Norte sin soporte backend actual; override local mantenido', {
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
      requestedBy: 'pilar_norte_ui',
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
    <div className={`pilarnorte-page ${wallMode ? 'wall-mode' : ''} ${sicLock ? 'sic-lock' : ''}`}>
      <audio ref={sirenRef} src="/sounds/alert_siren.mp3" preload="auto" loop />
      {controlError && <p className="polygon-control-error" role="alert">{controlError}</p>}

      {emergencyActive ? (
        <div className="pilarnorte-emergency-overlay" onClick={toggleEmergency}>
          <div className="pilarnorte-emergency-box">
            <div className="pilarnorte-emergency-title">EMERGENCIA</div>
            <div className="pilarnorte-emergency-subtitle">Sirena activa — pulse para detener</div>
          </div>
        </div>
      ) : null}

      {!sicLock ? (
      <VisualBox id="actions" label="Controles del dashboard"><div className="pilarnorte-toolbar">
        <button className="pilarnorte-emergency-btn" onClick={toggleEmergency}>Emergencia</button>
        <div className="legacy-site-box-toggle-wrap">
          {leftHidden ? <button className="legacy-site-btn" onClick={() => showBox('left')}>Mostrar panel izquierdo</button> : null}
          {mapHidden ? <button className="legacy-site-btn" onClick={() => showBox('map')}>Mostrar plano</button> : null}
          {bothEffectiveHidden ? <button className="legacy-site-btn" onClick={() => { showBox('left'); showBox('map') }}>Mostrar todo</button> : null}
        </div>
      </div></VisualBox>
      ) : null}

      <div className={`pilarnorte-shell ${leftHidden ? 'left-hidden' : ''} ${mapHidden ? 'map-hidden' : ''}`}>
        {!leftHidden ? (
        <div className="pilarnorte-left">
          {!wallMode ? (
            <VisualBox id="project" label="Información del proyecto"><section className="pilarnorte-card pilarnorte-brand-card">
              <div className="pilarnorte-card-title legacy-site-card-title-with-toggle"><span>{config.projectTitle}</span></div>
              <div className="pilarnorte-brand-wrap">
                <img className="pilarnorte-brand-logo" src={config.projectLogo} alt="Logo Codelco" />
              </div>
            </section></VisualBox>
          ) : null}

          <VisualBox id="buttons" label="Botones y estados"><section className="pilarnorte-card pilarnorte-table-card">
            <div className="pilarnorte-card-title legacy-site-card-title-with-toggle"><span>{config.title}</span>{!sicLock ? <button className="legacy-site-hide-btn" onClick={() => hideBox('left')}>Ocultar</button> : null}</div>
            <div className="pilarnorte-groups-scroll">
              {config.groups.map((group) => (
                <div key={group.title} className="pilarnorte-group">
                  <div className="pilarnorte-group-title">{group.title}</div>
                  {group.items.map((item) => (
                    <div key={item.code} className="pilarnorte-row">
                      <div className="pilarnorte-label">{item.name}</div>
                      <div className="pilarnorte-actions">
                        {['inferior', 'centro', 'superior'].map((code) => (
                          <button
                            key={code}
                            className={`pilarnorte-state ${effectiveStates[item.code] === code ? `active ${code}` : ''}`}
                            onClick={() => handleState(item, code)}
                            disabled={!manualAllowed}
                          >
                            {code.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <img className="pilarnorte-footer-logo" src={config.footerLogo} alt="Telemining" />
          </section></VisualBox>
        </div>
        ) : null}

        {!mapHidden ? (
        <VisualBox id="map" label="Mapa"><section className="pilarnorte-card pilarnorte-map-card">
          <div className="pilarnorte-card-title legacy-site-card-title-with-toggle"><span>{config.mapTitle}</span>{!sicLock ? <button className="legacy-site-hide-btn" onClick={() => hideBox('map')}>Ocultar</button> : null}</div>
          <div className="pilarnorte-map-body">
            <div className="pilarnorte-map-toolbar">
              <button type="button" onClick={() => setZoom((z) => Math.min(2.4, +(z + 0.12).toFixed(2)))}>+</button>
              <button type="button" onClick={() => setZoom((z) => Math.max(0.76, +(z - 0.12).toFixed(2)))}>−</button>
              <button type="button" onClick={() => { setZoom(1); refresh().catch(() => undefined) }}>⟳</button>
              <button type="button" onClick={() => { const url = new URL(window.location.href); if (!url.searchParams.get('pantalla')) url.searchParams.set('pantalla', '1'); window.location.href = url.toString() }}>▣</button>
            </div>
            <div className={`pilarnorte-map-viewport pulse-${flashTick % 2}`}>
              <div className="pilarnorte-map-stack" style={{ transform: `scale(${zoom})` }}>
                <img className="pilarnorte-map-base" src={config.mapBase} alt="Plano Pilar Norte" />
                {overlays.map((item, index) => (
                  <img
                    key={item.key}
                    className={`pilarnorte-map-overlay state-${item.stateCode} blink-slot-${index % 7}`}
                    src={item.src}
                    alt=""
                    style={{ zIndex: item.zIndex }}
                  />
                ))}
                <img className="pilarnorte-compass" src={config.compassLogo} alt="Norte" />
                {wallMode ? (
                  <img className="pilarnorte-map-codelco" src={config.projectLogo} alt="Codelco" />
                ) : null}
              </div>
            </div>
            <div className={`pilarnorte-last-register ${lastRecordInfo.toneClass}`}>Último registro:<br /><span style={{ fontSize: 12, fontWeight: 700 }}>{lastRecordLabel}</span></div>
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
