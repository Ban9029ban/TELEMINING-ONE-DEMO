import { useAuth } from '../context/AuthContext'
import React, { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  BsArrowBarRight, BsArrowBarLeft, BsHouseDoorFill, BsPieChartFill,
  BsLightbulbFill, BsMapFill, BsDoorOpenFill, BsCameraVideoFill, BsGearFill, BsCpuFill, BsClipboardPulse
} from 'react-icons/bs'
import { GiMountains } from 'react-icons/gi'
import { FaTrafficLight } from 'react-icons/fa'
import './Sidebar.css'

const items = [
  { to: '/tracking', label: 'Tracking', icon: BsHouseDoorFill },
  { to: '/access', label: 'Acceso', icon: BsDoorOpenFill },
  { to: '/cameras', label: 'Cámaras', icon: BsCameraVideoFill },
  { to: '/legacy-sismico', label: 'Semáforos sísmicos', icon: GiMountains, starts: true },
  { to: '/control-vial', label: 'Semáforos control vial', icon: FaTrafficLight },
  { to: '/productividad', label: 'Productividad', icon: BsPieChartFill },
  { to: '/agentes-ia', label: 'Agentes IA', icon: BsCpuFill },
  { to: '/configuracion', label: 'Configuración', icon: BsGearFill },
]

function useCompactMode() {
  const getValue = () => window.innerWidth <= 1100
  const [compact, setCompact] = useState(getValue)

  useEffect(() => {
    const onResize = () => setCompact(getValue())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return compact
}

export default function Sidebar({ isCollapsed, onToggle, onToggleTheme, wallMode = false }) {
  const { user } = useAuth()
  const seismicTarget = '/legacy-sismico'
  const location = useLocation()
  const compact = useCompactMode()
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    if (!compact) setMobileOpen(false)
  }, [compact])

  useEffect(() => {
    if (compact) setMobileOpen(false)
  }, [location.pathname, compact])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = compact && mobileOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = prev
    }
  }, [compact, mobileOpen])

  const isActive = (item) => item.starts ? location.pathname.startsWith(item.to) : location.pathname === item.to

  const asideClass = [
    'tm-sidebar',
    isCollapsed ? 'collapsed' : '',
    wallMode ? 'wall-mode' : '',
    compact ? 'tm-sidebar-mobile' : '',
    mobileOpen ? 'is-open' : '',
  ].filter(Boolean).join(' ')

  const handleTopToggle = () => {
    if (compact) {
      setMobileOpen(v => !v)
      return
    }
    onToggle?.()
  }

  return (
    <>
      {compact && !wallMode && !mobileOpen && (
        <button className="tm-mobile-menu-btn" onClick={() => setMobileOpen(true)} aria-label="Abrir menú">
          <span />
          <span />
          <span />
        </button>
      )}

      {compact && mobileOpen && !wallMode && (
        <button className="tm-mobile-menu-backdrop" onClick={() => setMobileOpen(false)} aria-label="Cerrar menú" />
      )}

      <aside className={asideClass}>
        <div>
          <div className="tm-brand-row">
            {!isCollapsed && <div className="tm-brand">TM One</div>}
            {!wallMode && (
              <button onClick={handleTopToggle} className="sidebar-toggle" aria-label="Colapsar menú">
                {compact
                  ? <BsArrowBarLeft size={22} />
                  : (isCollapsed ? <BsArrowBarRight size={22} /> : <BsArrowBarLeft size={22} />)}
              </button>
            )}
          </div>

          <nav className="tm-nav">
            {items.map((item) => {
              const Icon = item.icon
              return (
                <Link key={item.to} to={item.to === '/legacy-sismico' ? seismicTarget : item.to} className={`tm-nav-item ${isActive(item) ? 'active' : ''}`} title={item.label}>
                  <Icon size={22} />
                  {!isCollapsed && <span>{item.label}</span>}
                </Link>
              )
            })}
          </nav>
        </div>

        <div className="tm-nav bottom">
          <button className="tm-nav-item" onClick={onToggleTheme} title="Tema" type="button">
            <BsLightbulbFill size={22} />
            {!isCollapsed && <span>Tema</span>}
          </button>
          <Link to="/zonas-det" className={`tm-nav-item ${location.pathname === '/zonas-det' ? 'active' : ''}`} title="Zonas DET">
            <BsMapFill size={22} />
            {!isCollapsed && <span>Zonas DET</span>}
          </Link>
        </div>
      </aside>
    </>
  )
}
