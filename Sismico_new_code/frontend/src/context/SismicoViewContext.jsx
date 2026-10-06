import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { getSismicoActivePolygons } from '../services/sismicoApi'

const POLL_INTERVAL_MS = 5000

const SismicoViewContext = createContext({
  activeView: null,
  setActiveView: () => undefined,
  activePolygons: [],
  focusedAlertKey: null,
  setFocusedAlertKey: () => undefined,
})

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function isCurrentView(item, activeView) {
  if (!activeView?.siteCode) return false
  if (normalize(item.site_code) !== activeView.siteCode) return false
  return !activeView.mapCode || normalize(item.map_code) === activeView.mapCode
}

export function SismicoViewProvider({ children, alertsEnabled = false }) {
  const [activeView, setActiveView] = useState(null)
  const [activePolygons, setActivePolygons] = useState([])
  const [focusedAlertKey, setFocusedAlertKey] = useState(null)

  const refreshAlerts = useCallback(async () => {
    try {
      const response = await getSismicoActivePolygons()
      setActivePolygons(Array.isArray(response?.items) ? response.items : [])
    } catch {
      // Conserva las alertas visibles ante un fallo transitorio de red.
    }
  }, [])

  useEffect(() => {
    if (!alertsEnabled) {
      setActivePolygons([])
      setFocusedAlertKey(null)
      return undefined
    }

    refreshAlerts()
    const timer = window.setInterval(refreshAlerts, POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [alertsEnabled, refreshAlerts])

  const value = useMemo(() => ({
    activeView,
    setActiveView,
    activePolygons,
    focusedAlertKey,
    setFocusedAlertKey,
  }), [activePolygons, activeView, focusedAlertKey])

  return <SismicoViewContext.Provider value={value}>{children}</SismicoViewContext.Provider>
}

export function useSismicoActiveViewRegistration(siteCode, mapCode) {
  const { setActiveView } = useContext(SismicoViewContext)
  const normalizedSiteCode = normalize(siteCode)
  const normalizedMapCode = normalize(mapCode)

  useEffect(() => {
    if (!normalizedSiteCode) return undefined

    const view = { siteCode: normalizedSiteCode, mapCode: normalizedMapCode || null }
    setActiveView(view)

    return () => {
      setActiveView((current) => (
        current?.siteCode === view.siteCode && current?.mapCode === view.mapCode ? null : current
      ))
    }
  }, [normalizedMapCode, normalizedSiteCode, setActiveView])
}

export function useSismicoActiveView() {
  return useContext(SismicoViewContext).activeView
}

export function useSismicoRemotePolygonAlerts() {
  const { activePolygons, activeView } = useContext(SismicoViewContext)

  return useMemo(
    () => activePolygons.filter((item) => !isCurrentView(item, activeView)),
    [activePolygons, activeView],
  )
}

export function useSismicoAlertFocus() {
  const { focusedAlertKey, setFocusedAlertKey } = useContext(SismicoViewContext)
  return { focusedAlertKey, setFocusedAlertKey }
}
