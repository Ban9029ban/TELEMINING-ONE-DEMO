import React, { useMemo, useState } from "react";

function prettyEntityType(value) {
  if (value === "person") return "Persona";
  if (value === "vehicle") return "Vehículo";
  if (value === "equipment") return "Equipo";
  return value || "Nodo";
}

function fmtTime(iso) {
  if (!iso) return "-";
  const date = new Date(iso);
  return date.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function rowMatches(row, search) {
  if (!search) return true;
  const haystack = [
    row?.portico?.name,
    row?.zone,
    row?.direction,
    fmtTime(row?.ts_edge || row?.ts_event),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(search);
}

export default function NodeHistoryTable({ history, entityType, label }) {
  const [searchTerm, setSearchTerm] = useState("");
  const title = `${prettyEntityType(entityType)}${label ? `: ${label}` : ""}`;
  const normalizedSearch = searchTerm.trim().toLowerCase();

  const rows = useMemo(() => {
    const items = Array.isArray(history) ? history.slice() : [];

    items.sort((left, right) => {
      const leftTime = new Date(left?.ts_edge || left?.ts_event || 0).getTime();
      const rightTime = new Date(right?.ts_edge || right?.ts_event || 0).getTime();
      return rightTime - leftTime;
    });

    return items.filter((row) => rowMatches(row, normalizedSearch));
  }, [history, normalizedSearch]);

  return (
    <div className="mb-3 rounded-xl border bg-white shadow-sm">
      <div className="border-b px-4 py-3">
        <div className="font-semibold text-sm">Historial de posiciones (día actual)</div>
        <div className="text-xs text-gray-600">{title}</div>
      </div>

      <div className="space-y-3 p-3">
        <input
          type="text"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Buscar dentro del historial..."
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-100"
        />

        {rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-gray-600">
                  <th className="py-2 pr-3">Hora</th>
                  <th className="py-2 pr-3">Pórtico</th>
                  <th className="py-2 pr-3">Zona</th>
                  <th className="py-2 pr-3">Dirección</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row?.ts_edge || row?.ts_event || "row"}-${index}`} className="border-b last:border-b-0">
                    <td className="whitespace-nowrap py-2 pr-3">{fmtTime(row.ts_edge || row.ts_event)}</td>
                    <td className="py-2 pr-3">{row.portico?.name || "-"}</td>
                    <td className="py-2 pr-3">{row.zone || "-"}</td>
                    <td className="py-2 pr-3">{row.direction || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-xs text-gray-600">
            {normalizedSearch ? "Sin coincidencias para ese filtro." : "Sin historial para el día actual."}
          </div>
        )}
      </div>
    </div>
  );
}
