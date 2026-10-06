import React, { useEffect, useState } from 'react'
import './LicenseExpiryNotice.css'

export default function LicenseExpiryNotice({ endpoint, token }) {
  const [account, setAccount] = useState(null)
  useEffect(() => {
    setAccount(null)
    if (!token || !endpoint) return undefined
    let live = true
    let pending = false
    const controller = new AbortController()
    const refresh = async () => {
      if (pending) return
      pending = true
      try {
        const response = await fetch(endpoint, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        })
        if (!response.ok) { if (live && [401, 403].includes(response.status)) setAccount(null); return }
        const data = await response.json()
        if (live) setAccount(data)
      } catch { /* Keep the last confirmed expiration during transient failures. */ }
      finally { pending = false }
    }
    refresh()
    const timer = setInterval(refresh, 60000)
    window.addEventListener('focus', refresh)
    return () => { live = false; controller.abort(); clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [endpoint, token])
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(account?.license_expires_on || '')
  if (!account?.license_warning_due || !match) return null
  return <div className="seismic-license-notice" role="status" aria-live="polite">
    Licencia caduca en {match[3]}/{match[2]}/{match[1]}
  </div>
}
