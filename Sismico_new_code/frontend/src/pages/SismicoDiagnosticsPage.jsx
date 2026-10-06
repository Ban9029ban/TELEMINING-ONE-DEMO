import React, { useEffect, useMemo, useState } from 'react'
import { getSismicoDiagnostics, getSismicoSites } from '../services/sismicoApi'

function fmtDate(value) {
  if (!value) return '—'
  try { return new Date(value).toLocaleString() } catch { return String(value) }
}

export default function SismicoDiagnosticsPage() {
  const [sites, setSites] = useState([])
  const [siteCode, setSiteCode] = useState('diamante')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)

  useEffect(() => {
    getSismicoSites().then((res) => {
      const items = res?.items || []
      setSites(items)
      if (items.length && !items.some((x) => x.code === siteCode)) setSiteCode(items[0].code)
    }).catch(() => undefined)
  }, [])

  const load = async (persist = false) => {
    setLoading(true)
    setError('')
    try {
      const res = await getSismicoDiagnostics(siteCode, { liveFetch: true, persist })
      setData(res)
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (siteCode) load(false)
  }, [siteCode])

  const summary = useMemo(() => {
    const mapped = data?.object_mappings?.filter((x) => x.mapped).length || 0
    const missing = data?.missing_polygons?.length || 0
    const unmappedObjects = data?.object_mappings?.filter((x) => !x.mapped).length || 0
    return { mapped, missing, unmappedObjects }
  }, [data])

  return (
    <div className="panel-card page-screen full-panel" style={{ padding: 20 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Diagnóstico legacy vs arquitectura nueva</h2>
        <select value={siteCode} onChange={(e) => setSiteCode(e.target.value)} style={{ minWidth: 220, padding: 8 }}>
          {sites.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
        </select>
        <button onClick={() => load(false)} disabled={loading}>Consultar</button>
        <button onClick={() => load(true)} disabled={loading}>Consultar y persistir</button>
      </div>

      {error && <div style={{ color: '#ff6b6b', marginBottom: 12 }}>{error}</div>}
      {!data && !error && <div>Cargando diagnóstico…</div>}

      {data && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="panel-card" style={{ padding: 16 }}>
            <div><strong>Sitio:</strong> {data.site_name} ({data.site_code})</div>
            <div><strong>Legacy:</strong> {data.legacy_page || '—'}</div>
            <div><strong>Descripción:</strong> {data.legacy_description || '—'}</div>
            <div><strong>Estado fuentes:</strong> {data.source_status}</div>
            <div><strong>Inicio:</strong> {fmtDate(data.started_at)} | <strong>Fin:</strong> {fmtDate(data.finished_at)}</div>
            <div><strong>Filas capturadas:</strong> {data.rows_total} | <strong>Objetos mapeados:</strong> {summary.mapped}</div>
            <div><strong>Polígonos faltantes:</strong> {summary.missing} | <strong>Objetos sin mapeo:</strong> {summary.unmappedObjects}</div>
            {data.error_message && <div style={{ color: '#ff6b6b' }}><strong>Error:</strong> {data.error_message}</div>}
          </div>

          <div className="panel-card" style={{ padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>Detalle por endpoint</h3>
            {(data.endpoints || []).map((ep) => (
              <div key={ep.endpoint_code} style={{ borderTop: '1px solid rgba(255,255,255,.12)', paddingTop: 12, marginTop: 12 }}>
                <div><strong>{ep.endpoint_name}</strong> ({ep.endpoint_code})</div>
                <div>{ep.endpoint_url}</div>
                <div>Parser: {ep.parser_type} | Estado: {ep.status} | Filas: {ep.rows_captured}</div>
                {ep.error_message && <div style={{ color: '#ff6b6b' }}>{ep.error_message}</div>}
                <div style={{ overflowX: 'auto', marginTop: 8 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th align="left">Polígono esperado</th>
                        <th align="left">Fila capturada</th>
                        <th align="left">Estado</th>
                        <th align="left">Modo</th>
                        <th align="left">Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(ep.matches || []).map((m, idx) => (
                        <tr key={`${ep.endpoint_code}-${idx}`}>
                          <td>{m.expected_polygon}</td>
                          <td>{m.matched_row_name || '—'}</td>
                          <td>{m.operational_state || '—'}</td>
                          <td>{m.source_mode}</td>
                          <td>{m.score ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>

          <div className="panel-card" style={{ padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>Objetos del mapa nuevo</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th align="left">Objeto</th>
                    <th align="left">Código</th>
                    <th align="left">Mapeado</th>
                    <th align="left">Polígono legacy</th>
                    <th align="left">Fuente</th>
                    <th align="left">Estado</th>
                    <th align="left">Notas</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.object_mappings || []).map((item) => (
                    <tr key={item.object_code}>
                      <td>{item.object_name}</td>
                      <td>{item.object_code}</td>
                      <td>{item.mapped ? 'Sí' : 'No'}</td>
                      <td>{item.expected_polygon || '—'}</td>
                      <td>{item.endpoint_name || '—'}</td>
                      <td>{item.operational_state || '—'}</td>
                      <td>{item.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel-card" style={{ padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>Faltantes para prueba Codelco</h3>
            <div><strong>Polígonos capturados sin objeto en mapa nuevo</strong></div>
            <ul>
              {(data.missing_polygons || []).map((item, idx) => (
                <li key={`${item.polygon_name}-${idx}`}>{item.polygon_name} / {item.operational_state || '—'} / {item.reason}</li>
              ))}
            </ul>
            <div><strong>Objetos del mapa nuevo sin alias/match</strong></div>
            <ul>
              {(data.missing_aliases || []).map((item, idx) => <li key={`${item}-${idx}`}>{item}</li>)}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
