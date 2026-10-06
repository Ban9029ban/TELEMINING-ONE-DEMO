import { VisualBox, useVisualLayout } from '../components/visual/VisualLayout'
import React, { useEffect, useMemo, useState } from 'react'
import './SalaSicPage.css'

const PROJECTS = [
  { code: 'diamante', name: 'DIAMANTE', route: '/legacy-sismico/diamante' },
  { code: 'andesita', name: 'ANDESITA', route: '/legacy-sismico/andesita' },
  { code: 'andes_norte', name: 'ANDES NORTE', route: '/legacy-sismico/andes-norte' },
  { code: 'det_np_andes_norte', name: 'DET NP ANDES NORTE', route: '/legacy-sismico/det-np-andes-norte' },
  { code: 'det_ucl_andes_norte', name: 'DET UCL ANDES NORTE', route: '/legacy-sismico/det-ucl-andes-norte' },
  { code: 'pilar_norte', name: 'PILAR NORTE', route: '/legacy-sismico/pilar-norte' },
  { code: 'esmeralda', name: 'ESMERALDA', route: '/legacy-sismico/esmeralda' },
]

function initialViewState() {
  const out = {}
  for (const item of PROJECTS) {
    out[item.code] = {
      selected: false,
      mode: 'together',
      showPolygons: false,
      showMap: true,
    }
  }
  return out
}

function tileUrl(project, control) {
  const params = new URLSearchParams()
  params.set('pantalla', '1')
  params.set('embed', '1')
  params.set('sic_lock', '1')
  params.set('sic_left', control.showPolygons ? '1' : '0')
  params.set('sic_map', control.showMap ? '1' : '0')
  return `${project.route}?${params.toString()}`
}

