import React from 'react'

function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000)
}

function slugify(value) {
  return String(value || 'tabla')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function csvEscape(value) {
  const raw = String(value ?? '')
  if (/[",\n;]/.test(raw)) {
    return `"${raw.replaceAll('"', '""')}"`
  }
  return raw
}

function exportTableCsv(table) {
  const columns = Array.isArray(table?.columns) ? table.columns : []
  const rows = Array.isArray(table?.rows) ? table.rows : []
  const header = columns.map((column) => column?.label || column?.key || '')
  const body = rows.map((row) => columns.map((column) => row?.[column?.key] ?? ''))
  const content = `\uFEFF${[header, ...body].map((line) => line.map(csvEscape).join(',')).join('\r\n')}`
  const filename = `agente_${slugify(table?.key || table?.title)}_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`
  downloadBlob(new Blob([content], { type: 'text/csv;charset=utf-8;' }), filename)
}

function AgentDataTableCard({ table }) {
  const columns = Array.isArray(table?.columns) ? table.columns : []
  const rows = Array.isArray(table?.rows) ? table.rows : []

  return (
    <section className="agent-table-card">
      <div className="agent-table-head">
        <div>
          <h4>{table?.title || 'Tabla exportable'}</h4>
          {table?.subtitle ? <p>{table.subtitle}</p> : null}
        </div>
        <button
          type="button"
          className="productivity-export-btn secondary"
          onClick={() => exportTableCsv(table)}
        >
          Exportar CSV
        </button>
      </div>
      <div className="agent-table-wrap">
        <table className="agent-data-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key || column.label}>{column.label || column.key}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, rowIndex) => (
                <tr key={`${table?.key || 'table'}-${rowIndex}`}>
                  {columns.map((column) => (
                    <td key={`${column.key}-${rowIndex}`}>{String(row?.[column.key] ?? '-')}</td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={Math.max(columns.length, 1)}>No hay datos disponibles.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function AgentDataTables({ tables = [] }) {
  if (!Array.isArray(tables) || !tables.length) return null
  return (
    <div className="agent-table-grid">
      {tables.map((table) => (
        <AgentDataTableCard key={table?.key || table?.title} table={table} />
      ))}
    </div>
  )
}
