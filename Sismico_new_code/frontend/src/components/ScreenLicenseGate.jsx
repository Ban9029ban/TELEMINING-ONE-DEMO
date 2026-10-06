import React from 'react'

const TITLES = {
  blocked: 'Pantalla sin licencia',
  expired: 'Licencia expirada',
  disabled: 'Pantalla deshabilitada',
  unauthorized_device: 'Equipo no autorizado',
  awaiting_mac: 'Esperando identificación del equipo',
}

export default function ScreenLicenseGate({ licenseInfo }) {
  const status = licenseInfo?.license_status || 'blocked'
  const plan = licenseInfo?.license_plan || 'no_license'
  const expires = licenseInfo?.license_expires_at || null
  const title = TITLES[status] || 'Acceso bloqueado'
  const detail = licenseInfo?.license_reason
    || (status === 'expired'
      ? `La licencia de esta pantalla venció${expires ? ` el ${expires}` : ''}.`
      : 'Esta pantalla no tiene autorización para operar el sistema.')

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#eef2f7', padding: 24 }}>
      <div style={{ maxWidth: 760, width: '100%', background: '#fff', borderRadius: 20, padding: 28, boxShadow: '0 20px 48px rgba(0,0,0,.12)', border: '1px solid #d7deea' }}>
        <div style={{ fontSize: 28, fontWeight: 900, color: '#243457', marginBottom: 8 }}>{title}</div>
        <div style={{ color: '#42526e', marginBottom: 16 }}>{detail}</div>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
          <div><strong>Plan</strong><div>{plan}</div></div>
          <div><strong>Estado</strong><div>{status}</div></div>
          <div><strong>Expira</strong><div>{expires || 'No aplica'}</div></div>
          <div><strong>MAC detectada</strong><div>{licenseInfo?.detected_mac || '-'}</div></div>
          <div><strong>MAC autorizada</strong><div>{licenseInfo?.authorized_mac || '-'}</div></div>
          <div><strong>Bloqueo MAC</strong><div>{licenseInfo?.enforce_mac_lock ? 'Sí' : 'No'}</div></div>
        </div>
        <div style={{ marginTop: 18, color: '#8f1b1b', fontWeight: 700 }}>Acceso bloqueado. Solicita habilitación desde Configuración &gt; Pantallas.</div>
      </div>
    </div>
  )
}
