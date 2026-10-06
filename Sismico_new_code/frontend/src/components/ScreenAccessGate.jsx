import React, { useEffect, useState } from 'react'
import { checkDeviceAccess } from '../services/sismicoApi'

export default function ScreenAccessGate({ siteCode, moduleCode = 'sismico', screenCode, children }) {
  const [state, setState] = useState({ loading: true, allowed: false, message: '' })

  useEffect(() => {
    let mounted = true
    const params = new URLSearchParams(window.location.search)
    const screenNumber = params.get('pantalla')
    const requestedScreenCode = screenCode || (screenNumber ? `pantalla-${screenNumber}` : undefined)
    checkDeviceAccess({ route_path: window.location.pathname, site_code: siteCode, module_code: moduleCode, screen_code: requestedScreenCode })
      .then((result) => { if (mounted) setState({ loading: false, ...result }) })
      .catch((error) => { if (mounted) setState({ loading: false, allowed: false, message: error.message || 'No fue posible validar el dispositivo.' }) })
    return () => { mounted = false }
  }, [siteCode, moduleCode, screenCode])

  if (state.loading) return <div className="panel-card page-screen full-panel"><h3>Validando dispositivo</h3><p>Verificando agente local, licencia y autorización del equipo.</p></div>
  if (!state.allowed) {
    return <div className="panel-card page-screen full-panel">
      <h3>Acceso bloqueado</h3>
      <p>{state.message || 'El equipo no está autorizado para este módulo.'}</p>
      <p>Instala o ejecuta el agente local PowerShell para registrar MAC, hostname y licencia del equipo.</p>
      <pre style={{whiteSpace:'pre-wrap'}}>powershell -ExecutionPolicy Bypass -File scripts/windows/tmone-device-agent.ps1 -BackendUrl http://TU_BACKEND -ScreenCode pantalla-1 -SiteCode {siteCode}</pre>
    </div>
  }
  return children
}
