import React, { useMemo, useState } from "react";

import { API_URL } from "../../api-config";
import { downloadCsv, slugifyFilename } from "../../utils/exportHelpers";

const formatCell = (value) => {
  if (value === null || value === undefined) return "Sin dato";
  if (typeof value === "boolean") return value ? "Si" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

function FilterableTableCard({ exportToken, table }) {
  const [searchTerm, setSearchTerm] = useState("");
  const normalizedSearch = searchTerm.trim().toLowerCase();

  const visibleRows = useMemo(() => {
    const rows = Array.isArray(table.rows) ? table.rows : [];
    if (!normalizedSearch) return rows;

    return rows.filter((row) =>
    (table.columns || []).
    map((column) => formatCell(row[column])).
    join(" ").
    toLowerCase().
    includes(normalizedSearch)
    );
  }, [normalizedSearch, table.columns, table.rows]);

  return (
    <section className="mcp-table-card">
      <div className="mcp-table-card-header">
        <div>
          <h4>{table.title || "Tabla"}</h4>
          <p>{visibleRows.length ? `${visibleRows.length} filas visibles` : "Sin filas"}</p>
        </div>
        <div className="mcp-table-toolbar-actions">
          <button
            type="button"
            className="mcp-ghost-button"
            disabled={!visibleRows.length}
            onClick={() =>
            downloadCsv(
              `${slugifyFilename(table.title || "tabla_agente")}.csv`,
              visibleRows || []
            )
            }>

            CSV visible
          </button>
        </div>
      </div>

      <div className="mcp-table-search">
        <input
          type="text"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Buscar dentro de la tabla..." />

      </div>

      <div className="mcp-table-scroll">
        <table className="mcp-table">
          <thead>
            <tr>
              {(table.columns || []).map((column) =>
              <th key={column}>{column}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length ?
            visibleRows.map((row, rowIndex) =>
            <tr key={rowIndex}>
                  {(table.columns || []).map((column) =>
              <td key={`${column}-${rowIndex}`}>{formatCell(row[column])}</td>
              )}
                </tr>
            ) :

            <tr>
                <td colSpan={Math.max(table.columns?.length || 1, 1)} className="mcp-table-empty">
                  {normalizedSearch ?
                "No hay coincidencias para el filtro aplicado." :
                "No hay datos disponibles para esta tabla."}
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>);

}

const TablesAgents = ({ tables, exportToken }) => {
  if (!Array.isArray(tables) || tables.length === 0) {
    return null;
  }

  const handleExport = (kind) => {
    if (!exportToken) return;
    const url = `${API_URL}/mcp/export-${kind}/${encodeURIComponent(exportToken)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="mcp-table-stack">
      <div className="mcp-table-toolbar">
        <span>Salida estructurada lista para exportar</span>
        <div className="mcp-table-toolbar-actions">
          <button
            type="button"
            className="mcp-ghost-button"
            disabled={!exportToken}
            onClick={() => handleExport("csv")}>

            Exportar CSV
          </button>
          <button
            type="button"
            className="mcp-ghost-button"
            disabled={!exportToken}
            onClick={() => handleExport("excel")}>

            Exportar Excel
          </button>
          <button
            type="button"
            className="mcp-ghost-button"
            disabled={!exportToken}
            onClick={() => handleExport("pdf")}>

            Exportar PDF
          </button>
        </div>
      </div>

      {tables.map((table, index) =>
      <FilterableTableCard
        key={`${table.title || "tabla"}-${index}`}
        exportToken={exportToken}
        table={table} />

      )}
    </div>);

};

export default TablesAgents;
