import React from 'react'
export default function SismicoAlertsPanel({ items = [] }) {
  return (
    <section className="panel-card">
      <h3>Alertas activas</h3>
      {!items.length ? <p>Sin alertas activas.</p> : (
        <div className="alerts-list">
          {items.map((item) => (
            <div key={item.code} className={`alert-row level-${item.level}`}>
              <strong>{item.level?.toUpperCase()}</strong>
              <span>{item.message}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
