import React, { useEffect, useState } from 'react'
import { loadPublicRuntimeConfig } from '../services/sismicoApi'

export default function EnvironmentBanner() {
  const [cfg, setCfg] = useState(null)

  useEffect(() => {
    let mounted = true
    loadPublicRuntimeConfig().then((data) => {
      if (mounted) setCfg(data)
    }).catch(() => {
      if (mounted) setCfg(null)
    })
    return () => { mounted = false }
  }, [])

  const online = cfg?.sourceStatusSummary?.online === true
  return (
    <div className="tm-environment-banner">
      <div><strong>Ambiente:</strong> {cfg?.environment || 'local'}</div>
      <div className={online ? 'ext-src on' : 'ext-src off'}>Fuentes externas {online ? 'ON' : 'OFF'}</div>
      <div><strong>Semáforos:</strong> {cfg?.semaforoDryRun ? 'DRY-RUN' : 'LIVE'}</div>
    </div>
  )
}
