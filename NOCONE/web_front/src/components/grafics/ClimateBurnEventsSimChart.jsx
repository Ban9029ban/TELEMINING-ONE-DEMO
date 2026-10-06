import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { API_URL } from "../../api-config";

const ClimateBurnEventsSimChart = ({
  startDate,
  endDate,
  nivel,
  porticoId,
  varCode = "CO2",
  seriesLabel = "Gases (CO2)",
  unit = "ppm",
  threshold,
  onExportDataChange,
}) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const token = localStorage.getItem("token");

  const api = useMemo(
    () =>
      axios.create({
        baseURL: API_URL,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }),
    [token]
  );

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const params = {
          start_date: startDate || undefined,
          end_date: endDate || undefined,
          nivel: nivel || undefined,
          portico_id: porticoId || undefined,
          var_code: varCode,
          threshold: threshold ?? undefined,
          min_minutes: 2,
          gap_minutes: 5,
        };

        const res = await api.get("/control/climate/eventos-quemada", { params });
        const items = Array.isArray(res.data)
          ? res.data
          : Array.isArray(res.data?.items)
          ? res.data.items
          : [];

        setRows(items);
      } catch (e) {
        console.error("Error eventos ambientales:", e);
        setError("No se pudieron cargar los eventos ambientales sostenidos.");
        setRows([]);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [api, endDate, nivel, porticoId, startDate, threshold, varCode]);

  const data = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        portico: row.portico_name || row.ur || `Portico ${row.portico_id || ""}`.trim(),
        eventos_quemada: Number(row.eventos_quemada || 0),
        total_minutos: Number(row.total_minutos || 0),
        peak_value: Number(row.peak_value || 0),
      })),
    [rows]
  );

  useEffect(() => {
    onExportDataChange?.(
      data.map((row) => ({
        portico: row.portico,
        ur: row.ur || "",
        variable: varCode,
        eventos: row.eventos_quemada,
        total_minutos: row.total_minutos,
        peak_value: row.peak_value,
        unidad: unit,
        umbral: threshold ?? "",
        ultimo_evento: row.last_event_ts || "",
      }))
    );
  }, [data, onExportDataChange, threshold, unit, varCode]);

  if (loading) return <div>Cargando eventos ambientales...</div>;
  if (error) return <div className="text-red-600">{error}</div>;
  if (!data.length) return <div className="w-full text-sm text-gray-500">Sin eventos sostenidos para el filtro activo.</div>;

  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-500">
        {`Mostrando eventos sostenidos de ${seriesLabel.toLowerCase()} sobre ${threshold ?? "umbral configurado"} ${unit}`.trim()}
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="portico" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 11 }} />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 11 }}
              label={{ value: "Minutos", angle: 90, position: "insideRight" }}
            />
            <Tooltip
              formatter={(value, name) => {
                if (name === "Eventos") return [value, "Eventos"];
                if (name === "Minutos acumulados") return [`${Number(value).toFixed(1)} min`, "Minutos acumulados"];
                return [value, name];
              }}
            />
            <Legend />
            <Bar yAxisId="left" dataKey="eventos_quemada" name="Eventos" fill="#ef4444" radius={[8, 8, 0, 0]} />
            <Bar yAxisId="right" dataKey="total_minutos" name="Minutos acumulados" fill="#0f766e" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default ClimateBurnEventsSimChart;
