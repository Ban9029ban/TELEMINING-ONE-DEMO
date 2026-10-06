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

const CameraAlertFamiliesChart = ({ data }) => {
  if (!Array.isArray(data) || data.length === 0) {
    return <div className="w-full text-sm text-slate-500">Sin alertas agrupadas por familia analítica.</div>;
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 18, left: 0, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="familia" />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Legend />
          <Bar dataKey="alto_riesgo" name="Alto riesgo" stackId="risk" fill="#ef4444" />
          <Bar dataKey="medio_bajo" name="Medio o bajo" stackId="risk" fill="#f59e0b" />
        </BarChart>
      </ResponsiveContainer>
    </div>);

};

export default CameraAlertFamiliesChart;