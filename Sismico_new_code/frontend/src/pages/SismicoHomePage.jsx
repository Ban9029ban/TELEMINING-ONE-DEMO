import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getSismicoSites, getEmergencyState, setEmergencyState } from '../services/sismicoApi'
import { useAuth } from '../context/AuthContext'
import { API_BASE_URL } from '../services/apiBase'
import { img } from '../config/assets'
import './DiamantePage.css'

const SITE_ORDER = ['diamante', 'andesita', 'andes_norte', 'andes_norte_tunel_correa', 'pilar_norte', 'esmeralda', 'det_np_andes_norte', 'det_ucl_andes_norte']

const SITE_META = {
  diamante: { name: 'DIAMANTE', image: img.diamanteCard, to: '/legacy-sismico/diamante' },
  andesita: { name: 'ANDESITA', image: img.andesitaCard, to: '/legacy-sismico/andesita' },
  andes_norte: { name: 'ANDES NORTE', image: img.andesNorteCard, to: '/legacy-sismico/andes-norte' },
  det_np_andes_norte: { name: 'DET NP ANDES NORTE', image: img.codelco, to: '/legacy-sismico/det-np-andes-norte' },
  det_ucl_andes_norte: { name: 'DET UCL ANDES NORTE', image: img.codelco, to: '/legacy-sismico/det-ucl-andes-norte' },
  andes_norte_tunel_correa: { name: 'ANDES NORTE TUNEL CORREA', image: img.tunelCorreaCard, to: '/legacy-sismico/andes-norte-tunel-correa' },
  pilar_norte: { name: 'PILAR NORTE', image: img.pilarNorteCard, to: '/legacy-sismico/pilar-norte' },
  esmeralda: { name: 'ESMERALDA', image: img.pilarNorteCard, to: '/legacy-sismico/esmeralda' },
}

function normalizeApiItems(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : []
  const byCode = new Map()
  for (const row of items) {
    const code = String(row?.code || row?.site_code || '').trim().toLowerCase().replace(/-/g, '_')
    if (!code) continue
    byCode.set(code, { code, status: row?.status || row?.source_status || row?.state || 'unknown', lastSyncAt: row?.last_sync_at || row?.lastSyncAt || null })
  }
  return byCode
}

