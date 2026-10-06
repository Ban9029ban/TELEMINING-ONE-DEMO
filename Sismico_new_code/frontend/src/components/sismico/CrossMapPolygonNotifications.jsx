import { VisualBox } from '../visual/VisualLayout'
import React, { useEffect, useMemo, useState } from 'react'
import { useSismicoAlertFocus, useSismicoRemotePolygonAlerts } from '../../context/SismicoViewContext'
import './CrossMapPolygonNotifications.css'

export default function CrossMapPolygonNotifications() {
  const remoteAlerts = useSismicoRemotePolygonAlerts()
  const { setFocusedAlertKey } = useSismicoAlertFocus()
  const [notifications, setNotifications] = useState({})
  const [centerKey, setCenterKey] = useState(null)

  useEffect(() => {
    setNotifications((previous) => {
      const next = {}
      for (const item of remoteAlerts) {
        const key = String(item.map_object_id)
        const existing = previous[key]
        next[key] = { ...item, key, phase: existing?.phase || 'queued' }
      }
      return next
    })
  }, [remoteAlerts])

  useEffect(() => {
    if (!centerKey) return undefined
    if (!notifications[centerKey] || notifications[centerKey].phase !== 'center') {
      setCenterKey(null)
      return undefined
    }

    const timer = window.setTimeout(() => {
      setNotifications((previous) => (
        previous[centerKey]
          ? { ...previous, [centerKey]: { ...previous[centerKey], phase: 'corner' } }
          : previous
      ))
      setCenterKey(null)
    }, 3000)

    return () => window.clearTimeout(timer)
  }, [centerKey, notifications])

  useEffect(() => {
    if (centerKey) return
    const next = Object.values(notifications)
      .filter((item) => item.phase === 'queued')
      .sort((a, b) => String(a.observed_at || '').localeCompare(String(b.observed_at || '')))[0]

    if (!next) return

    setNotifications((previous) => ({
      ...previous,
      [next.key]: { ...previous[next.key], phase: 'center' },
    }))
    setCenterKey(next.key)
  }, [centerKey, notifications])

  const orderedNotifications = useMemo(
    () => Object.values(notifications).sort((a, b) => String(a.observed_at || '').localeCompare(String(b.observed_at || ''))),
    [notifications],
  )
  const anchoredKeys = orderedNotifications.filter((item) => item.phase === 'corner').map((item) => item.key)
  const focusedItem = centerKey
    ? notifications[centerKey]
    : orderedNotifications.find((item) => item.phase !== 'queued') || orderedNotifications[0]

  useEffect(() => {
    setFocusedAlertKey(focusedItem?.key || null)
  }, [focusedItem?.key, setFocusedAlertKey])

  useEffect(() => () => setFocusedAlertKey(null), [setFocusedAlertKey])

  return (
    <VisualBox id="remote-alerts" label="Alertas de otros planos"><aside className="cross-map-notifications" aria-live="assertive" aria-label="Alertas de polígonos en otros planos">
      {orderedNotifications.map((item) => {
        const cornerIndex = anchoredKeys.indexOf(item.key)
        return (
          <article
            key={item.key}
            className={`cross-map-notification phase-${item.phase} state-${item.state_code}`}
            style={item.phase === 'corner' ? { '--corner-offset': `${cornerIndex * 138}px` } : undefined}
          >
            <div className="cross-map-notification-kicker">Polígono activado en otro plano</div>
            <p>
              Polígono <strong>“{item.polygon_name}”</strong>, de la Mina <strong>“{item.site_name}”</strong>, en estado <strong>“{item.state_label}”</strong>.
            </p>
            <div className="cross-map-notification-map">Plano: {item.map_name}</div>
          </article>
        )
      })}
    </aside></VisualBox>
  )
}
