import React, { useState } from 'react'
import { executeSemaforos } from '../../services/sismicoApi'

export default function SemaforoControlPanel({ siteCode }) {
  const [lastResult, setLastResult] = useState(null)
  const [running, setRunning] = useState(false)

  async function runAction(action) {
    setRunning(true)
    try {
      const result = await executeSemaforos({ site_code: siteCode, action, dry_run: true, requested_by: 'panel_test' })
      setLastResult(result)
    } catch (error) {
      setLastResult({ ok: false, action, results: [{ device_code: 'n/a', status: 'error', stderr: error?.message || String(error) }] })
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className="panel-card">
      <h3>Semáforos viales</h3>
      <div className="pill-row">
        <button className="pill-btn red" disabled={running} onClick={() => runAction('rojo')}>Probar rojo (dry-run)</button>
        <button className="pill-btn green" disabled={running} onClick={() => runAction('verde')}>Probar verde (dry-run)</button>
      </div>
      {lastResult ? (
        <div className="alerts-list">
          {lastResult.results?.map((item, idx) => (
            <div key={`${item.device_code || item.device}-${idx}`} className="alert-row level-low">
              <strong>{item.device_code || item.device}</strong>
              <span>{item.mode || item.status}</span>
            </div>
          ))}
        </div>
      ) : <p>Configurable por IP, tags, intervalo y habilitación desde backend.</p>}
    </section>
  )
}