export default function SismicoHomePage() {
  const { user, auth } = useAuth()
  const isAdmin = user?.role_code?.toLowerCase() === 'admin'
  const [allowed, setAllowed] = useState(null)
  const [accessError, setAccessError] = useState('')
  useEffect(() => {
    if (isAdmin || !user?.username) return
    let live = true
    setAllowed(null); setAccessError('')
    fetch(`${import.meta.env.VITE_VISUAL_API_ROOT || `${API_BASE_URL}/api`}/visual-layout/sala-sic/${encodeURIComponent(user.username)}`, { headers: { Authorization: `Bearer ${auth?.token || ''}` }, cache: 'no-store' })
      .then(response => { if (!response.ok) throw new Error('No se pudieron cargar los mapas permitidos.'); return response.json() })
      .then(layout => { if (live) setAllowed(layout?.sala?.projects || {}) })
      .catch(error => { if (live) setAccessError(error.message) })
    return () => { live = false }
  }, [isAdmin, user?.username, auth?.token])
  const [apiItems, setApiItems] = useState(new Map())
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [selection, setSelection] = useState([])
  const [emergencyState, setEmergency] = useState({ is_active: false, scope: 'global', site_codes: [] })
  const sirenRef = useRef(null)

  const load = async () => {
    const [sites, emergency] = await Promise.all([getSismicoSites(), getEmergencyState()])
    setApiItems(normalizeApiItems(sites))
    setEmergency(emergency)
  }

  useEffect(() => {
    let active = true
    const refresh = () => load()
      .then(() => { if (active) setLoadError('') })
      .catch((err) => { if (active) setLoadError(err?.message || 'No se pudo actualizar el panel sísmico.') })
    refresh()
    const timer = window.setInterval(refresh, 5000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])

  useEffect(() => {
    if (!sirenRef.current) return
    const audio = sirenRef.current
    const run = async () => {
      try {
        if (emergencyState?.is_active) {
          audio.pause(); audio.currentTime = 0; await audio.play()
        } else {
          audio.pause(); audio.currentTime = 0
        }
      } catch {}
    }
    run()
  }, [emergencyState])

  const cards = useMemo(() => SITE_ORDER.filter(code => isAdmin || (user?.username?.trim().toLowerCase() === 'sala_cic' && code === 'andes_norte_tunel_correa') || allowed?.[code]?.selected).map((code) => {
    const meta = SITE_META[code]
    const sourceCode = Object.prototype.hasOwnProperty.call(meta, 'sourceCode') ? meta.sourceCode : code
    const emergencyCode = meta.emergencyCode || sourceCode
    const api = apiItems.get(sourceCode)
    const isActive = Boolean(emergencyState?.is_active) && (emergencyState?.scope === 'global' || (emergencyState?.site_codes || []).includes(emergencyCode))
    const selectable = !meta.controlOnly
    return {
      code,
      sourceCode,
      emergencyCode,
      name: meta.name,
      image: meta.image,
      to: meta.to,
      status: meta.statusText || api?.status || 'unknown',
      lastSyncAt: api?.lastSyncAt || null,
      isActive,
      selected: selectable && selection.includes(code),
      selectable,
    }
  }), [apiItems, emergencyState, selection, isAdmin, allowed, user?.username])

  const toggleSelection = (code) => {
    setSelection((prev) => prev.includes(code) ? prev.filter((item) => item !== code) : [...prev, code])
  }

  const applyEmergency = async (scope, isActive, selectedCodes = []) => {
    const byCode = new Map(cards.map((item) => [item.code, item]))
    const siteCodes = Array.from(new Set(selectedCodes.map((code) => byCode.get(code)?.emergencyCode || code).filter(Boolean)))
    try {
      const response = await setEmergencyState({ is_active: isActive, scope, site_codes: siteCodes, siren_type: 'police' })
      setEmergency({ is_active: Boolean(response?.is_active), scope: response?.scope || scope, site_codes: Array.isArray(response?.site_codes) ? response.site_codes : siteCodes })
      setError('')
    } catch (err) {
      setError(err?.message || String(err))
    }
  }

  return (
    <div className="legacy-home-shell">
      <audio ref={sirenRef} src="/sounds/alert_siren.mp3" preload="auto" loop />
      {isAdmin && <div className="legacy-site-toolbar" style={{ marginBottom: 18, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="legacy-site-btn emergency" onClick={() => applyEmergency('global', !emergencyState.is_active || emergencyState.scope !== 'global', [])}>Emergencia general</button>
        <button className="legacy-site-btn emergency" disabled={!selection.length} onClick={() => applyEmergency('site_selection', true, selection)}>Activar seleccionadas</button>
        <button className="legacy-site-btn" disabled={!selection.length} onClick={() => applyEmergency('site_selection', false, selection)}>Quitar seleccionadas</button>
        <Link to="/legacy-sismico/sala-sic" style={{ textDecoration: 'none' }}><button className="legacy-site-btn">Sala SIC</button></Link>
      </div>}
      {accessError && <p role="alert">{accessError}</p>}
      {!isAdmin && !allowed && !accessError && <p role="status">Cargando mapas permitidos…</p>}
      {(error || loadError) ? <div className="legacy-home-error" role="alert">{error || loadError}</div> : null}
      <div className="legacy-home-grid sismico-home-grid">
        {cards.map((site) => (
          <div key={site.code} className="legacy-home-card sismico-home-card" style={{ position: 'relative' }}>
            {isAdmin && site.selectable ? <input type="checkbox" checked={site.selected} onChange={() => toggleSelection(site.code)} style={{ position: 'absolute', right: 10, top: 10, width: 18, height: 18, zIndex: 5 }} /> : null}
            <Link to={site.to} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="legacy-home-card-frame"><img className="legacy-home-card-image" src={site.image} alt={site.name} /></div>
              <div className="legacy-home-card-title">{site.name}</div>
              <div className="sismico-home-meta">Estado fuente: {site.status}</div>
              <div className="sismico-home-meta">Última sync: {site.lastSyncAt ? new Date(site.lastSyncAt).toLocaleString() : 'Sin datos'}</div>
              {site.isActive ? <div className="sismico-home-meta" style={{ color: '#d4553d', fontWeight: 700 }}>EN EMERGENCIA</div> : null}
            </Link>
          </div>
        ))}
        <div className="legacy-home-card sismico-home-card">
          <Link to="/legacy-sismico/sala-sic" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="legacy-home-card-frame"><div aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, width: '70%', height: '65%' }}>{[0,1,2,3].map(n => <span key={n} style={{ border: '3px solid #78829f', borderRadius: 12, background: '#dce8ee' }} />)}</div></div>
            <div className="legacy-home-card-title">VISTA SALA CIC</div>
            <div className="sismico-home-meta">Mapas permitidos en simultáneo</div>
          </Link>
        </div>
      </div>
    </div>
  )
}
