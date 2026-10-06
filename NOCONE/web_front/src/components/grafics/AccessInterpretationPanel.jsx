// src/components/grafics/AccessInterpretationPanel.jsx
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

const AccessInterpretationPanel = ({ vehicleStatus, accessRejects }) => {
  const totalOnline = vehicleStatus?.online || 0;
  const totalOffline = vehicleStatus?.offline || 0;
  const totalMant = vehicleStatus?.mantenimiento || vehicleStatus?.maintenance || 0;
  const totalVeh = vehicleStatus?.total || totalOnline + totalOffline + totalMant;

  const uptime =
  totalVeh > 0  Math.round(totalOnline / totalVeh * 100) : 0;

  // Agrupar rechazos por motivo
  const rejectsByMotivo = {};
  (accessRejects || []).forEach((r) => {
    rejectsByMotivo[r.motivo] = (rejectsByMotivo[r.motivo] || 0) + r.cantidad;
  });

  const rejectsData = Object.keys(rejectsByMotivo).map((motivo) => ({
    motivo,
    cantidad: rejectsByMotivo[motivo]
  }));

  const totalRejects = rejectsData.reduce((s, r) => s + r.cantidad, 0);

  return (
    <div className="bg-white rounded shadow p-4 mt-4">
      <h2 className="text-lg font-semibold mb-2">
        Interpretación operacional – Acceso
      </h2>
      <p className="text-xs text-gray-600 mb-3">
        Disponibilidad de monitoreo de flota y comportamiento de los accesos
        rechazados, para controlar disciplina de ingreso y continuidad de datos
        de operación.
      </p>

      {/* Gráfico de rechazos por motivo */}
      <div className="w-full h-64 mb-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rejectsData}
            margin={{ top: 10, right: 20, left: 0, bottom: 60 }}>
            
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="motivo"
              angle={-30}
              textAnchor="end"
              interval={0}
              height={60} />
            
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Bar dataKey="cantidad" name="Intentos rechazados" fill="#ef4444" />
          </BarChart>
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
              <td className="px-2 py-1">Vehículos monitoreados</td>
              <td className="px-2 py-1">{totalVeh}</td>
            </tr>
            <tr className="border-t">
              <td className="px-2 py-1">Disponibilidad de monitoreo de flota</td>
              <td className="px-2 py-1">{uptime}% online</td>
            </tr>
            <tr className="border-t">
              <td className="px-2 py-1">Intentos de acceso rechazados</td>
              <td className="px-2 py-1">{totalRejects}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Conclusión */}
      <p className="text-xs text-gray-700">
        Una alta disponibilidad de monitoreo de flota (vehículos online) es
        clave para tomar decisiones de despacho confiables. Al mismo tiempo, los
        motivos recurrentes de acceso rechazado permiten identificar brechas en
        inducción, acreditación o coordinación con contratistas. Focos claros
        de rechazos en ciertos pórticos o motivos son oportunidades directas de
        mejora de procesos y de cultura de seguridad.
      </p>
    </div>);

};

export default AccessInterpretationPanel;