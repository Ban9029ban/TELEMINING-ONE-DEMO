import React from 'react'
export default function SismicoStateTable({ items = [] }) {
  return (
    <section className="panel-card">
      <h3>Estados de polígonos</h3>
      <div className="state-table">
        <div className="state-row head">
          <span>Polígono</span>
          <span>Estado</span>
          <span>Lectura</span>
          <span>Observado</span>
        </div>
        {items.map((item) => (
          <div key={item.object_code} className={`state-row state-${item.state_code}`}>
            <span>{item.object_name}</span>
            <span>{item.state_code}</span>
            <span>{item.label}</span>
            <span>{item.observed_at ? new Date(item.observed_at).toLocaleTimeString() : '—'}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
