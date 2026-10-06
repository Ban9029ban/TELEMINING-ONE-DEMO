import React from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Bar,
} from "recharts";

// Normaliza cualquier formato razonable de datos
// - objeto: { NP: 10, UCL: 5 }
// - array:  [{ nivel: 'NP', total: 10 }, { level: 'UCL', count: 5 }, ...]
const normalizeLevelMap = (raw) => {
  const result = {};

  if (!raw) return result;

  // Caso array de objetos
  if (Array.isArray(raw)) {
    raw.forEach((item) => {
      if (!item) return;
      const nivel =
        item.nivel ||
        item.level ||
        item.NIVEL ||
        item.Nivel ||
        "SIN NIVEL";

      // busco un campo numérico típico
      const val =
        typeof item.total === "number"
          ? item.total
          : typeof item.count === "number"
          ? item.count
          : typeof item.cantidad === "number"
          ? item.cantidad
          : typeof item.value === "number"
          ? item.value
          : 0;

      result[nivel] = (result[nivel] || 0) + (isNaN(val) ? 0 : val);
    });
    return result;
  }

  // Caso objeto plano
  if (typeof raw === "object") {
    Object.entries(raw).forEach(([nivel, val]) => {
      if (typeof val === "number") {
        result[nivel] = val;
      } else if (val && typeof val === "object") {
        const num =
          typeof val.total === "number"
            ? val.total
            : typeof val.count === "number"
            ? val.count
            : typeof val.cantidad === "number"
            ? val.cantidad
            : typeof val.value === "number"
            ? val.value
            : 0;
        result[nivel] = num;
      }
    });
  }

  return result;
};

const TrackingInterpretationPanel = ({ peopleData, vehiclesData }) => {
  const peopleMap = normalizeLevelMap(peopleData);
  const vehiclesMap = normalizeLevelMap(vehiclesData);

  const levels = Array.from(
    new Set([...Object.keys(peopleMap), ...Object.keys(vehiclesMap)])
  );

  const chartData = levels.map((nivel) => ({
    nivel,
    personas: peopleMap[nivel] || 0,
    vehiculos: vehiclesMap[nivel] || 0,
  }));

  const totalPersonas = chartData.reduce((s, r) => s + r.personas, 0);
  const totalVehiculos = chartData.reduce((s, r) => s + r.vehiculos, 0);

  const topNivel =
    chartData.length > 0
      ? chartData.reduce((a, b) => (b.personas > a.personas ? b : a))
      : null;

  return (
    <div className="bg-white rounded shadow p-4 mt-4">
      <h2 className="text-lg font-semibold mb-2">
        Relación Vehículos/Personas
      </h2>
      <p className="text-xs text-gray-600 mb-3">
        Relación entre dotación de personas y vehículos por nivel, para apoyar
        decisiones de ocupación, logística y seguridad en interior mina.
      </p>

      {/* Gráfico */}
      <div className="w-full h-64 mb-4">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="nivel" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Bar dataKey="personas" name="Personas" fill="#3b82f6" />
            <Bar dataKey="vehiculos" name="Vehículos" fill="#f97316" />
          </ComposedChart>
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
              <td className="px-2 py-1">Total personas en mina</td>
              <td className="px-2 py-1">{totalPersonas}</td>
            </tr>
            <tr className="border-t">
              <td className="px-2 py-1">Total vehículos monitoreados</td>
              <td className="px-2 py-1">{totalVehiculos}</td>
            </tr>
            {topNivel && (
              <tr className="border-t">
                <td className="px-2 py-1">
                  Nivel con mayor concentración de personas
                </td>
                <td className="px-2 py-1">
                  {topNivel.nivel} ({topNivel.personas} personas)
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Conclusión */}
      <p className="text-xs text-gray-700">
        En una operación normal, la distribución de personas y vehículos debería
        concentrarse en los frentes productivos planificados. Desbalances
        importantes (niveles con mucha gente y pocos equipos, o al revés) pueden
        indicar tiempos muertos, congestión o riesgos de interacción
        persona–vehículo que vale la pena revisar junto a planificación y
        prevención de riesgos.
      </p>
    </div>
  );
};

export default TrackingInterpretationPanel;
