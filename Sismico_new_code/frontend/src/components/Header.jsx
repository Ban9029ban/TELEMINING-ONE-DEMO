
import React from 'react'
import LicenseExpiryNotice from './LicenseExpiryNotice'
import { VisualLayoutHeaderSlot } from './visual/VisualLayout'
import { BsChevronUp, BsChevronDown } from 'react-icons/bs'
import { img } from '../config/assets'
import { getRuntimeConfig } from '../config/runtimeConfig'
import { useAuth } from '../context/AuthContext'

export default function Header({ isCollapsed = false, onToggleCollapse = () => {}, showLicenseNotice = false }) {
  const cfg = getRuntimeConfig()
  const { user, auth, isAuthenticated, logout } = useAuth()
  return (
    <header className={`tm-header ${isCollapsed ? 'collapsed' : ''}`}>
      {showLicenseNotice && import.meta.env.VITE_VISUAL_API_ROOT && <LicenseExpiryNotice endpoint={`${import.meta.env.VITE_VISUAL_API_ROOT}/auth/me`} token={auth?.token} />}
      <button className="header-collapse-btn" onClick={onToggleCollapse}>
        {isCollapsed ? <BsChevronDown size={18} /> : <BsChevronUp size={18} />}
      </button>
      {isCollapsed && <VisualLayoutHeaderSlot />}
      {!isCollapsed && (
        <>
          <div className="tm-header-side left">
            <div className="tm-date">{new Date().toLocaleString('es-CL')}</div>
            <div className="tm-env-tag">{cfg.environment}</div>
          </div>

          <div className="tm-header-center">
            <img src={img.tele} alt="Telemining" className="tm-logo" />
          </div>

          <div className="tm-header-side right">
            <VisualLayoutHeaderSlot />
            {isAuthenticated ? (
              <div className="tm-user-block">
                <div className="tm-user">
                  <strong>{user?.full_name || user?.username || 'Usuario'}</strong>
                  <span>{user?.username || '-'}</span>
                  <span>{user?.role_code || '-'}</span>
                </div>
                <button className="mini-btn" onClick={logout}>Salir</button>
              </div>
            ) : (
              <div className="tm-user"><strong>Invitado</strong><span>{cfg.appName}</span></div>
            )}
          </div>
        </>
      )}
    </header>
  )
}
