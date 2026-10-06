import React from 'react'
export default function SismicoLegend({ items = [] }) {
  return (
    <section className="panel-card">
      <h3>Leyenda</h3>
      <div className="legend-list">
        {items.map((item) => (
          <div key={item.code} className="legend-item">
            <span className="legend-dot" style={{ background: item.color }} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
