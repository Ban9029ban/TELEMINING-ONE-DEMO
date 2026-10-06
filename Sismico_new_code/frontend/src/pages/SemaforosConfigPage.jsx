import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './SemaforosConfigPage.css'
import {
  createConfigCompany,
  createConfigExternalSource,
  createConfigScreen,
  createConfigSemaforo,
  createConfigUser,
  executeSemaforos,
  getConfigCompanies,
  getConfigExternalSources,
  getConfigSemaforos,
  getConfigSystem,
  getConfigUsers,
  getMapPolygons,
  getPolygonSites,
  getScreens,
  updateConfigCompany,
  updateConfigExternalSource,
  updateConfigScreen,
  updateConfigSemaforo,
  updateConfigSystem,
  updateConfigUser,
  updateMapPolygon,
} from '../services/sismicoApi'

const TAB_KEYS = {
  users: 'users',
  companies: 'companies',
  semaforos: 'semaforos',
  system: 'system',
  sources: 'sources',
  screens: 'screens',
  polygons: 'polygons',
}

const TABS = [
  { key: TAB_KEYS.users, label: 'Usuarios' },
  { key: TAB_KEYS.companies, label: 'Empresas' },
  { key: TAB_KEYS.semaforos, label: 'Semáforos' },
  { key: TAB_KEYS.system, label: 'Configuración' },
  { key: TAB_KEYS.sources, label: 'Fuentes externas' },
  { key: TAB_KEYS.screens, label: 'Pantallas' },
  { key: TAB_KEYS.polygons, label: 'Polígonos' },
]

const EMPTY_MODAL = { open: false, mode: 'create', tab: '', item: null }

const SIGNAL_OPTIONS = [''].concat(Array.from({ length: 11 }, (_, i) => `M${i}`)).concat(['BALIZA'])

const LICENSE_OPTIONS = [
  { value: 'no_license', label: 'Sin licencia' },
  { value: 'daily', label: 'Diaria (1 día)' },
  { value: '90_days', label: '90 días' },
  { value: '180_days', label: '180 días' },
  { value: '360_days', label: '360 días' },
  { value: 'unlimited', label: 'Ilimitada' },
]

function licenseLabel(value) {
  return LICENSE_OPTIONS.find((item) => item.value === value)?.label || value || '-'
}

function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('es-CL')
}

function statusPillClass(value) {
  const normalized = String(value || '').toLowerCase()
  if (['online', 'activo', 'ok', 'conectada'].includes(normalized)) return 'ok'
  if (['offline', 'inactivo', 'error', 'desconectada'].includes(normalized)) return 'danger'
  return 'muted'
}

function normalizeList(value) {
  if (Array.isArray(value)) return value
  if (value?.items && Array.isArray(value.items)) return value.items
  return []
}

function Modal({ title, children, onClose, onSave, saving }) {
  return (
    <div className="config-modal-backdrop" onClick={onClose}>
      <div className="config-modal" onClick={(e) => e.stopPropagation()}>
        <div className="config-modal-header">
          <h4>{title}</h4>
          <button className="mini-btn" onClick={onClose}>Cerrar</button>
        </div>
        <div className="config-modal-body">{children}</div>
        <div className="config-modal-actions">
          <button className="pill-btn" onClick={onClose}>Cancelar</button>
          <button className="pill-btn primary" onClick={onSave} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  )
}