export default function SalaSicPage() {
  const visual = useVisualLayout()
  const isAdmin = visual?.me?.role_code?.toLowerCase() === 'admin'
  const [showControls, setShowControls] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [density, setDensity] = useState('normal')
  const [viewState, setViewState] = useState({})

  useEffect(() => {
    if (dirty) return
    setViewState(visual?.saved?.sala?.projects || (isAdmin ? initialViewState() : {}))
    setDensity(visual?.saved?.sala?.density || 'normal')
  }, [visual?.saved, isAdmin, dirty])
  useEffect(() => { visual?.setSelectionDirty?.(dirty); return () => visual?.setSelectionDirty?.(false) }, [dirty, visual?.setSelectionDirty])
  const saveSelection = async () => {
    setSaving(true); setNotice('')
    try {
      await visual.saveSala({ projects: viewState, density })
      setDirty(false); setNotice(`Vista guardada para ${visual.target}`)
    } catch (error) { setNotice(error.message) } finally { setSaving(false) }
  }
  const toggleFullscreen = async () => {
    const root = document.documentElement
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined)
      return
    }
    if (root?.requestFullscreen) {
      await root.requestFullscreen().catch(() => undefined)
    }
  }

  const applyPreset = (preset) => {
    setDirty(true)
    setViewState(() => {
      const out = {}
      for (const project of PROJECTS) {
        const base = { selected: true, mode: 'together', showPolygons: false, showMap: true }
        if (preset === 'all-both') {
          out[project.code] = { ...base, showPolygons: true, showMap: true }
        } else if (preset === 'all-plans') {
          out[project.code] = { ...base, showPolygons: false, showMap: true }
        } else if (preset === 'all-polygons') {
          out[project.code] = { ...base, showPolygons: true, showMap: false }
        } else {
          out[project.code] = { ...base }
        }
      }
      return out
    })
  }

  const tiles = useMemo(() => {
    const out = []
    for (const project of PROJECTS) {
      const control = viewState[project.code]
      if (!control?.selected) continue

      if (control.mode === 'separate') {
        if (control.showPolygons) {
          out.push({ id: `${project.code}-poly`, title: `${project.name} · Poligonos`, url: tileUrl(project, { ...control, showMap: false, showPolygons: true }) })
        }
        if (control.showMap) {
          out.push({ id: `${project.code}-map`, title: `${project.name} · Plano`, url: tileUrl(project, { ...control, showMap: true, showPolygons: false }) })
        }
      } else if (control.showPolygons || control.showMap) {
        out.push({ id: `${project.code}-both`, title: project.name, url: tileUrl(project, control) })
      }
    }
    return out
  }, [viewState])

  const setProjectState = (projectCode, patch) => {
    setDirty(true)
    setViewState((prev) => ({
      ...prev,
      [projectCode]: {
        ...prev[projectCode],
        ...patch,
      },
    }))
  }

  if (!visual?.me || visual?.loading) return <p>Cargando vista de Sala CIC…</p>

  return (
    <div className={`sic-page density-${density}`}>
      {isAdmin && <VisualBox id="actions" label="Controles de Sala SIC"><div className="sic-controls-toggle-row">
        <div className="sic-top-actions-left">
          <button type="button" className={`sic-toggle-btn density-btn ${density === 'compact' ? 'active' : ''}`} onClick={() => { setDensity('compact'); setDirty(true) }}>Compacto</button>
          <button type="button" className={`sic-toggle-btn density-btn ${density === 'normal' ? 'active' : ''}`} onClick={() => { setDensity('normal'); setDirty(true) }}>Normal</button>
          <button type="button" className={`sic-toggle-btn density-btn ${density === 'large' ? 'active' : ''}`} onClick={() => { setDensity('large'); setDirty(true) }}>Grande</button>
          <button type="button" className="sic-toggle-btn" onClick={toggleFullscreen}>Pantalla completa</button>
        </div>
        <button type="button" className="sic-toggle-btn" onClick={() => setShowControls((prev) => !prev)}>
          {showControls ? 'Ocultar configuracion Sala SIC' : 'Mostrar configuracion Sala SIC'}
        </button>
      </div></VisualBox>}

      {isAdmin && showControls ? (
        <VisualBox id="sic-settings" label="Selección de proyectos"><div className="sic-controls-card">
          <div className="sic-controls-title">Vista de {visual?.target || 'Sala CIC'}</div>
          <button type="button" className="sic-preset-btn" disabled={saving || visual?.loading || visual?.editing || Boolean(visual?.salaError)} onClick={saveSelection}>{saving ? 'Guardando…' : 'Guardar selección para usuario'}</button>
          {notice && <p role="status">{notice}</p>}
          <div className="sic-controls-subtitle">Selector para pantalla de control. Puede ocultar y mostrar este bloque cuando lo necesite.</div>
          <div className="sic-preset-row">
            <button type="button" className="sic-preset-btn" onClick={() => applyPreset('all-plans')}>Preset: Solo planos</button>
            <button type="button" className="sic-preset-btn" onClick={() => applyPreset('all-both')}>Preset: Planos + poligonos</button>
            <button type="button" className="sic-preset-btn" onClick={() => applyPreset('all-polygons')}>Preset: Solo poligonos</button>
          </div>
          <div className="sic-project-grid">
            {PROJECTS.map((project) => {
              const control = viewState[project.code]
              return (
                <div key={project.code} className="sic-project-item">
                  <label className="sic-check">
                    <input
                      type="checkbox"
                      checked={Boolean(control?.selected)}
                      onChange={(e) => setProjectState(project.code, { selected: e.target.checked })}
                    />
                    <span>{project.name}</span>
                  </label>

                  <div className="sic-project-options">
                    <label className="sic-check compact">
                      <input
                        type="checkbox"
                        checked={Boolean(control?.showPolygons)}
                        onChange={(e) => setProjectState(project.code, { showPolygons: e.target.checked })}
                        disabled={!control?.selected}
                      />
                      <span>Poligonos</span>
                    </label>
                    <label className="sic-check compact">
                      <input
                        type="checkbox"
                        checked={Boolean(control?.showMap)}
                        onChange={(e) => setProjectState(project.code, { showMap: e.target.checked })}
                        disabled={!control?.selected}
                      />
                      <span>Plano</span>
                    </label>
                    <select
                      value={control?.mode || 'together'}
                      onChange={(e) => setProjectState(project.code, { mode: e.target.value })}
                      disabled={!control?.selected}
                    >
                      <option value="together">Juntos</option>
                      <option value="separate">Separado</option>
                    </select>
                  </div>
                </div>
              )
            })}
          </div>
        </div></VisualBox>
      ) : null}

      <div className="sic-stage-grid">
        {tiles.length ? tiles.map((tile) => (
          <VisualBox key={tile.id} id={tile.id} label={tile.title}><div className="sic-stage-cell">
            <div className="sic-stage-title">{tile.title}</div>
            <iframe title={tile.title} src={tile.url} className="sic-frame" />
          </div></VisualBox>
        )) : <div className="sic-empty">No hay mapas asignados. El administrador debe guardar la vista de Sala CIC.</div>}
      </div>
    </div>
  )
}
