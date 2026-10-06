import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getSismicoSite,
  getSismicoSiteState,
  getSismicoPollingStatus,
  runSismicoPolling,
  sendHeartbeat,
} from '../services/sismicoApi'
import { useSismicoActiveViewRegistration } from '../context/SismicoViewContext'

export function useSismicoSite(siteCode) {
  const [detail, setDetail] = useState(null)
  const [state, setState] = useState(null)
  const [pollingStatus, setPollingStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [runningPolling, setRunningPolling] = useState(false)
  const [error, setError] = useState('')

  useSismicoActiveViewRegistration(siteCode, detail?.map?.code)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [a, b, c] = await Promise.all([
        getSismicoSite(siteCode),
        getSismicoSiteState(siteCode),
        getSismicoPollingStatus(siteCode).catch(() => null),
      ])
      setDetail(a)
      setState(b)
      setPollingStatus(c)
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setLoading(false)
    }
  }, [siteCode])

  const refresh = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        getSismicoSiteState(siteCode),
        getSismicoPollingStatus(siteCode).catch(() => null),
      ])
      setState(a)
      setPollingStatus(b)
    } catch (err) {
      setError(err?.message || String(err))
    }
  }, [siteCode])

  const runManualPolling = useCallback(async () => {
    setRunningPolling(true)
    try {
      await runSismicoPolling(siteCode)
      await refresh()
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setRunningPolling(false)
    }
  }, [refresh, siteCode])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const screenNumber = params.get('pantalla')
    const heartbeatCode = screenNumber
      ? `pantalla-${screenNumber}`
      : `${siteCode}-screen`.replace(/_/g, '-').toUpperCase()

    const send = () => sendHeartbeat(heartbeatCode, {
      current_url: window.location.pathname,
      site_code: siteCode,
      screen_number: screenNumber ? Number(screenNumber) : undefined,
      browser_fingerprint: `${navigator.userAgent}|${window.screen.width}x${window.screen.height}|${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
      user_agent: navigator.userAgent,
    })

    send()
    const timer = setInterval(send, 10000)
    return () => clearInterval(timer)
  }, [siteCode])

  useEffect(() => {
    const ms = Math.max(5000, Number(detail?.refresh?.polling_seconds || 15) * 1000)
    const timer = setInterval(refresh, ms)
    return () => clearInterval(timer)
  }, [detail?.refresh?.polling_seconds, refresh])

  const stateMap = useMemo(() => {
    const out = {}
    ;(state?.object_states || []).forEach((item) => {
      out[item.object_code] = item
    })
    return out
  }, [state])

  return { detail, state, stateMap, pollingStatus, loading, runningPolling, error, refresh, runManualPolling }
}
