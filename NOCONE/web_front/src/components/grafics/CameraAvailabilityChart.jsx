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

const CameraAvailabilityChart = ({ data }) => {
  // data: [{ nivel, online, offline, mantenimiento }]
  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="nivel" />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Legend />
          <Bar dataKey="online" name="Online" fill="#22c55e" />
          <Bar dataKey="offline" name="Offline" fill="#ef4444" />
          <Bar dataKey="mantenimiento" name="Mantencion" fill="#f97316" />
        </BarChart>
      </ResponsiveContainer>
    </div>);

};

export default CameraAvailabilityChart;