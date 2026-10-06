import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { API_URL } from "../../api-config";

const ClimateAnomaliesChart = ({
  startDate,
  endDate,
  nivel,
  porticoId,
  varCode = "CO2",
  seriesLabel = "Gases (CO2)",
  unit = "ppm",
  minValue,
  maxValue,
  hours = 24,
  onExportDataChange,
}) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const token = localStorage.getItem("token");

  const api = useMemo(() => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    return axios.create({
      baseURL: API_URL,
      headers,
    });
  }, [token]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const params = {
          start_date: startDate || undefined,
          end_date: endDate || undefined,
          hours,
          nivel: nivel || undefined,
          portico_id: porticoId || undefined,
          var_code: varCode,
          min_value: minValue ?? undefined,
          max_value: maxValue ?? undefined,
        };

        const res = await api.get("/control/climate/anomalias-climaticas", { params });
        const items = Array.isArray(res.data)
          ? res.data
          : Array.isArray(res.data?.items)
          ? res.data.items
          : [];

        setRows(items);
      } catch (e) {
        console.error("Error anomalias-climaticas:", e);
        setError("No se pudieron cargar las anomalias ambientales.");
        setRows([]);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [api, startDate, endDate, nivel, porticoId, varCode, minValue, maxValue, hours]);

  const chartData = useMemo(() => {
    const parsed = rows
      .map((row) => {
        const tsDate = row.ts ? new Date(row.ts) : null;
        return {
          ...row,
          tsDate,
          tsLabel: tsDate ? tsDate.toLocaleString("es-CL") : row.ts || "",
          valueNum: row.value !== undefined && row.value !== null ? Number(row.value) : null,
          thresholdNum:
            row.threshold !== undefined && row.threshold !== null
              ? Number(row.threshold)
              : null,
        };
      })
      .filter((row) => row.tsDate && row.valueNum !== null);

    parsed.sort((a, b) => a.tsDate - b.tsDate);
    return parsed;
  }, [rows]);

  const numericMin = minValue == null || minValue === "" ? null : Number(minValue);
  const numericMax = maxValue == null || maxValue === "" ? null : Number(maxValue);

  const exportRows = useMemo(
    () =>
      chartData.map((row) => ({
        variable: varCode,
        timestamp: row.ts || "",
        etiqueta: row.tsLabel,
        ur: row.ur || row.portico || "Sin UR",
        valor: row.valueNum,
        unidad: unit,
        umbral: row.thresholdNum,
        severidad: row.severity || "",
      })),
    [chartData, unit, varCode]
  );

  useEffect(() => {
    onExportDataChange?.(exportRows);
  }, [exportRows, onExportDataChange]);

  if (loading) return <div>Cargando anomalias ambientales...</div>;
  if (error) return <div className="text-red-600">{error}</div>;
  if (!chartData.length) return <div className="w-full text-sm text-gray-500">Sin alertas ambientales registradas.</div>;

  return (
    <div className="w-full">
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="tsLabel" minTickGap={20} tick={{ fontSize: 11 }} />
            <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} />
            <Tooltip
              formatter={(value, name) => {
                if (name === "valueNum") {
                  return [`${Number(value).toFixed(2)} ${unit}`.trim(), seriesLabel];
                }
                return [value, name];
              }}
              labelFormatter={(label) => `TS: ${label}`}
            />
            <Legend />
            {Number.isFinite(numericMin) ? (
              <ReferenceLine y={numericMin} strokeDasharray="6 6" label={`Min ${numericMin}`} />
            ) : null}
            {Number.isFinite(numericMax) ? (
              <ReferenceLine y={numericMax} strokeDasharray="6 6" label={`Max ${numericMax}`} />
            ) : null}
            <Line type="monotone" dataKey="valueNum" name={`${seriesLabel} (${unit})`} dot={{ r: 3 }} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default ClimateAnomaliesChart;
