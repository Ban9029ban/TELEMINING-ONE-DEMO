const ONE_HOUR_MS = 60 * 60 * 1000

function asDate(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDate(date) {
  return new Intl.DateTimeFormat('es-CL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

function newestDate(...dates) {
  let newest = null
  for (const value of dates) {
    if (value && (!newest || value > newest)) {
      newest = value
    }
  }
  return newest
}

function normalizeStatusValue(rawValue) {
  const raw = String(rawValue || '')
    .trim()
    .toLowerCase()

  if (!raw) return 'unknown'
  if (raw === 'online') return 'online'
  if (raw === 'offline') return 'offline'
  if (raw === 'cached') return 'cached'
  if (raw === 'manual') return 'manual'
  return raw
}

function normalizeSourceStatus(state) {
  const raw = normalizeStatusValue(
    state?.last_effective_source_status ??
      state?.lastEffectiveSourceStatus ??
      state?.source_status ??
      state?.sourceStatus ??
      state?.status_fuente,
  )

  if (raw === 'unknown') {
    if (state?.external_sources_online === true || state?.externalSourcesOnline === true) return 'online'
    if (state?.external_sources_online === false || state?.externalSourcesOnline === false) return 'offline'
    return 'unknown'
  }
  return raw
}

function latestObservedState(objectStates) {
  let newest = null
  for (const item of objectStates || []) {
    const candidate = asDate(item?.observed_at || item?.observedAt)
    if (candidate && (!newest || candidate > newest)) {
      newest = {
        observedAt: candidate,
        sourceStatus: normalizeStatusValue(item?.source_status ?? item?.sourceStatus),
      }
    }
  }
  return newest
}

export function getLastRecordInfo(state) {
  const observedState = latestObservedState(state?.object_states || state?.objectStates)
  const sourceStatus = normalizeSourceStatus(state) || observedState?.sourceStatus || 'unknown'
  const backendEffectiveAt = asDate(state?.last_effective_record_at || state?.lastEffectiveRecordAt)
  const directCapture = asDate(state?.last_capture_at || state?.lastCaptureAt)
  const observedCapture = observedState?.observedAt || null
  const systemStartedAt = asDate(state?.system_started_at || state?.systemStartedAt)
  const syncAt = asDate(state?.last_sync_at || state?.lastSyncAt)

  const captureAt = backendEffectiveAt || observedCapture || directCapture
  const startupAt = newestDate(systemStartedAt, syncAt)

  if (captureAt && sourceStatus === 'online') {
    const formattedCapture = formatDate(captureAt)
    const isStale = Date.now() - captureAt.getTime() >= ONE_HOUR_MS
    return {
      toneClass: isStale ? 'is-warning' : 'is-ok',
      text: isStale
        ? `${formattedCapture} / online / lectura > 1 h`
        : `${formattedCapture} / online`,
      isoValue: captureAt.toISOString(),
      hasCapture: true,
      sourceStatus,
    }
  }

  if (captureAt && sourceStatus === 'cached') {
    const formattedCapture = formatDate(captureAt)
    return {
      toneClass: 'is-warning',
      text: `${formattedCapture} / cached`,
      isoValue: captureAt.toISOString(),
      hasCapture: true,
      sourceStatus,
    }
  }

  if (captureAt && sourceStatus === 'manual') {
    const formattedCapture = formatDate(captureAt)
    return {
      toneClass: 'is-warning',
      text: `${formattedCapture} / manual`,
      isoValue: captureAt.toISOString(),
      hasCapture: true,
      sourceStatus,
    }
  }

  if (captureAt) {
    const formattedCapture = formatDate(captureAt)
    return {
      toneClass: sourceStatus === 'unknown' ? 'is-warning' : 'is-danger',
      text: `${formattedCapture} / ${sourceStatus === 'unknown' ? 'unknown' : sourceStatus}`,
      isoValue: captureAt.toISOString(),
      hasCapture: true,
      sourceStatus,
    }
  }

  if (startupAt) {
    const formattedStartup = formatDate(startupAt)
    return {
      toneClass: sourceStatus === 'offline' ? 'is-danger' : 'is-warning',
      text: `${formattedStartup} / ${sourceStatus === 'unknown' ? 'unknown' : sourceStatus}`,
      isoValue: startupAt.toISOString(),
      hasCapture: false,
      sourceStatus,
    }
  }

  return {
    toneClass: sourceStatus === 'offline' ? 'is-danger' : 'is-warning',
    text: `Sin fecha disponible / ${sourceStatus === 'unknown' ? 'unknown' : sourceStatus}`,
    isoValue: null,
    hasCapture: false,
    sourceStatus,
  }
}

// Compatibilidad retroactiva para componentes legacy aún no migrados.
export function getLastRecordAt(state) {
  const info = getLastRecordInfo(state)
  return info?.isoValue || null
}

export function formatLastRecordAt(stateOrDate) {
  if (stateOrDate instanceof Date || typeof stateOrDate === 'string') {
    const parsed = asDate(stateOrDate)
    return parsed ? formatDate(parsed) : 'Sin fecha disponible'
  }
  const info = getLastRecordInfo(stateOrDate)
  return info?.text || 'Sin fecha disponible / offline'
}
