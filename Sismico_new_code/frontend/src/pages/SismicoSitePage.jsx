import ScreenLicenseGate from '../components/ScreenLicenseGate'
import React from 'react'
import EmergencyButton from '../components/EmergencyButton'
import SismicoAlertsPanel from '../components/sismico/SismicoAlertsPanel'
import SismicoLastSync from '../components/sismico/SismicoLastSync'
import SismicoLegend from '../components/sismico/SismicoLegend'
import SismicoMapCanvas from '../components/sismico/SismicoMapCanvas'
import SemaforoControlPanel from '../components/sismico/SemaforoControlPanel'
import SismicoSourceStatus from '../components/sismico/SismicoSourceStatus'
import SismicoStateTable from '../components/sismico/SismicoStateTable'
import { useSismicoSite } from '../hooks/useSismicoSite'

export default function SismicoSitePage({ siteCode }) {
  const { detail, state, stateMap, loading, runningPolling, error, refresh, runManualPolling, accessDenied, licenseInfo } = useSismicoSite(siteCode)

  if (loading && !detail) return <div className="panel-card page-screen full-panel"><p>Cargando núcleo sísmico reusable…</p></div>
  if (error && !detail) return <div className="panel-card page-screen full-panel"><p>Error cargando {siteCode}: {error}</p></div>

  if (accessDenied) return <ScreenLicenseGate licenseInfo={licenseInfo} />

  return (
    <div className="page-screen">
      <div className="legacy-toolbar">
        <EmergencyButton />
        <button className="pill-btn" onClick={refresh}>Refrescar</button>
        <button className="pill-btn" onClick={runManualPolling} disabled={runningPolling}>
          {runningPolling ? 'Leyendo fuentes externas…' : 'Forzar lectura backend'}
        </button>
      </div>

      <div className="sismico-generic-layout">
        <section className="panel-card map-panel-wide">
          <h3>{detail?.site?.name || siteCode}</h3>
          <p className="site-description">{detail?.site?.description || 'Sin descripción'}</p>
          <SismicoMapCanvas map={detail?.map} objects={detail?.objects || []} stateMap={stateMap} />
        </section>

        <div className="sismico-side-stack">
          <SismicoSourceStatus
            online={!!state?.external_sources_online}
            sourceStatus={state?.source_status}
            message={state?.source_message}
            effectiveSourceStatus={state?.last_effective_source_status}
            effectiveRecordAt={state?.last_effective_record_at}
          />
          <SismicoLastSync value={state?.last_sync_at} />
          <SemaforoControlPanel siteCode={siteCode} />
          <SismicoAlertsPanel items={state?.alerts || []} />
        </div>

        <SismicoStateTable items={state?.object_states || []} />
        <SismicoLegend items={detail?.state_catalog || []} />
      </div>
    </div>
  )
}