export default function SemaforosConfigPage() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState(TAB_KEYS.users)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [users, setUsers] = useState([])
  const [companies, setCompanies] = useState([])
  const [semaforos, setSemaforos] = useState([])
  const [sources, setSources] = useState([])
  const [screens, setScreens] = useState([])
  const [polygonSites, setPolygonSites] = useState([])
  const [polygons, setPolygons] = useState([])
  const [selectedSiteCode, setSelectedSiteCode] = useState('')
  const [selectedMapCode, setSelectedMapCode] = useState('')
  const [selectedPolygonId, setSelectedPolygonId] = useState(null)
  const [systemConfig, setSystemConfig] = useState({
    automatic_activation_seconds: 30,
    traffic_lights_enabled: true,
    semaforo_automation_enabled: false,
    external_sources_enabled: false,
  })
  const [modal, setModal] = useState(EMPTY_MODAL)
  const [formData, setFormData] = useState({})

  const loadAll = async () => {
    setLoading(true)
    setMessage('')
    const results = await Promise.allSettled([
      getConfigUsers(),
      getConfigCompanies(),
      getConfigSemaforos(),
      getConfigSystem(),
      getConfigExternalSources(),
      getScreens(),
      getPolygonSites(),
    ])

    const [u, c, s, sys, src, scr, polySites] = results

    const errors = results
      .filter((item) => item.status === 'rejected')
      .map((item) => item.reason?.message || 'Error desconocido')

    if (u.status === 'fulfilled') setUsers(normalizeList(u.value))
    if (c.status === 'fulfilled') setCompanies(normalizeList(c.value))
    if (s.status === 'fulfilled') setSemaforos(normalizeList(s.value))
    if (sys.status === 'fulfilled') {
      setSystemConfig({
        automatic_activation_seconds: Number(sys.value?.automatic_activation_seconds ?? 30),
        traffic_lights_enabled: Boolean(sys.value?.traffic_lights_enabled),
        semaforo_automation_enabled: Boolean(sys.value?.semaforo_automation_enabled),
        external_sources_enabled: Boolean(sys.value?.external_sources_enabled),
      })
    }
    if (src.status === 'fulfilled') setSources(normalizeList(src.value))
    if (scr.status === 'fulfilled') setScreens(normalizeList(scr.value))
    if (polySites.status === 'fulfilled') {
      const sites = normalizeList(polySites.value)
      setPolygonSites(sites)
      if (sites.length && !selectedSiteCode) {
        setSelectedSiteCode(sites[0].site_code)
        setSelectedMapCode(sites[0].maps?.[0]?.map_code || '')
      }
    }

    if (errors.length) {
      setMessage(`Algunas secciones no cargaron correctamente: ${errors.join(' | ')}`)
    }
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [])

  useEffect(() => {
    if (!selectedSiteCode || !selectedMapCode) return
    getMapPolygons(selectedSiteCode, selectedMapCode)
      .then((data) => {
        const list = normalizeList(data)
        setPolygons(list)
        setSelectedPolygonId((prev) => prev ?? list[0]?.map_object_id ?? null)
      })
      .catch((error) => {
        setMessage(error.message || 'No fue posible cargar polígonos.')
        setPolygons([])
      })
  }, [selectedSiteCode, selectedMapCode])

  const availableMaps = useMemo(() => polygonSites.find((site) => site.site_code === selectedSiteCode)?.maps || [], [polygonSites, selectedSiteCode])
  const selectedPolygon = useMemo(() => polygons.find((item) => item.map_object_id === selectedPolygonId) || null, [polygons, selectedPolygonId])

  const openModal = (tab, mode, item = null) => {
    setModal({ open: true, tab, mode, item })
    if (tab === TAB_KEYS.users) {
      setFormData(item ? { ...item } : { username: '', name: '', email: '', role: 'viewer', is_active: true })
    } else if (tab === TAB_KEYS.companies) {
      setFormData(item ? { ...item } : { code: '', name: '', is_active: true })
    } else if (tab === TAB_KEYS.semaforos) {
      setFormData(item ? { ...item } : { code: '', name: '', ip: '', hmi_ip: '', field_ip: '', test_ip: '', plane_code: polygonSites[0]?.maps?.[0]?.map_code || '', polygon_code: '', normal_tag: '', alert_tag: '', inferior_tag: '', centro_tag: '', superior_tag: '', emergency_tag: '', baliza_tag: '', site_code: polygonSites[0]?.site_code?.replace(/-/g, '_') || 'diamante', plc_type: 'delta', profile: 'delta', port: 502, unit_id: 1, enabled: true })
    } else if (tab === TAB_KEYS.sources) {
      setFormData(item ? { ...item } : { code: '', name: '', type: 'api_rest', endpoint: '', is_active: true })
    } else if (tab === TAB_KEYS.screens) {
      setFormData(item ? { ...item } : { code: '', name: '', device_label: '', device_name: '', device_fingerprint: '', user_agent: '', url: '', status: 'offline', screen_number: '', site_code: polygonSites[0]?.site_code?.replace(/-/g, '_') || 'diamante', is_active: true, client_ip: '', mac_address: '', authorized_mac: '', enforce_mac_lock: false, license_plan: 'unlimited', license_days: '', notes: '' })
    }
  }

  const closeModal = () => {
    setModal(EMPTY_MODAL)
    setFormData({})
  }

  const handleSaveModal = async () => {
    setSaving(true)
    setMessage('')
    try {
      if (modal.tab === TAB_KEYS.users) {
        modal.mode === 'create' ? await createConfigUser(formData) : await updateConfigUser(modal.item.id, formData)
      } else if (modal.tab === TAB_KEYS.companies) {
        modal.mode === 'create' ? await createConfigCompany(formData) : await updateConfigCompany(modal.item.id, formData)
      } else if (modal.tab === TAB_KEYS.semaforos) {
        modal.mode === 'create' ? await createConfigSemaforo(formData) : await updateConfigSemaforo(modal.item.id, formData)
      } else if (modal.tab === TAB_KEYS.sources) {
        modal.mode === 'create' ? await createConfigExternalSource(formData) : await updateConfigExternalSource(modal.item.id, formData)
      } else if (modal.tab === TAB_KEYS.screens) {
        modal.mode === 'create' ? await createConfigScreen(formData) : await updateConfigScreen(modal.item.id, formData)
      }
      closeModal()
      await loadAll()
      setMessage('Registro guardado correctamente.')
    } catch (error) {
      setMessage(error.message || 'No fue posible guardar el registro.')
    } finally {
      setSaving(false)
    }
  }

  const updateSelectedPolygonField = (key, value) => {
    setPolygons((prev) => prev.map((item) => item.map_object_id === selectedPolygonId ? { ...item, [key]: value } : item))
  }

  const updateSelectedPolygonOption = (index, key, value) => {
    setPolygons((prev) => prev.map((item) => {
      if (item.map_object_id !== selectedPolygonId) return item
      const options = [...(item.options || [])]
      options[index] = { ...options[index], [key]: value }
      return { ...item, options }
    }))
  }

  const saveSystemConfig = async () => {
    setSaving(true)
    setMessage('')
    try {
      const next = await updateConfigSystem(systemConfig)
      setSystemConfig(next)
      setMessage('Configuración general guardada correctamente.')
    } catch (error) {
      setMessage(error.message || 'No fue posible guardar la configuración general.')
    } finally {
      setSaving(false)
    }
  }

  const savePolygonConfig = async () => {
    if (!selectedPolygon) return
    setSaving(true)
    setMessage('')
    try {
      await updateMapPolygon(selectedSiteCode, selectedMapCode, selectedPolygon.map_object_id, {
        control_mode: selectedPolygon.control_mode,
        manual_enabled: selectedPolygon.manual_enabled,
        automatic_enabled: selectedPolygon.automatic_enabled,
        state_set_code: selectedPolygon.state_set_code,
        is_active: selectedPolygon.is_active,
        options: selectedPolygon.options || [],
      })
      setMessage('Polígono guardado correctamente.')
    } catch (error) {
      setMessage(error.message || 'No fue posible guardar el polígono.')
    } finally {
      setSaving(false)
    }
  }

  const fireSemaforo = async (item, action) => {
    try {
      const result = await executeSemaforos({ device_code: item.device_code || item.code, site_code: item.site_code, action })
      setMessage(`Semáforo ${(item.name || item.device_name || item.code)} -> ${result.ok ? 'OK' : 'ERROR'}`)
    } catch (error) {
      setMessage(error.message || 'No fue posible ejecutar el comando del semáforo.')
    }
  }

  const renderModalForm = () => {
    const setValue = (key, value) => setFormData((prev) => ({ ...prev, [key]: value }))
    const formSite = polygonSites.find((site) => site.site_code.replace(/-/g, '_') === (formData.site_code || '')) || polygonSites[0] || null
    const formMaps = formSite?.maps || []
    const selectedPlaneCode = formData.plane_code || formMaps[0]?.map_code || ''
    const polygonOptions = polygons.filter((item) => item.map_code === selectedPlaneCode || !item.map_code)
    const signalSelect = (field, label) => <label className="config-field"><span>{label}</span><select value={formData[field] || ''} onChange={(e) => setValue(field, e.target.value)}>{SIGNAL_OPTIONS.map((opt) => <option key={`${field}-${opt || 'none'}`} value={opt}>{opt || 'Sin señal'}</option>)}</select></label>
    switch (modal.tab) {
      case TAB_KEYS.users:
        return <div className="config-form-grid">
          <label className="config-field"><span>Usuario</span><input value={formData.username || ''} onChange={(e) => setValue('username', e.target.value)} /></label>
          <label className="config-field"><span>Nombre</span><input value={formData.name || ''} onChange={(e) => setValue('name', e.target.value)} /></label>
          <label className="config-field"><span>Correo</span><input value={formData.email || ''} onChange={(e) => setValue('email', e.target.value)} /></label>
          <label className="config-field"><span>Rol</span><select value={formData.role || 'viewer'} onChange={(e) => setValue('role', e.target.value)}><option value="admin">admin</option><option value="viewer">viewer</option><option value="operator">operator</option></select></label>
          <label className="config-field check"><input type="checkbox" checked={Boolean(formData.is_active)} onChange={(e) => setValue('is_active', e.target.checked)} /><span>Activo</span></label>
        </div>
      case TAB_KEYS.companies:
        return <div className="config-form-grid">
          <label className="config-field"><span>Código</span><input value={formData.code || ''} onChange={(e) => setValue('code', e.target.value)} /></label>
          <label className="config-field"><span>Nombre</span><input value={formData.name || ''} onChange={(e) => setValue('name', e.target.value)} /></label>
          <label className="config-field check"><input type="checkbox" checked={Boolean(formData.is_active)} onChange={(e) => setValue('is_active', e.target.checked)} /><span>Activa</span></label>
        </div>
      case TAB_KEYS.semaforos:
        return <div className="config-form-grid">
          <label className="config-field"><span>Nombre</span><input value={formData.name || ''} onChange={(e) => setValue('name', e.target.value)} /></label>
          <label className="config-field"><span>Código</span><input value={formData.code || ''} onChange={(e) => setValue('code', e.target.value)} /></label>
          <label className="config-field"><span>IP activa</span><input value={formData.ip || ''} onChange={(e) => setValue('ip', e.target.value)} /></label>
          <label className="config-field"><span>IP HMI</span><input value={formData.hmi_ip || ''} onChange={(e) => setValue('hmi_ip', e.target.value)} /></label>
          <label className="config-field"><span>IP terreno</span><input value={formData.field_ip || ''} onChange={(e) => setValue('field_ip', e.target.value)} /></label>
          <label className="config-field"><span>IP prueba</span><input value={formData.test_ip || ''} onChange={(e) => setValue('test_ip', e.target.value)} /></label>
          <label className="config-field"><span>Sitio</span><select value={formData.site_code || ''} onChange={(e) => setValue('site_code', e.target.value)}>{polygonSites.map((site) => <option key={site.site_code} value={site.site_code.replace(/-/g, '_')}>{site.site_name}</option>)}</select></label>
          <label className="config-field"><span>Plano</span><select value={selectedPlaneCode} onChange={(e) => setValue('plane_code', e.target.value)}>{formMaps.map((map) => <option key={map.map_code} value={map.map_code}>{map.map_name}</option>)}</select></label>
          <label className="config-field"><span>Polígono</span><select value={formData.polygon_code || ''} onChange={(e) => setValue('polygon_code', e.target.value)}><option value="">Seleccione</option>{polygonOptions.map((item) => <option key={item.map_object_id} value={item.polygon_code || item.object_code || item.code}>{item.polygon_name}</option>)}</select></label>
          <label className="config-field"><span>Puerto</span><input type="number" value={formData.port || 502} onChange={(e) => setValue('port', e.target.value)} /></label>
          <label className="config-field"><span>Unit ID</span><input type="number" value={formData.unit_id || 1} onChange={(e) => setValue('unit_id', e.target.value)} /></label>
          {signalSelect('normal_tag', 'Señal NORMAL')}
          {signalSelect('alert_tag', 'Señal ALERTA')}
          {signalSelect('inferior_tag', 'Señal INFERIOR')}
          {signalSelect('centro_tag', 'Señal CENTRO')}
          {signalSelect('superior_tag', 'Señal SUPERIOR')}
          {signalSelect('emergency_tag', 'Señal EMERGENCIA')}
          {signalSelect('baliza_tag', 'Señal BALIZA')}
          <label className="config-field check"><input type="checkbox" checked={Boolean(formData.enabled)} onChange={(e) => setValue('enabled', e.target.checked)} /><span>Habilitado</span></label>
        </div>
      case TAB_KEYS.sources:
        return <div className="config-form-grid">
          <label className="config-field"><span>Nombre</span><input value={formData.name || ''} onChange={(e) => setValue('name', e.target.value)} /></label>
          <label className="config-field"><span>Código</span><input value={formData.code || ''} onChange={(e) => setValue('code', e.target.value)} /></label>
          <label className="config-field"><span>Tipo</span><input value={formData.type || ''} onChange={(e) => setValue('type', e.target.value)} /></label>
          <label className="config-field"><span>Endpoint</span><input value={formData.endpoint || ''} onChange={(e) => setValue('endpoint', e.target.value)} /></label>
          <label className="config-field check"><input type="checkbox" checked={Boolean(formData.is_active)} onChange={(e) => setValue('is_active', e.target.checked)} /><span>Activa</span></label>
        </div>
      case TAB_KEYS.screens:
        return <div className="config-form-grid">
          <label className="config-field"><span>Nombre</span><input value={formData.name || ''} onChange={(e) => setValue('name', e.target.value)} /></label>
          <label className="config-field"><span>Ubicación / etiqueta</span><input value={formData.device_label || ''} onChange={(e) => setValue('device_label', e.target.value)} placeholder="Ej: Sala CIC muro principal" /></label>
          <label className="config-field"><span>Nombre equipo</span><input value={formData.device_name || ''} onChange={(e) => setValue('device_name', e.target.value)} placeholder="Ej: PC-SALA-CIC-01" /></label>
          <label className="config-field"><span>Código</span><input value={formData.code || ''} onChange={(e) => setValue('code', e.target.value)} /></label>
          <label className="config-field"><span>Número</span><input type="number" value={formData.screen_number || ''} onChange={(e) => setValue('screen_number', e.target.value)} /></label>
          <label className="config-field"><span>URL</span><input value={formData.url || ''} onChange={(e) => setValue('url', e.target.value)} /></label>
          <label className="config-field"><span>Sitio</span><select value={formData.site_code || ''} onChange={(e) => setValue('site_code', e.target.value)}>{polygonSites.map((site) => <option key={site.site_code} value={site.site_code.replace(/-/g, '_')}>{site.site_name}</option>)}</select></label>
          <label className="config-field"><span>IP cliente detectada</span><input value={formData.client_ip || ''} onChange={(e) => setValue('client_ip', e.target.value)} placeholder="Detectada por heartbeat" /></label>
          <label className="config-field"><span>MAC detectada</span><input value={formData.mac_address || ''} onChange={(e) => setValue('mac_address', e.target.value)} placeholder="Detectada por ARP" /></label>
          <label className="config-field"><span>MAC autorizada</span><input value={formData.authorized_mac || ''} onChange={(e) => setValue('authorized_mac', e.target.value)} placeholder="aa:bb:cc:dd:ee:ff" /></label>
          <label className="config-field"><span>Fingerprint</span><input value={formData.device_fingerprint || ''} onChange={(e) => setValue('device_fingerprint', e.target.value)} placeholder="userAgent|plataforma|resolución|zona horaria" /></label>
          <label className="config-field"><span>User agent</span><input value={formData.user_agent || ''} onChange={(e) => setValue('user_agent', e.target.value)} placeholder="Detectado automáticamente" /></label>
          <label className="config-field"><span>Licencia</span><select value={formData.license_plan || 'unlimited'} onChange={(e) => setValue('license_plan', e.target.value)}>{LICENSE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></label>
          {['daily', '90_days', '180_days', '360_days'].includes(formData.license_plan || '') ? (
            <label className="config-field"><span>Días licencia</span><input type="number" min="1" value={formData.license_days || ''} onChange={(e) => setValue('license_days', e.target.value ? Number(e.target.value) : '')} /></label>
          ) : null}
          <label className="config-field check"><input type="checkbox" checked={Boolean(formData.enforce_mac_lock ?? false)} onChange={(e) => setValue('enforce_mac_lock', e.target.checked)} /><span>Bloquear por MAC autorizada</span></label>
          <label className="config-field check"><input type="checkbox" checked={Boolean(formData.is_active ?? true)} onChange={(e) => setValue('is_active', e.target.checked)} /><span>Pantalla habilitada</span></label>
          <label className="config-field full-row"><span>Notas</span><textarea value={formData.notes || ''} onChange={(e) => setValue('notes', e.target.value)} rows={3} /></label>
        </div>
      default:
        return null
    }
  }

  return (
    <div className="page-screen">
      <div className="panel-card full-panel config-admin-panel">
        <div className="config-header-row">
          <div>
            <h3>Configuración</h3>
            <p>Usuarios, empresas, semáforos, fuentes externas, pantallas y polígonos por mapa.</p>
          </div>
          <div className="config-header-actions">
            <button className="pill-btn" onClick={() => navigate('/legacy-sismico/diagnostico')}>Diagnóstico sísmico</button>
            <button className="pill-btn" onClick={loadAll}>Recargar</button>
          </div>
        </div>
        <div className="config-tabs-row">
          {TABS.map((tab) => (
            <button key={tab.key} type="button" className={`config-tab-btn ${activeTab === tab.key ? 'active' : ''}`} onClick={() => setActiveTab(tab.key)}>{tab.label}</button>
          ))}
        </div>
        {message && <div className="config-message">{message}</div>}
        {loading ? <p>Cargando configuración…</p> : (<>
          {activeTab === TAB_KEYS.users && <div className="config-tab-panel"><div className="config-section-head"><div className="config-section-title">Usuarios</div><button className="pill-btn" onClick={() => openModal(TAB_KEYS.users, 'create')}>Agregar nuevo</button></div><div className="table-wrap"><table className="tm-table"><thead><tr><th>Nombre</th><th>Usuario</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Editar</th></tr></thead><tbody>{users.length ? users.map((item, idx) => <tr key={item.id || idx}><td>{item.name || '-'}</td><td>{item.username || '-'}</td><td>{item.email || '-'}</td><td>{item.role || '-'}</td><td><span className={`status-pill ${statusPillClass(item.is_active ? 'activo' : 'inactivo')}`}>{item.is_active ? 'activo' : 'inactivo'}</span></td><td><button className="mini-btn" onClick={() => openModal(TAB_KEYS.users, 'edit', item)}>Editar</button></td></tr>) : <tr><td colSpan="6">No hay usuarios registrados.</td></tr>}</tbody></table></div></div>}

          {activeTab === TAB_KEYS.companies && <div className="config-tab-panel"><div className="config-section-head"><div className="config-section-title">Empresas</div><button className="pill-btn" onClick={() => openModal(TAB_KEYS.companies, 'create')}>Agregar nuevo</button></div><div className="table-wrap"><table className="tm-table"><thead><tr><th>Empresa</th><th>Código</th><th>Estado</th><th>Editar</th></tr></thead><tbody>{companies.length ? companies.map((item, idx) => <tr key={item.id || idx}><td>{item.name || '-'}</td><td>{item.code || '-'}</td><td><span className={`status-pill ${statusPillClass(item.is_active ? 'activo' : 'inactivo')}`}>{item.is_active ? 'activo' : 'inactivo'}</span></td><td><button className="mini-btn" onClick={() => openModal(TAB_KEYS.companies, 'edit', item)}>Editar</button></td></tr>) : <tr><td colSpan="4">No hay empresas registradas.</td></tr>}</tbody></table></div></div>}

          {activeTab === TAB_KEYS.semaforos && <div className="config-tab-panel"><div className="config-section-head"><div className="config-section-title">Semáforos</div><button className="pill-btn" onClick={() => openModal(TAB_KEYS.semaforos, 'create')}>Agregar nuevo</button></div><div className="table-wrap"><table className="tm-table"><thead><tr><th>Nombre</th><th>IP activa</th><th>IP terreno</th><th>IP prueba</th><th>Plano</th><th>Polígono</th><th>Señales</th><th>Estado</th><th>Acciones</th><th>Editar</th></tr></thead><tbody>{semaforos.length ? semaforos.map((item, idx) => <tr key={item.id || idx}><td>{item.name || item.device_name || '-'}</td><td>{item.ip || '-'}</td><td>{item.field_ip || '-'}</td><td>{item.test_ip || '-'}</td><td>{item.plane_code || item.site_name || item.map_name || '-'}</td><td>{item.polygon_code || item.polygon_button || item.code || '-'}</td><td style={{ whiteSpace: 'pre-line' }}>{item.signals_summary || '-'}</td><td><span className={`status-pill ${statusPillClass(item.status || (item.enabled ? 'online' : 'offline'))}`}>{item.status || (item.enabled ? 'online' : 'offline')}</span></td><td><div className="config-action-stack horizontal"><button className="mini-btn danger" onClick={() => fireSemaforo(item, 'rojo')}>Rojo</button><button className="mini-btn ok" onClick={() => fireSemaforo(item, 'verde')}>Verde</button></div></td><td><button className="mini-btn" onClick={() => openModal(TAB_KEYS.semaforos, 'edit', item)}>Editar</button></td></tr>) : <tr><td colSpan="10">No hay semáforos registrados.</td></tr>}</tbody></table></div></div>}

          {activeTab === TAB_KEYS.system && <div className="config-tab-panel"><div className="config-section-title">Configuración general</div><div className="config-form-grid"><label className="config-field"><span>Tiempo activación automática (seg)</span><input type="number" min="1" value={systemConfig.automatic_activation_seconds} onChange={(e) => setSystemConfig((prev) => ({ ...prev, automatic_activation_seconds: Number(e.target.value || 0) }))} /></label><label className="config-switch-field"><span>Semáforos habilitados</span><button className={`switch-btn ${systemConfig.traffic_lights_enabled ? 'on' : 'off'}`} onClick={() => setSystemConfig((prev) => ({ ...prev, traffic_lights_enabled: !prev.traffic_lights_enabled }))}>{systemConfig.traffic_lights_enabled ? 'ON' : 'OFF'}</button></label><label className="config-switch-field"><span>Automatización de semáforos</span><button className={`switch-btn ${systemConfig.semaforo_automation_enabled ? 'on' : 'off'}`} onClick={() => setSystemConfig((prev) => ({ ...prev, semaforo_automation_enabled: !prev.semaforo_automation_enabled }))}>{systemConfig.semaforo_automation_enabled ? 'ON' : 'OFF'}</button></label><label className="config-switch-field"><span>Fuentes externas habilitadas</span><button className={`switch-btn ${systemConfig.external_sources_enabled ? 'on' : 'off'}`} onClick={() => setSystemConfig((prev) => ({ ...prev, external_sources_enabled: !prev.external_sources_enabled }))}>{systemConfig.external_sources_enabled ? 'ON' : 'OFF'}</button></label></div><div className="config-actions-row"><button className="pill-btn primary" onClick={saveSystemConfig} disabled={saving}>{saving ? 'Guardando…' : 'Guardar configuración'}</button></div></div>}

          {activeTab === TAB_KEYS.sources && <div className="config-tab-panel"><div className="config-section-head"><div className="config-section-title">Fuentes externas</div><button className="pill-btn" onClick={() => openModal(TAB_KEYS.sources, 'create')}>Agregar nuevo</button></div><div className="table-wrap"><table className="tm-table"><thead><tr><th>Nombre</th><th>Código</th><th>Tipo</th><th>Endpoint</th><th>Estado</th><th>Editar</th></tr></thead><tbody>{sources.length ? sources.map((item, idx) => <tr key={item.id || idx}><td>{item.name || '-'}</td><td>{item.code || '-'}</td><td>{item.type || '-'}</td><td>{item.endpoint || '-'}</td><td><span className={`status-pill ${statusPillClass(item.status || (item.is_active ? 'online' : 'offline'))}`}>{item.status || (item.is_active ? 'online' : 'offline')}</span></td><td><button className="mini-btn" onClick={() => openModal(TAB_KEYS.sources, 'edit', item)}>Editar</button></td></tr>) : <tr><td colSpan="6">No hay fuentes externas registradas.</td></tr>}</tbody></table></div></div>}

          {activeTab === TAB_KEYS.screens && <div className="config-tab-panel"><div className="config-section-head"><div className="config-section-title">Pantallas</div><button className="pill-btn" onClick={() => openModal(TAB_KEYS.screens, 'create')}>Agregar nuevo</button></div><div className="table-wrap"><table className="tm-table"><thead><tr><th>Pantalla</th><th>Ubicación</th><th>Estado</th><th>Último heartbeat</th><th>IP</th><th>MAC detectada</th><th>Equipo detectado</th><th>MAC autorizada</th><th>Licencia</th><th>Expira</th><th>Sitio</th><th>URL</th><th>Editar</th></tr></thead><tbody>{screens.length ? screens.map((item, idx) => <tr key={item.id || idx}><td><strong>{item.name || item.code || '-'}</strong><div className="sub-cell">{item.code || '-'}</div></td><td>{item.device_label || '-'}</td><td><span className={`status-pill ${statusPillClass(item.status || 'offline')}`}>{item.status || 'offline'}</span>{item.license_status && item.license_status !== 'licensed' ? <div className={`license-chip ${item.license_status}`}>{item.license_status}</div> : null}{item.license_reason ? <div className="sub-cell warning">{item.license_reason}</div> : null}</td><td>{formatDateTime(item.last_heartbeat)}</td><td>{item.client_ip || '-'}</td><td>{item.mac_address || '-'}</td><td>{item.device_name || '-'}</td><td>{item.authorized_mac || (item.enforce_mac_lock ? 'Pendiente' : 'No aplica')}</td><td>{licenseLabel(item.license_plan)}</td><td>{item.license_expires_at ? formatDateTime(item.license_expires_at) : (item.license_plan === 'unlimited' ? 'Ilimitada' : '-')}</td><td>{item.site_name || item.site_code || '-'}</td><td>{item.url || '-'}</td><td><button className="mini-btn" onClick={() => openModal(TAB_KEYS.screens, 'edit', item)}>Editar</button></td></tr>) : <tr><td colSpan="13">No hay pantallas registradas.</td></tr>}</tbody></table></div></div>}

          {activeTab === TAB_KEYS.polygons && <div className="config-tab-panel"><div className="config-section-title">Polígonos por mapa</div><div className="polygon-toolbar-row"><label className="config-field compact"><span>Sitio</span><select value={selectedSiteCode} onChange={(e) => { const siteCode = e.target.value; setSelectedSiteCode(siteCode); const found = polygonSites.find((site) => site.site_code === siteCode); setSelectedMapCode(found?.maps?.[0]?.map_code || '') }}>{polygonSites.map((site) => <option key={site.site_code} value={site.site_code}>{site.site_name}</option>)}</select></label><label className="config-field compact"><span>Mapa</span><select value={selectedMapCode} onChange={(e) => setSelectedMapCode(e.target.value)}>{availableMaps.map((map) => <option key={map.map_code} value={map.map_code}>{map.map_name}</option>)}</select></label></div><div className="polygon-config-grid"><div className="polygon-list-panel"><table className="tm-table compact"><thead><tr><th>Polígono</th><th>Modo</th><th>Manual</th><th>Automático</th><th>Editar</th></tr></thead><tbody>{polygons.length ? polygons.map((item) => <tr key={item.map_object_id} className={item.map_object_id === selectedPolygonId ? 'selected' : ''}><td>{item.polygon_name}</td><td>{item.control_mode || 'manual'}</td><td>{item.manual_enabled ? 'Sí' : 'No'}</td><td>{item.automatic_enabled ? 'Sí' : 'No'}</td><td><button className="mini-btn" onClick={() => setSelectedPolygonId(item.map_object_id)}>Editar</button></td></tr>) : <tr><td colSpan="5">No hay polígonos en este mapa.</td></tr>}</tbody></table></div><div className="polygon-editor-panel">{selectedPolygon ? <><div className="config-form-grid"><label className="config-field"><span>Nombre</span><input value={selectedPolygon.polygon_name || ''} readOnly /></label><label className="config-field"><span>Modo</span><select value={selectedPolygon.control_mode || 'manual'} onChange={(e) => updateSelectedPolygonField('control_mode', e.target.value)}><option value="manual">manual</option><option value="manual_only">manual_only</option><option value="automatic_only">automatic_only</option></select></label><label className="config-field check"><input type="checkbox" checked={Boolean(selectedPolygon.manual_enabled)} onChange={(e) => updateSelectedPolygonField('manual_enabled', e.target.checked)} /><span>Permitir cambio manual</span></label><label className="config-field check"><input type="checkbox" checked={Boolean(selectedPolygon.automatic_enabled)} onChange={(e) => updateSelectedPolygonField('automatic_enabled', e.target.checked)} /><span>Permitir cambio automático</span></label></div><div className="state-options-header"><div className="config-section-title">Opciones de estado</div></div><table className="tm-table compact"><thead><tr><th>Código</th><th>Botón</th><th>Color</th><th>Orden</th><th>Visible</th><th>Activo</th></tr></thead><tbody>{(selectedPolygon.options || []).map((option, idx) => <tr key={`${selectedPolygon.map_object_id}-${idx}`}><td><input value={option.state_code || ''} onChange={(e) => updateSelectedPolygonOption(idx, 'state_code', e.target.value)} /></td><td><input value={option.button_label || ''} onChange={(e) => updateSelectedPolygonOption(idx, 'button_label', e.target.value)} /></td><td><input value={option.color_hex || ''} onChange={(e) => updateSelectedPolygonOption(idx, 'color_hex', e.target.value)} /></td><td><input type="number" value={option.sort_order || idx + 1} onChange={(e) => updateSelectedPolygonOption(idx, 'sort_order', e.target.value)} /></td><td><input type="checkbox" checked={Boolean(option.is_visible ?? true)} onChange={(e) => updateSelectedPolygonOption(idx, 'is_visible', e.target.checked)} /></td><td><input type="checkbox" checked={Boolean(option.is_enabled ?? true)} onChange={(e) => updateSelectedPolygonOption(idx, 'is_enabled', e.target.checked)} /></td></tr>)}</tbody></table><div className="config-actions-row"><button className="pill-btn primary" onClick={savePolygonConfig} disabled={saving}>{saving ? 'Guardando…' : 'Guardar polígono'}</button></div></> : <p>Selecciona un polígono para editar su configuración.</p>}</div></div></div>}
        </>)}
      </div>

      {modal.open && (
        <Modal
          title={`${modal.mode === 'create' ? 'Agregar' : 'Editar'} ${TABS.find((t) => t.key === modal.tab)?.label || ''}`}
          onClose={closeModal}
          onSave={handleSaveModal}
          saving={saving}
        >
          {renderModalForm()}
        </Modal>
      )}
    </div>
  )
}
