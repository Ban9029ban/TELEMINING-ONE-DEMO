import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
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

import { API_URL } from "../../api-config";

function normalizeRows(rows) {
  if (!Array.isArray(rows)) return [];

  if (rows.some((row) => row?.plannedHours != null || row?.realHours != null)) {
    return rows.map((row) => ({
      cuadrilla: row?.label || row?.cuadrilla || row?.crew_name || "Sin cuadrilla",
      plannedHours: Number(row?.plannedHours || 0),
      realHours: Number(row?.realHours || 0),
      targetHours: Number(row?.targetHours || 0),
      plannedTasks: Number(row?.plannedTasks || 0),
      realTasks: Number(row?.realTasks || 0)
    }));
  }

  const grouped = new Map();
  rows.forEach((row) => {
    const key = row?.cuadrilla || row?.crew_name || "Sin cuadrilla";
    const current = grouped.get(key) || {
      cuadrilla: key,
      plannedHours: 0,
      realHours: 0,
      targetHours: 0,
      plannedTasks: 0,
      realTasks: 0
    };
    current.realHours += Number(row?.minutos || 0) / 60;
    grouped.set(key, current);
  });

  return Array.from(grouped.values()).map((row) => ({
    ...row,
    plannedHours: Number(row.plannedHours.toFixed(2)),
    realHours: Number(row.realHours.toFixed(2)),
    targetHours: Number(row.targetHours.toFixed(2))
  }));
}

const CrewProductiveTimeSimChart = ({
  startDate,
  endDate,
  nivel,
  rows,
  embedded = false,
  onExportDataChange
}) => {
  const [fetchedRows, setFetchedRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const token = localStorage.getItem("token");

  useEffect(() => {
    if (Array.isArray(rows)) {
      setFetchedRows([]);
      setLoading(false);
      setError(null);
      return undefined;
    }

    let mounted = true;

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const params = {
          start_date: startDate || undefined,
          end_date: endDate || undefined,
          nivel: nivel || undefined
        };

        const response = await axios.get(`${API_URL}/control/graphics/crew-productive-time`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          params
        });

        if (!mounted) return;
        setFetchedRows(Array.isArray(response.data) ? response.data : []);
      } catch (requestError) {
        if (!mounted) return;
        console.error("Error crew-productive-time:", requestError);
        setError("No se pudieron cargar los tiempos productivos de cuadrillas.");
        setFetchedRows([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchData();

    return () => {
      mounted = false;
    };
  }, [endDate, nivel, rows, startDate, token]);

  const data = useMemo(
    () => normalizeRows(Array.isArray(rows) ? rows : fetchedRows),
    [fetchedRows, rows]
  );

  useEffect(() => {
    onExportDataChange?.(data);
  }, [data, onExportDataChange]);

  if (loading) {
    return <div className="py-10 text-center text-sm text-slate-500">Cargando tiempo productivo...</div>;
  }

  if (error) {
    return <div className="py-10 text-center text-sm text-red-600">{error}</div>;
  }

  if (!data.length) {
    return <div className="py-10 text-center text-sm text-slate-500">Sin datos para los filtros activos.</div>;
  }

  const showPlanned = data.some((row) => row.plannedHours > 0);
  const showReal = data.some((row) => row.realHours > 0);
  const showTarget = data.some((row) => row.targetHours > 0);

  const content =
  <div className="w-full h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#dbe4f0" />
          <XAxis dataKey="cuadrilla" />
          <YAxis />
          <Tooltip
          formatter={(value, name) => [`${Number(value || 0).toFixed(1)} h`, name]}
          labelFormatter={(label) => `Cuadrilla: ${label}`} />

          <Legend />
          {showPlanned ?
        <Bar dataKey="plannedHours" name="TP" fill="#6ba142" radius={[8, 8, 0, 0]} /> :
        null}
          {showTarget ?
        <Bar dataKey="targetHours" name="Meta TP" fill="#a3c97a" radius={[8, 8, 0, 0]} /> :
        null}
          {showReal ?
        <Bar dataKey="realHours" name="TR" fill="#3b82f6" radius={[8, 8, 0, 0]} /> :
        null}
        </BarChart>
      </ResponsiveContainer>
    </div>;


  return embedded ? content : <div className="rounded-lg bg-white p-4 shadow">{content}</div>;
};

export default CrewProductiveTimeSimChart;
