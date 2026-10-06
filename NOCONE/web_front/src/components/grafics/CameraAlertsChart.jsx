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

const CameraAlertsChart = ({ data }) => {
  // data: [{ tipo, cantidad }]
  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 10, right: 20, left: 0, bottom: 50 }}>
          
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="tipo"
            angle={-30}
            textAnchor="end"
            interval={0}
            height={60} />
          
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Legend />
          <Bar dataKey="cantidad" name="Alertas" fill="#3b82f6" />
        </BarChart>
      </ResponsiveContainer>
    </div>);

};

export default CameraAlertsChart;