import { VisualLayoutBoundary } from './components/visual/VisualLayout'

import React, { useEffect, useMemo, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { isSeismicDashboard } from './utils/seismicDashboardRoutes'
import Sidebar from './components/Sidebar'
import Header from './components/Header'
import EnvironmentBanner from './components/EnvironmentBanner'
import './styles.multi-env.css'
import { useTheme } from './context/ThemeContext'
import SismicoHomePage from './pages/SismicoHomePage'
import SismicoMenuAccess from './components/SismicoMenuAccess'
import DiamantePage from './pages/DiamantePage'
import AndesitaPage from './pages/AndesitaPage'
import AndesNortePage from './pages/AndesNortePage'
import DetNpAndesNortePage from './pages/DetNpAndesNortePage'
import DetUclAndesNortePage from './pages/DetUclAndesNortePage'
import PilarNortePage from './pages/PilarNortePage'
import EsmeraldaPage from './pages/EsmeraldaPage'
import TunelCorreaPage from './pages/TunelCorreaPage'
import ZonasDetPage from './pages/ZonasDetPage'
import AgentsPage from './pages/AgentsPage'
import ProductivityPage from './pages/ProductivityPage'
import SalaSicPage from './pages/SalaSicPage'
import ConfigurationPage from './pages/SemaforosConfigPage'
import SismicoDiagnosticsPage from './pages/SismicoDiagnosticsPage'
import LoginPage from './pages/LoginPage'
import ProtectedRoute from './components/ProtectedRoute'
import CrossMapPolygonNotifications from './components/sismico/CrossMapPolygonNotifications'
import SismicoAlertMiniMap from './components/sismico/SismicoAlertMiniMap'
import { SismicoViewProvider } from './context/SismicoViewContext'

function Placeholder({ title }) {
  return <div className="panel-card page-screen full-panel"><h3>{title}</h3><p>Módulo Disponible en TMOne.</p></div>
}

export default function App() {
  const { toggleTheme } = useTheme()
  const location = useLocation()
  const [isCollapsed, setIsCollapsed] = useState(() => localStorage.getItem('tm_sidebar_collapsed') === 'true')

  useEffect(() => {
    localStorage.setItem('tm_sidebar_collapsed', String(isCollapsed))
  }, [isCollapsed])

  const isWallMode = useMemo(() => new URLSearchParams(location.search).has('pantalla'), [location.search])
  const isEmbedMode = useMemo(() => new URLSearchParams(location.search).get('embed') === '1', [location.search])
  const isLoginPage = location.pathname === '/login'
  const isSismicoModule = location.pathname.startsWith('/legacy-sismico')
  const isSismicoMapMenu = location.pathname.replace(/\/+$/, '') === '/legacy-sismico'
  const isSalaSicChild = useMemo(() => new URLSearchParams(location.search).get('sic_lock') === '1', [location.search])
  const showSismicoAlertOverlay = isSismicoModule && !isSismicoMapMenu && !isSalaSicChild
  const effectiveCollapsed = isWallMode ? true : isCollapsed
  const showShell = !isLoginPage && !isEmbedMode

  return (
    <div className={`tm-shell ${effectiveCollapsed ? 'collapsed' : ''} ${isWallMode ? 'wall-mode' : ''} ${isEmbedMode ? 'embed-mode' : ''}`}>
      {showShell ? <Sidebar isCollapsed={effectiveCollapsed} onToggle={() => setIsCollapsed(v => !v)} onToggleTheme={toggleTheme} wallMode={isWallMode} /> : null}
      <main className={`tm-content ${effectiveCollapsed ? 'collapsed' : ''} ${isWallMode ? 'wall-mode' : ''} ${isLoginPage ? 'full-login' : ''} ${isEmbedMode ? 'full-embed' : ''}`}>
        <SismicoViewProvider alertsEnabled={showSismicoAlertOverlay}>
          <VisualLayoutBoundary>
          {!isLoginPage && !isSalaSicChild && <Header showLicenseNotice={isSeismicDashboard(location.pathname)} isCollapsed={effectiveCollapsed || isEmbedMode} onToggleCollapse={() => setIsCollapsed(v => !v)} />}
          {showShell && !isWallMode && <EnvironmentBanner />}
          <section className={`tm-body ${isWallMode ? 'wall-mode' : ''} ${isLoginPage ? 'login-only' : ''} ${isEmbedMode ? 'embed-only' : ''}`}>
            <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<Navigate to="/legacy-sismico" />} />
            <Route path="/legacy-sismico" element={<SismicoMenuAccess><SismicoHomePage /></SismicoMenuAccess>} />
            <Route path="/legacy-sismico/diamante" element={<DiamantePage />} />
            <Route path="/legacy-sismico/andesita" element={<AndesitaPage />} />
            <Route path="/legacy-sismico/andes-norte" element={<AndesNortePage />} />
            <Route path="/legacy-sismico/det-np-andes-norte" element={<DetNpAndesNortePage />} />
            <Route path="/legacy-sismico/det-ucl-andes-norte" element={<DetUclAndesNortePage />} />
            <Route path="/legacy-sismico/andes-norte-tunel-correa" element={<TunelCorreaPage />} />
            <Route path="/legacy-sismico/pilar-norte" element={<PilarNortePage />} />
            <Route path="/legacy-sismico/esmeralda" element={<EsmeraldaPage />} />
            <Route path="/zonas-det" element={<ZonasDetPage />} />
            <Route path="/agentes-ia" element={<AgentsPage />} />
            <Route path="/productividad" element={<ProductivityPage />} />
            <Route path="/legacy-sismico/sala-sic" element={<SalaSicPage />} />
            <Route path="/tracking" element={<Placeholder title="Tracking" />} />
            <Route path="/access" element={<Placeholder title="Acceso" />} />
            <Route path="/cameras" element={<Placeholder title="Cámaras" />} />
            <Route path="/control-vial" element={<Placeholder title="Semáforos control vial" />} />
            <Route path="/configuracion" element={<ProtectedRoute><ConfigurationPage /></ProtectedRoute>} />
            <Route path="/legacy-sismico/diagnostico" element={<ProtectedRoute><SismicoDiagnosticsPage /></ProtectedRoute>} />
            </Routes>
          </section>
          {showSismicoAlertOverlay ? <CrossMapPolygonNotifications /> : null}
          {showSismicoAlertOverlay ? <SismicoAlertMiniMap /> : null}
          </VisualLayoutBoundary>
        </SismicoViewProvider>
      </main>
    </div>
  )
}
