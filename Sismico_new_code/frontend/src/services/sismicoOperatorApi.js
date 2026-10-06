import { responseErrorMessage } from './responseError.js'
const rawBase =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '') ||
  `${window.location.protocol}//${window.location.hostname}:18000`
const API_BASE_URL = rawBase.endsWith('/api') ? rawBase : `${rawBase}/api`

const ANDES_NORTE_OBJECT_ALIASES = {
  ann_monitoreo_post_evento_2025: 'monitoreo_post_evento_2025',
  ann_monitoreo_post_evento: 'monitoreo_post_evento',
  ann_monitoreo_post_evento_fw: 'monitoreo_post_evento_fw',
  ann_bajo_footprint_an: 'bajo_footprint_an',
  ann_bajo_andes_norte: 'bajo_footprint_an',
  ann_adit_74_75: 'adit_74_75',
  ann_adit_74_75_profundo: 'adit_74_75',
  ann_pilar_2: 'poligono_pilar_2',
  ann_pilar_2_profundo: 'poligono_pilar_2',
  ann_inicio_caving: 'inicio_caving',
  ann_pacifico: 'pacifico',
  ann_cab_fw_norte: 'cabecera_fw_norte',
  ann_cabecera_fw_norte: 'cabecera_fw_norte',
  ann_cab_hw: 'cabecera_hw',
  ann_cabecera_hw: 'cabecera_hw',
  ann_an_norte_hw: 'an_norte_hw',
  ann_an_norte_fw: 'an_norte_fw',
  ann_an_sur_hw: 'an_sur_hw',
  ann_tc_oim: 'tc_oim',
  ann_p4600: 'p_4600',
}

function normalizeOperatorCode(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

function uniqueValues(values = []) {
  return Array.from(new Set(values.filter(Boolean)))
}

function buildCodeCandidates(siteCode, value) {
  const normalizedSite = normalizeOperatorCode(siteCode)
  const raw = String(value || '').trim()
  const normalized = normalizeOperatorCode(value)
  const candidates = []

  if (raw) candidates.push(raw)
  if (normalized) {
    candidates.push(normalized)
    candidates.push(normalized.replace(/_/g, '-'))
  }

  if (normalizedSite === 'andes_norte') {
    const aliased = ANDES_NORTE_OBJECT_ALIASES[normalized]
    if (aliased) {
      candidates.push(aliased)
      candidates.push(aliased.replace(/_/g, '-'))
    }
  }

  if (normalized.startsWith('ann_')) {
    const stripped = normalized.slice(4)
    candidates.push(stripped)
    candidates.push(stripped.replace(/_/g, '-'))
  }

  return uniqueValues(candidates)
}

function buildAttemptCandidates(siteCode, objectCode, polygonCode) {
  const candidates = []

  for (const candidate of buildCodeCandidates(siteCode, objectCode)) {
    candidates.push({ objectCode: candidate, polygonCode: candidate })
  }

  for (const candidate of buildCodeCandidates(siteCode, polygonCode || objectCode)) {
    candidates.push({ objectCode: candidate, polygonCode: candidate })
  }

  return uniqueValues(candidates.map((attempt) => JSON.stringify(attempt))).map((attempt) => JSON.parse(attempt))
}

async function postManualObjectState(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) return { ok: false, status: response.status, error: await responseErrorMessage(response) }

  const contentType = response.headers.get('content-type') || ''
  const isJson = contentType.includes('application/json')
  const body = isJson ? await response.json() : await response.text()

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error:
        (isJson && (body.detail || body.message || JSON.stringify(body))) ||
        String(body || `HTTP ${response.status}`),
    }
  }

  return { ok: true, data: body }
}

export async function setManualObjectState({
  siteCode,
  objectCode,
  polygonCode,
  mapCode,
  stateCode,
  targetState,
  actionType = 'state_change',
  dryRun = false,
  requestedBy = 'operador_local',
}) {
  try {
    const requestUrl = `${API_BASE_URL}/sismico/operator/site/${siteCode}/object-state`
    const attempts = buildAttemptCandidates(siteCode, objectCode, polygonCode)
    let lastError = null

    for (const attempt of attempts) {
      const payload = {
        objectCode: attempt.objectCode,
        polygonCode: attempt.polygonCode,
        mapCode,
        stateCode: targetState || stateCode,
        targetState: targetState || stateCode,
        requestedBy,
        actionType,
        dryRun,
      }

      console.log('[SISMICO OPERATOR] SEND', {
        siteCode,
        ...payload,
      })

      const response = await postManualObjectState(requestUrl, payload)
      if (response.ok) {
        return response
      }

      lastError = response
      if (response.status !== 404) {
        return response
      }
    }

    return lastError || { ok: false, status: 0, error: 'No fue posible enviar el cambio manual.' }
  } catch (error) {
    return { ok: false, status: 0, error: String(error) }
  }
}

export async function setPolygonControlMode(siteCode, objectCode, mode) {
  const response = await postManualObjectState(`${API_BASE_URL}/sismico/operator/site/${siteCode}/control-mode`, { objectCode, mode })
  if (!response.ok) throw new Error(typeof response.error === 'string' && !response.error.includes('<html') ? response.error : 'No se pudo cambiar el modo del polígono.')
  return response.data
}
