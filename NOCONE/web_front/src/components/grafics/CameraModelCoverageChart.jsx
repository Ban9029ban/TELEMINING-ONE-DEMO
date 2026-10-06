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

const CameraModelCoverageChart = ({ data }) => {
  if (!Array.isArray(data) || data.length === 0) {
    return <div className="w-full text-sm text-slate-500">Sin modelos IA disponibles para graficar.</div>;
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 18, left: 0, bottom: 46 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="modelo_corto" angle={-18} textAnchor="end" interval={0} height={58} />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Legend />
          <Bar dataKey="analiticas_en_vivo" name="Analíticas en vivo" fill="#2563eb" radius={[6, 6, 0, 0]} />
          <Bar dataKey="analiticas_pendientes" name="Pendientes" fill="#f59e0b" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>);

};

export default CameraModelCoverageChart;