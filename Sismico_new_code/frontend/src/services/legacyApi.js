import { API_ROOT } from './apiBase'

export const API = API_ROOT
export const REMOTE_POLYGONS_JSON = import.meta.env.VITE_REMOTE_POLYGONS_JSON || '/api/poligonos'
export const REMOTE_POLYGONS_HTML = import.meta.env.VITE_REMOTE_POLYGONS_HTML || '/proxy/resumen'

export async function fetchWithTimeout(url, opts = {}, timeout = 9000) {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), timeout)
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal })
  } finally {
    clearTimeout(id)
  }
}

export async function heartbeat(screen_code, current_url) {
  try {
    await fetch(`${API}/api/screens/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        screen_code,
        browser_session_id:
          sessionStorage.getItem('browser_session_id') ||
          (() => {
            const v = Math.random().toString(36).slice(2)
            sessionStorage.setItem('browser_session_id', v)
            return v
          })(),
        current_url,
      }),
    })
  } catch {}
}

export function normalizeAndesitaJson(payload) {
  const out = {}
  if (Array.isArray(payload?.items)) {
    for (const it of payload.items) if (it?.nombre) out[it.nombre] = String(it.estado || '')
  } else if (payload && typeof payload === 'object') {
    for (const k of Object.keys(payload)) out[k] = String(payload[k] || '')
  }
  return out
}

export async function loadAndesitaStates() {
  try {
    const res = await fetchWithTimeout(REMOTE_POLYGONS_JSON, { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = normalizeAndesitaJson(await res.json())
    if (Object.keys(data).length) return { source: 'json', states: data }
  } catch {}
  const res = await fetchWithTimeout(REMOTE_POLYGONS_HTML, { cache: 'no-store', credentials: 'same-origin' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const rows = Array.from(doc.querySelectorAll('table tr, tbody tr, .table tr'))
  const names = ['Andesita Norte HW', 'Andesita Norte FW', 'Andesita Sur HW', 'Andesita Sur FW']
  const out = {}
  rows.forEach((tr) => {
    const tds = Array.from(tr.querySelectorAll('td,th')).map((td) => td.textContent.trim())
    names.forEach((name) => {
      if (tds.some((t) => t.toUpperCase() === name.toUpperCase())) {
        const est = tds.find((x) => ['CENTRO', 'BAJA', 'ALTA'].includes((x || '').toUpperCase()))
        if (est) out[name] = est.toUpperCase()
      }
    })
  })
  return { source: 'html', states: out }
}

export async function loadDiamanteStatus() {
  const res = await fetchWithTimeout('/api/diamante-status', { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function loadZonesDet() {
  const res = await fetchWithTimeout(`${API}/api/module-tmone/zones-det/list`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function loadFaqs() {
  const res = await fetchWithTimeout(`${API}/api/module-tmone/agents/faqs`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function askAgent(question) {
  const payload = typeof question === 'string' ? { question } : (question || {})
  const res = await fetchWithTimeout(`${API}/api/module-tmone/agents/consult`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function loadProductivitySummary() {
  const res = await fetchWithTimeout(`${API}/api/module-tmone/productivity/summary`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function loadProductivityChart() {
  const res = await fetchWithTimeout(`${API}/api/module-tmone/productivity/seismic-chart`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
