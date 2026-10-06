// src/components/grafics/CamerasInterpretationPanel.jsx
import React from "react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from "recharts";

const COLORS = ["#22c55e", "#ef4444", "#f97316"];

const CamerasInterpretationPanel = ({ availability, alerts }) => {
  // Resumen de disponibilidad global
  let online = 0;
  let offline = 0;
  let mantencion = 0;

  (availability || []).forEach((row) => {
    online += row.online || 0;
    offline += row.offline || 0;
    mantencion += row.mantenimiento || 0;
  });

  const pieData = [
    { name: "Online", value: online },
    { name: "Offline", value: offline },
    { name: "Mantención", value: mantencion },
  ];

  const totalCams = online + offline + mantencion;
  const uptime =
    totalCams > 0 ? Math.round((online / totalCams) * 100) : 0;

  const totalAlerts = (alerts || []).reduce(
    (s, r) => s + (r.cantidad || 0),
    0
  );

  return (
    <div className="bg-white rounded shadow p-4 mt-4">
      <h2 className="text-lg font-semibold mb-2">
        Interpretación operacional – Cámaras
      </h2>
      <p className="text-xs text-gray-600 mb-3">
        Nivel de cobertura efectiva de CCTV y volumen de alertas de analítica,
        para focalizar esfuerzos de mantención y seguridad en los puntos más
        críticos.
      </p>

      {/* Gráfico de disponibilidad global */}
      <div className="w-full h-64 mb-4">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              outerRadius={80}
              label
            >
              {pieData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={COLORS[index % COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Tabla resumen */}
      <div className="overflow-x-auto mb-3">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="bg-gray-100">
              <th className="px-2 py-1 text-left">Métrica</th>
              <th className="px-2 py-1 text-left">Valor</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t">
              <td className="px-2 py-1">Cámaras totales</td>
              <td className="px-2 py-1">{totalCams}</td>
            </tr>
            <tr className="border-t">
              <td className="px-2 py-1">Disponibilidad de CCTV</td>
              <td className="px-2 py-1">{uptime}% online</td>
            </tr>
            <tr className="border-t">
              <td className="px-2 py-1">Alertas de analítica registradas</td>
              <td className="px-2 py-1">{totalAlerts}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Conclusión */}
      <p className="text-xs text-gray-700">
        Una alta disponibilidad de CCTV permite respaldar investigaciones de
        incidentes y monitorear comportamientos de riesgo. Si la proporción de
        cámaras offline o en mantención es elevada, o si el volumen de alertas
        de analítica se concentra en ciertas áreas, es una señal para coordinar
        acciones entre seguridad, mantención e ingeniería de proyectos.
      </p>
    </div>
  );
};

export default CamerasInterpretationPanel;
