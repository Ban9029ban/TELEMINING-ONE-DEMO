import React from "react";
import {
  ResponsiveContainer,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Bar } from
"recharts";

const CameraAnalyticsCoverageChart = ({ data }) => {
  if (!Array.isArray(data) || data.length === 0) {
    return <div className="w-full text-sm text-slate-500">Sin hallazgos persistidos para graficar.</div>;
  }

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 10, right: 18, left: 16, bottom: 0 }}>

          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" allowDecimals={false} />
          <YAxis type="category" dataKey="group" width={96} />
          <Tooltip />
          <Legend />
          <Bar dataKey="activos" name="Activos" fill="#2563eb" radius={[0, 6, 6, 0]} />
          <Bar dataKey="acumulados" name="Acumulados" fill="#7c3aed" radius={[0, 6, 6, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>);

};

export default CameraAnalyticsCoverageChart;