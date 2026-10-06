import React from 'react'

function normalizeStatus(sourceStatus, online) {
  const raw = String(sourceStatus || '')
    .trim()
    .toLowerCase()

  if (raw) return raw
  return online ? 'online' : 'offline'
}

function badgeClass(status) {
  if (status === 'online') return 'on'
  if (status === 'cached') return 'cached'
  if (status === 'manual') return 'manual'
  if (status === 'unknown') return 'unknown'
  return 'off'
}

function badgeLabel(status) {
  if (status === 'online') return 'ONLINE'
  if (status === 'cached') return 'CACHED'
  if (status === 'manual') return 'MANUAL'
  if (status === 'unknown') return 'UNKNOWN'
  return 'OFFLINE'
}

function effectiveSummary(status, at) {
  if (!status && !at) return null
  const label = badgeLabel(status || 'unknown')
  if (!at) return `Ultimo dato visible: ${label}`
  const parsed = new Date(at)
  if (Number.isNaN(parsed.getTime())) return `Ultimo dato visible: ${label}`
  return `Ultimo dato visible: ${label} / ${parsed.toLocaleString('es-CL', { hour12: false })}`
}

export default function SismicoSourceStatus({ online, sourceStatus, message, effectiveSourceStatus, effectiveRecordAt }) {
  const normalizedStatus = normalizeStatus(sourceStatus, online)
  const detailLine = effectiveSummary(effectiveSourceStatus, effectiveRecordAt)

  return (
    <section className="panel-card">
      <h3>Fuentes Externas</h3>
      <button className={`source-toggle ${badgeClass(normalizedStatus)}`} type="button">
        Fuentes externas {badgeLabel(normalizedStatus)}
      </button>
      <p className="muted-line">Estado backend: {normalizedStatus}</p>
      <p className="muted-line">{message || (online ? 'Lectura remota operativa' : 'Backend sin lectura remota')}</p>
      {detailLine ? <p className="muted-line">{detailLine}</p> : null}
    </section>
  )
}
