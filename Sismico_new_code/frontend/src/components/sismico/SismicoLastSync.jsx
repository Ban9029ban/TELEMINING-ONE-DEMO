import React from 'react'
export default function SismicoLastSync({ value }) {
  return (
    <section className="panel-card">
      <h3>Última sincronización</h3>
      <p>{value ? new Date(value).toLocaleString() : 'Sin sincronización'}</p>
    </section>
  )
}
