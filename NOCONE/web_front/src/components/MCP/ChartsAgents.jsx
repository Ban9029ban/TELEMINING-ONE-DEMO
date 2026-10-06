import React, { useRef } from "react";
import {
  ResponsiveContainer,
  CartesianGrid,
  Tooltip,
  Legend,
  XAxis,
  YAxis,
  BarChart,
  Bar,
  LineChart,
  Line } from
"recharts";

import {
  captureElementAsPng,
  downloadCsv,
  downloadDataUrl,
  slugifyFilename } from
"../../utils/exportHelpers";

const formatCell = (value) => {
  if (value === null || value === undefined) return "Sin dato";
  if (typeof value === "boolean") return value ? "Si" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const ChartsAgents = ({ charts }) => {
  const chartRefs = useRef({});

  if (!Array.isArray(charts) || charts.length === 0) {
    return null;
  }

  return (
    <div className="mcp-chart-stack">
      {charts.map((chart, index) => {
        const rows = Array.isArray(chart?.data?.rows) ? chart.data.rows : [];
        const safeName = slugifyFilename(chart?.title || `grafico_${index + 1}`);
        const columns = Array.from(
          rows.reduce((set, row) => {
            Object.keys(row || {}).forEach((key) => set.add(key));
            return set;
          }, new Set())
        );

        const handlePngExport = async () => {
          const image = await captureElementAsPng(chartRefs.current?.[safeName]);
          if (!image) return;
          downloadDataUrl(`${safeName}.png`, image);
        };

        return (
          <section key={`${chart.title || "chart"}-${index}`} className="mcp-chart-card">
            <div className="mcp-chart-card-header">
              <div>
                <h4>{chart.title || "Gráfico"}</h4>
                <p>{rows.length ? `${rows.length} filas visibles` : "Sin datos para graficar"}</p>
              </div>
              <div className="mcp-table-toolbar-actions">
                <button type="button" className="mcp-ghost-button" onClick={handlePngExport}>
                  Exportar PNG
                </button>
                <button
                  type="button"
                  className="mcp-ghost-button"
                  disabled={!rows.length}
                  onClick={() => downloadCsv(`${safeName}.csv`, rows)}>

                  Exportar CSV
                </button>
              </div>
            </div>

            <div className="mcp-chart-card-body">
              <div
                ref={(node) => {
                  chartRefs.current[safeName] = node;
                }}
                className="mcp-chart-plot">

                {renderChart(chart)}
              </div>

              {rows.length ?
              <div className="mcp-chart-data">
                  <div className="mcp-table-scroll">
                    <table className="mcp-table">
                      <thead>
                        <tr>
                          {columns.map((column) =>
                        <th key={column}>{column}</th>
                        )}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, rowIndex) =>
                      <tr key={`${safeName}-${rowIndex}`}>
                            {columns.map((column) =>
                        <td key={`${column}-${rowIndex}`}>{formatCell(row[column])}</td>
                        )}
                          </tr>
                      )}
                      </tbody>
                    </table>
                  </div>
                </div> :
              null}
            </div>
          </section>);

      })}
    </div>);

};

function renderChart(chart) {
  const rows = chart?.data?.rows || [];
  const config = chart?.config || {};
  const type = (chart?.type || "").toLowerCase();
  const xKey = config.x;
  const yKey = config.y;

  if (!rows.length || !xKey || !yKey) {
    return <div className="mcp-chart-empty">No hay datos suficientes para graficar.</div>;
  }

  const normalized = rows.map((row) => ({
    ...row,
    _x: row[xKey],
    _y: Number(row[yKey]) || 0
  }));

  if (type === "bar") {
    return (
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={normalized}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(75, 85, 99, 0.15)" />
          <XAxis dataKey="_x" tick={{ fill: "#5b657a", fontSize: 12 }} />
          <YAxis tick={{ fill: "#5b657a", fontSize: 12 }} />
          <Tooltip />
          <Legend />
          <Bar dataKey="_y" name={yKey} fill="#5a67f2" radius={[8, 8, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>);

  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={normalized}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(75, 85, 99, 0.15)" />
        <XAxis dataKey="_x" tick={{ fill: "#5b657a", fontSize: 12 }} />
        <YAxis tick={{ fill: "#5b657a", fontSize: 12 }} />
        <Tooltip />
        <Legend />
        <Line type="monotone" dataKey="_y" name={yKey} stroke="#5a67f2" strokeWidth={3} dot={false} />
      </LineChart>
    </ResponsiveContainer>);

}

export default ChartsAgents;
