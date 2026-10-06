// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { vi, test, expect } from 'vitest'
import LicenseExpiryNotice from './LicenseExpiryNotice'

test('shows expiration in header and removes it after renewal', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  let account = {license_warning_due:true,license_expires_on:'2026-10-10'}
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>account})))
  const node=document.createElement('header'); document.body.appendChild(node)
  const root=createRoot(node)
  try {
    await act(async()=>root.render(<LicenseExpiryNotice endpoint="/api/auth/me" token="test" />))
    expect(node.querySelector('.seismic-license-notice').textContent).toContain('Licencia caduca en 10/10/2026')
    account={license_warning_due:false,license_expires_on:'2027-10-10'}
    await act(async()=>window.dispatchEvent(new Event('focus')))
    expect(node.textContent).toBe('')
  } finally {await act(async()=>root.unmount());node.remove();vi.unstubAllGlobals()}
})
