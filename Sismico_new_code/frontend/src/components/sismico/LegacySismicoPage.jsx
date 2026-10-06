import ScreenLicenseGate from '../ScreenLicenseGate'
import React from 'react'
import { Link } from 'react-router-dom'
import { siteVisualConfig, resolveStateStyle } from '../../config/legacySismicoPages'
import { useSismicoSite } from '../../hooks/useSismicoSite'
import { getLastRecordInfo } from '../../utils/lastRecord'

function StatusPills({ mode, itemState }) {
  const style = resolveStateStyle(mode, itemState?.value, itemState?.state_code)
  return (
    <div className={`legacy-pill-set ${style.buttons.length === 3 ? 'three' : 'two'}`}>
      {style.buttons.map((button) => (
        <span key={button.key} className={`legacy-pill ${style.selected === button.key ? button.key : ''}`}>
          {button.label}
        </span>
      ))}
    </div>
  )
}

function LegacyOverlayStack({ detail, stateMap, config, state }) {
  const lastRecordInfo = getLastRecordInfo(state)
  const lastRecordLabel = lastRecordInfo.text
  const visibleAssets = (detail?.objects || [])
    .map((obj) => {
      const objectState = stateMap[obj.code]
      const style = resolveStateStyle(obj.state_mode, objectState?.value, objectState?.state_code)
      const asset = obj.overlay_assets?.[style.selected]
      return asset ? { code: obj.code, asset } : null
    })
    .filter(Boolean)

  return (
    <div className={`legacy-map-stage ${config.shell}`}>
      <img className="legacy-map-base" src={config.mapImage || detail?.map?.image_url} alt={config.title} />
      {visibleAssets.map((overlay) => (
        <img key={overlay.code} className="legacy-map-overlay" src={overlay.asset} alt={overlay.code} />
      ))}
      {config.logoOnMap && <img className="legacy-map-logo" src={config.logoOnMap} alt="logo" />}
      <div className={`legacy-last-record-chip ${lastRecordInfo.toneClass}`}>
        <strong>{config.connectionTitle || 'Último registro:'}</strong>
        <span>{lastRecordLabel}</span>
      </div>
    </div>
  )
}

export default function LegacySismicoPage({ siteCode }) {
  const config = siteVisualConfig[siteCode]
  const { detail, state, stateMap, loading, error, refresh, runManualPolling, runningPolling, accessDenied, licenseInfo } = useSismicoSite(siteCode)

  if (!config) {
    return <div className="page-screen"><div className="panel-card">Sitio no configurado.</div></div>
  }

  if (loading && !detail) {
    return <div className="page-screen"><div className="panel-card">Cargando {siteCode}…</div></div>
  }

  if (error && !detail) {
    return <div className="page-screen"><div className="panel-card">Error: {error}</div></div>
  }

  if (accessDenied) return <ScreenLicenseGate licenseInfo={licenseInfo} />

  return (
    <div className={`legacy-page-shell ${config.shell}`}>
      <div className="legacy-topbar">
        <div className="legacy-topbar-left">
          {(config.topButtons || ['Emergencia']).map((label) => {
            if (label === 'Volver al inicio' || label === 'Inicio') {
              return <Link key={label} to="/legacy-sismico" className="legacy-action-btn secondary">{label}</Link>
            }
            if (label === 'Refrescar') {
              return <button key={label} className="legacy-action-btn secondary" onClick={refresh}>{label}</button>
            }
            if (label === 'Guardar') {
              return <button key={label} className="legacy-action-btn cyan" onClick={runManualPolling}>{runningPolling ? 'Leyendo…' : label}</button>
            }
            return <button key={label} className="legacy-action-btn danger">{label}</button>
          })}
        </div>
        {config.shell === 'andes_norte' && (
          <div className="legacy-topbar-right">
            <span className="license-pill">Licencia expira en 12 mess 5 días</span>
            <img src="/assets/legacy/codelco.png" alt="Codelco" className="legacy-codelco" />
            <button className="legacy-action-btn secondary">Iniciar sesión</button>
          </div>
        )}
      </div>

      <div className={`legacy-grid ${config.shell}`}>
        <section className="legacy-card info-panel">
          {config.projectImage && (
            <div className="legacy-card mini-panel">
              <div className="legacy-card-title">{config.title}</div>
              <div className="legacy-project-image-wrap">
                <img src={config.projectImage} alt={config.title} className="legacy-project-image" />
              </div>
            </div>
          )}

          {config.groups.map((group) => (
            <div className="legacy-card list-panel" key={group.title}>
              <div className="legacy-card-title">{group.title}</div>
              <div className="legacy-state-list">
                {group.items.map((item) => {
                  const current = stateMap[item.code]
                  return (
                    <div className="legacy-state-row" key={item.code}>
                      <div className="legacy-state-name">
                        {item.label.split('\n').map((part) => <span key={part}>{part}</span>)}
                      </div>
                      <StatusPills mode={item.mode} itemState={current} />
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {config.shell === 'andesita' && (
            <div className="legacy-card connection-panel">
              <div className="legacy-card-title">{config.connectionTitle}</div>
              <div className={`legacy-connection-text ${state?.external_sources_online ? 'ok' : 'fail'}`}>
                [{new Date().toLocaleTimeString('es-CL')}] {state?.source_message || 'Sin novedad'}
              </div>
              <img src={config.footerLogo} alt="Telemining" className="legacy-footer-logo" />
            </div>
          )}

          {(config.shell === 'diamante' || config.shell === 'andes_norte' || config.shell === 'pilar_norte') && (
            <img src={config.footerLogo} alt="Telemining" className="legacy-footer-logo standalone" />
          )}
        </section>

        <section className="legacy-card map-panel">
          <div className="legacy-card-title">{config.mapTitle}</div>
          <LegacyOverlayStack detail={detail} stateMap={stateMap} config={config} state={state} />
        </section>
      </div>
    </div>
  )
}
