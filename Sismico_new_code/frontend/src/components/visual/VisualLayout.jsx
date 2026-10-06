import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { API_BASE_URL } from '../../services/apiBase'
import { defaultBoxes, fitBox, moveBox } from './layoutGeometry'
import './VisualLayout.css'

const Context = createContext(null)
const MAPS = new Set(['diamante', 'andesita', 'andes-norte', 'det-np-andes-norte', 'det-ucl-andes-norte', 'andes-norte-tunel-correa', 'pilar-norte', 'esmeralda', 'sala-sic'])
const EMPTY = { version: 1, boxes: {} }

export function VisualLayoutBoundary({ children }) {
  const location = useLocation()
  const code = location.pathname.split('/').filter(Boolean).pop()
  if (!location.pathname.startsWith('/legacy-sismico/') || !MAPS.has(code)) return children
  return <VisualLayoutProvider key={code} mapCode={code}>{children}</VisualLayoutProvider>
}

export function useVisualLayout() { return useContext(Context) }

export function VisualLayoutHeaderSlot() {
  const context = useContext(Context)
  return context ? <div className="visual-layout-header-slot" ref={context.setHeaderSlot} /> : null
}

function VisualLayoutProvider({ mapCode, children }) {
  const { auth } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const sicChild = new URLSearchParams(location.search).get('sic_lock') === '1'
  const wall = new URLSearchParams(location.search).has('pantalla')
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement))
  const [headerSlot, setHeaderSlot] = useState(null)
  const [headerBottom, setHeaderBottom] = useState(0)
  const [surface, setSurface] = useState(null)
  const [registry, setRegistry] = useState({})
  const [me, setMe] = useState(null)
  const [users, setUsers] = useState([])
  const [target, setTarget] = useState('')
  const [saved, setSaved] = useState(EMPTY)
  const [draft, setDraft] = useState(EMPTY)
  const [editing, setEditing] = useState(false)
  const [selectionDirty, setSelectionDirty] = useState(false)
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadedTarget, setLoadedTarget] = useState('')
  const [reload, setReload] = useState(0)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const ownLayout = useRef(EMPTY)
  const editingRef = useRef(false)
  editingRef.current = editing
  const api = useCallback(async (path, options = {}) => {
    const response = await fetch(`${import.meta.env.VITE_VISUAL_API_ROOT || `${API_BASE_URL}/api`}${path}`, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth?.token || ''}` }, cache: 'no-store' })
    const body = await response.json()
    if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'No se pudo guardar la distribución')
    return body
  }, [auth?.token])
  const register = useCallback((id, label) => {
    setRegistry(old => ({ ...old, [id]: label }))
    return () => setRegistry(old => { const next = { ...old }; delete next[id]; return next })
  }, [])
  useEffect(() => {
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => document.removeEventListener('fullscreenchange', onFullscreen)
  }, [])
  useEffect(() => {
    let live = true
    setMe(null); setTarget(''); setSaved(EMPTY); setDraft(EMPTY); setEditing(false); ownLayout.current = EMPTY
    if (auth?.token) api('/auth/me').then(async user => {
      if (!live) return
      setMe(user); setTarget(mapCode === 'sala-sic' && user.role_code?.toLowerCase() === 'admin' ? 'sala_cic' : user.username)
      const list = await api('/visual-layout/users')
      if (live) setUsers(list)
    }).catch(err => { if (live) setError(err.message) })
    return () => { live = false }
  }, [api, auth?.token])
  useEffect(() => {
    if (!target || !me) return undefined
    let live = true
    setLoading(true); setLoadedTarget(''); setError('')
    api(`/visual-layout/${mapCode}/${encodeURIComponent(target)}`).then(layout => {
      if (!live) return
      setSaved(layout); setDraft(layout); setLoadedTarget(target)
      if (target === me.username) ownLayout.current = layout
    }).catch(err => { if (live) setError(err.message) }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [api, target, me, mapCode, reload])
  useEffect(() => {
    if (!me || (target !== me.username && mapCode !== 'sala-sic') || editing) return undefined
    let live = true
    const timer = window.setInterval(() => {
      api(`/visual-layout/${mapCode}/${encodeURIComponent(me.username)}`).then(layout => {
        if (!live || editingRef.current) return
        ownLayout.current = layout; setSaved(layout); setDraft(layout)
      }).catch(() => {})
    }, 15000)
    return () => { live = false; window.clearInterval(timer) }
  }, [api, me, target, editing, mapCode])
  const defaults = useMemo(() => defaultBoxes(Object.keys(registry)), [registry])
  const boxes = editing ? { ...defaults, ...draft.boxes } : Object.keys(saved.boxes).length ? { ...defaults, ...saved.boxes } : saved.boxes
  const active = !sicChild && (fullscreen || wall || editing || mapCode === 'sala-sic') && Object.keys(boxes).length > 0 && Object.keys(registry).length > 0
  useLayoutEffect(() => {
    document.body.classList.toggle('has-visual-layout', active)
    return () => document.body.classList.remove('has-visual-layout')
  }, [active])
  useLayoutEffect(() => {
    const header = headerSlot?.closest('header')
    if (!header) return
    const measure = () => setHeaderBottom(header.getBoundingClientRect().bottom)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(header)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [headerSlot, active, editing])
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft)
  const patchBox = useCallback((id, change) => setDraft(old => ({ ...old, version: 1, boxes: { ...defaults, ...old.boxes, [id]: fitBox({ ...(old.boxes[id] || defaults[id]), ...change }) } })), [defaults])
  const startEditing = async () => {
    if (!me) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
      navigate('/login', { state: { from: location.pathname + location.search } }); return
    }
    setMessage(''); setSelected(Object.keys(registry)[0] || '')
    setDraft(saved); setEditing(true)
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.().catch(() => {})
  }
  const cancel = () => {
    setEditing(false); if (mapCode === 'sala-sic') { setDraft(saved) } else { setTarget(me.username); setSaved(ownLayout.current); setDraft(ownLayout.current) }; setError('')
  }
  const save = async () => {
    setBusy(true); setError('')
    try {
      const payload = { ...draft, version: 1, boxes }
      const result = await api(`/visual-layout/${mapCode}/${encodeURIComponent(target)}`, { method: 'PUT', body: JSON.stringify(payload) })
      if (target === me.username) ownLayout.current = result
      setMessage(`Vista guardada para ${users.find(u => u.username === target)?.full_name || target}`)
      setEditing(false); if (mapCode === 'sala-sic') { setSaved(result); setDraft(result) } else { setTarget(me.username); setSaved(ownLayout.current); setDraft(ownLayout.current) }
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const overlaySettings = (editing ? draft : saved).overlays || {}
  const patchOverlay = (id, patch) => setDraft(old => ({ ...old, overlays: { ...old.overlays, [id]: { visible: true, allowed: true, ...old.overlays?.[id], ...patch } } }))
  const selectedBox = boxes[selected]
  const controls = <div className={`visual-layout-controls ${editing ? 'is-editing' : ''}`} style={editing ? { top: headerBottom + 8 } : undefined}>

      {!editing ? <>
        <button type="button" onClick={startEditing} disabled={loading || selectionDirty} title={selectionDirty ? "Guarda primero la selección de Sala CIC" : undefined}>{me ? '⚙ Configurar vista' : '⚙ Iniciar sesión para configurar vista'}</button>
        {(fullscreen || wall) && <button type="button" onClick={async () => { if (document.fullscreenElement) await document.exitFullscreen(); if (wall) { const params = new URLSearchParams(location.search); params.delete('pantalla'); window.location.assign(`${location.pathname}?${params}`) } }}>Salir de pantalla completa</button>}
        {message && <span role="status">{message}</span>}
        {error && <span role="alert">{error}</span>}
      </> : <>
        <strong>Configurar vista · {mapCode.replaceAll('-', ' ')}</strong>
        <p>Mueve cada recuadro desde su barra y cambia su tamaño desde la esquina. Las medidas son porcentajes de área disponible.</p>
        {me?.role_code?.toLowerCase() === 'admin' ? <label>Vista de usuario<select value={target} disabled={busy || loading || dirty} onChange={e => { setTarget(e.target.value); setSelected('') }}>{users.map(u => <option key={u.username} value={u.username}>{u.full_name} ({u.username})</option>)}</select></label> : <span>{mapCode === 'sala-sic' ? `Vista de usuario · ${target}` : `Mi vista · ${me?.full_name}`}</span>}
        {dirty && me?.role_code?.toLowerCase() === 'admin' && <small>Guarda o cancela los ajustes antes de cambiar de usuario.</small>}
        <fieldset className="visual-overlay-settings" disabled={busy || loading}><legend>Elementos visibles</legend>
          {[['alert-map', 'Minimapa 3D'], ['remote-alerts', 'Alertas']].map(([id, label]) => {
            const setting = overlaySettings[id] || { visible: true, allowed: true }
            return <div key={id}>
              <label><input type="checkbox" checked={setting.allowed && setting.visible} disabled={!setting.allowed} onChange={e => patchOverlay(id, { visible: e.target.checked })} />Mostrar {label}</label>
              {me?.role_code?.toLowerCase() === 'admin' ? <label><input type="checkbox" checked={setting.allowed} onChange={e => patchOverlay(id, { allowed: e.target.checked, visible: e.target.checked && setting.visible })} />Permitir a este usuario ver {label}</label> : !setting.allowed && <small>No habilitado por el administrador</small>}
            </div>
          })}
        </fieldset>
        <label>Recuadro<select value={selected} onChange={e => setSelected(e.target.value)}><option value="">Seleccionar</option>{Object.entries(registry).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        {selectedBox && <div className="visual-layout-fields">{[['x','X'],['y','Y'],['width','Ancho'],['height','Alto']].map(([key,label]) => <label key={key}>{label} %<input type="number" min={key === 'x' || key === 'y' ? 0 : 3} max="100" step="0.5" value={Number(selectedBox[key].toFixed(2))} disabled={busy || loading} onChange={e => patchBox(selected, { [key]: Number(e.target.value) })} /></label>)}</div>}
        {error && <p role="alert">{error} <button type="button" disabled={busy || loading} onClick={() => setReload(v => v + 1)}>Reintentar carga</button></p>}
        {loading && <p role="status">Cargando vista…</p>}
        <div className="visual-layout-actions">
          <button type="button" disabled={busy || loading || loadedTarget !== target} onClick={save}>{busy ? 'Guardando…' : 'Guardar vista'}</button>
          <button type="button" disabled={busy} onClick={cancel}>Cancelar</button>
          <button type="button" disabled={busy || loading} onClick={() => setDraft({ ...draft, version: 1, boxes: defaults })}>Restablecer vista</button>
        </div>
      </>}
  </div>
  return <Context.Provider value={{ setSelectionDirty, overlaySettings, me, target, saved, loading, salaError: error, saveSala: async sala => {
      const result = await api(`/visual-layout/${mapCode}/${encodeURIComponent(target)}`, { method: 'PUT', body: JSON.stringify({ ...saved, sala }) })
      setSaved(result); setDraft(result)
    }, setHeaderSlot, register, active, surface, boxes, editing, selected, setSelected, patchBox, busy: busy || loading }}>
    {children}
    <div ref={setSurface} className={`visual-layout-surface ${active ? 'is-active' : ''}`} style={{ top: headerBottom }} aria-label="Distribución visual" />
    {!sicChild && (mapCode !== 'sala-sic' || me?.role_code?.toLowerCase() === 'admin') && (editing ? controls : headerSlot ? createPortal(controls, headerSlot) : controls)}
  </Context.Provider>
}

export function VisualBox({ id, label, children }) {
  const context = useContext(Context)
  const register = context?.register
  useEffect(() => register?.(id, label), [register, id, label])
  const overlay = context?.overlaySettings?.[id]
  const hidden = ['alert-map', 'remote-alerts'].includes(id) && context && (!context.me || context.loading || overlay?.allowed === false || overlay?.visible === false)
  const naturalRoot = useRef(null)
  const [host] = useState(() => document.createElement('div'))
  const placed = Boolean(context?.active && context?.boxes[id] && context?.surface)
  const [pageClass, setPageClass] = useState('')
  useLayoutEffect(() => {
    const page = naturalRoot.current?.closest('.legacy-site-page, .andesnorte-page, .pilarnorte-page, .esmeralda-page, .sic-page')
    if (page) setPageClass(page.className)
  }, [context?.active])
  useLayoutEffect(() => {
    const destination = placed ? context.surface : naturalRoot.current
    destination?.appendChild(host)
    host.style.display = 'contents'
    return () => host.remove()
  }, [host, placed, context?.surface, hidden])
  const gesture = useRef(null)
  const box = context?.boxes[id]
  const begin = (event, resize) => {
    if (context.busy) return
    event.preventDefault(); event.stopPropagation()
    context.setSelected(id)
    gesture.current = { x: event.clientX, y: event.clientY, box, resize, bounds: context.surface.getBoundingClientRect() }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const move = event => {
    if (!gesture.current) return
    const start = gesture.current
    context.patchBox(id, moveBox(start.box, (event.clientX - start.x) / start.bounds.width * 100, (event.clientY - start.y) / start.bounds.height * 100, start.resize))
  }
  const stop = () => { gesture.current = null }
  if (hidden) return null
  return <><div ref={naturalRoot} style={{ display: 'contents' }} />{createPortal(<div className={placed ? `visual-box ${context.editing ? 'is-editing' : ''} ${context.editing && context.selected === id ? 'is-selected' : ''}` : undefined} style={placed ? { left: `${box.x}%`, top: `${box.y}%`, width: `${box.width}%`, height: `${box.height}%` } : { display: 'contents' }} data-visual-box={placed ? id : undefined}>
    {placed && context.editing && <button type="button" className="visual-box-handle" onPointerDown={e => begin(e, false)} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} onClick={() => context.setSelected(id)}>{label} · Mover</button>}
    <div className={placed ? `visual-box-content ${pageClass}` : undefined} style={placed ? undefined : { display: 'contents' }} inert={placed && context.editing ? '' : undefined}>{children}</div>
    {placed && context.editing && <button type="button" aria-label={`Cambiar tamaño de ${label}`} className="visual-box-resize" onPointerDown={e => begin(e, true)} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}>↘</button>}
  </div>, host)}</>
}
