import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";

const TMONE_BLUE = "#3b82f6";

function uniqueValues(values) {
  return Array.from(new Set((values || []).filter(Boolean).map((value) => String(value))));
}

function mergeVehicleRows(rows) {
  const grouped = new Map();

  (rows || []).forEach((row) => {
    const vehicleId = row?.vehicle_id != null ? String(row.vehicle_id) : "";
    const vehicleName =
      row?.vehiculo != null
        ? String(row.vehiculo)
        : row?.vehiculo_id != null
        ? String(row.vehiculo_id)
        : "";
    const key = vehicleId || vehicleName;
    if (!key) return;

    const current = grouped.get(key) || {
      vehicle_id: vehicleId || null,
      vehiculo: vehicleName || key,
      vueltas: 0,
    };

    current.vueltas += Number(row?.vueltas ?? 0) || 0;
    if (!current.vehiculo && vehicleName) current.vehiculo = vehicleName;
    grouped.set(key, current);
  });

  return Array.from(grouped.values());
}

export default function TruckLapsSimChart({
  startDate,
  endDate,
  nivel,
  niveles,
  fromPorticoId,
  toPorticoId,
  fromPorticoIds,
  toPorticoIds,
  vehicleId,
  vehicleCategories = [],
  vehicleCategoryById = {},
  rows,
  limit = 2000,
  embedded = false,
  onExportDataChange,
}) {
  const [fetchedRows, setFetchedRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const levelFilters = useMemo(() => {
    if (Array.isArray(niveles) && niveles.length) return uniqueValues(niveles);
    return nivel ? [String(nivel)] : [];
  }, [nivel, niveles]);

  const porticoIds = useMemo(
    () =>
      uniqueValues([
        ...(Array.isArray(fromPorticoIds) ? fromPorticoIds : [fromPorticoId]),
        ...(Array.isArray(toPorticoIds) ? toPorticoIds : [toPorticoId]),
      ]),
    [fromPorticoId, fromPorticoIds, toPorticoId, toPorticoIds]
  );

  useEffect(() => {
    if (Array.isArray(rows)) {
      setFetchedRows([]);
      setLoading(false);
      setError(null);
      return undefined;
    }

    if (!startDate || !endDate) {
      setFetchedRows([]);
      return undefined;
    }

    let cancelled = false;

    const fetchOne = async (levelValue, porticoValue) => {
      const params = {};
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      if (levelValue) params.nivel = levelValue;
      if (porticoValue) params.portico_id = Number(porticoValue);
      if (vehicleId) params.vehicle_id = Number(vehicleId);
      if (limit) params.limit = limit;

      const response = await axios.get("/api/control/graphics/vehicle-laps", { params });
      return Array.isArray(response.data) ? response.data : [];
    };

    const run = async () => {
      try {
        setLoading(true);
        setError(null);

        const levelValues = levelFilters.length ? levelFilters : [null];
        const porticoValues = porticoIds.length ? porticoIds : [null];
        const requests = [];

        levelValues.forEach((levelValue) => {
          porticoValues.forEach((porticoValue) => {
            requests.push(fetchOne(levelValue, porticoValue));
          });
        });

        const responseRows = requests.length ? await Promise.all(requests) : [[]];
        if (cancelled) return;
        setFetchedRows(mergeVehicleRows(responseRows.flat()));
      } catch (requestError) {
        console.error("Error cargando vueltas por vehiculo:", requestError);
        if (!cancelled) {
          setError("No se pudo cargar el grafico de vueltas por vehiculo.");
          setFetchedRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [endDate, levelFilters, limit, porticoIds, rows, startDate, vehicleId]);

  const sourceRows = useMemo(
    () => (Array.isArray(rows) ? mergeVehicleRows(rows) : fetchedRows),
    [fetchedRows, rows]
  );

  const chartData = useMemo(() => {
    const filteredRows = (sourceRows || []).filter((row) => {
      if (!vehicleCategories.length) return true;
      const category = String(vehicleCategoryById?.[String(row?.vehicle_id || "")] || "Sin categoria");
      return vehicleCategories.includes(category);
    });

    return filteredRows
      .map((row) => ({
        vehicle_id: row?.vehicle_id != null ? String(row.vehicle_id) : "",
        vehiculo:
          row?.vehiculo != null
            ? String(row.vehiculo)
            : row?.vehiculo_id != null
            ? String(row.vehiculo_id)
            : "",
        vueltas: Number(row?.vueltas ?? 0),
      }))
      .filter((row) => (row.vehicle_id || row.vehiculo) && Number.isFinite(row.vueltas))
      .sort((left, right) => right.vueltas - left.vueltas)
      .slice(0, limit)
      .map((row, index) => ({
        idx: index + 1,
        vehicle_id: row.vehicle_id,
        vehiculo: row.vehiculo || row.vehicle_id,
        vueltas: row.vueltas,
      }));
  }, [limit, sourceRows, vehicleCategories, vehicleCategoryById]);

  useEffect(() => {
    onExportDataChange?.(chartData);
  }, [chartData, onExportDataChange]);

  const header = (
    <div className={`mb-4 flex items-center ${embedded ? "justify-end" : "justify-between"}`}>
      {!embedded ? <h2 className="text-xl font-semibold text-center">Vueltas por vehiculo</h2> : null}
      <div className="text-xs text-gray-500">
        {loading ? "Cargando..." : `${chartData.length} vehiculos`}
      </div>
    </div>
  );

  const chart = (
    <>
      {header}

      {error ? (
        <div className="pb-4 text-center text-sm text-red-600">{error}</div>
      ) : null}

      {!loading && !error && chartData.length === 0 ? (
        <div className="pb-4 text-center text-sm text-gray-500">Sin datos para los filtros seleccionados.</div>
      ) : null}

      <div style={{ width: "100%", height: 340 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="idx" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip
              formatter={(value, name) => {
                if (name === "vueltas") return [value, "Vueltas"];
                return [value, name];
              }}
              labelFormatter={(label, payload) => {
                const vehicleName = payload?.[0]?.payload?.vehiculo;
                return vehicleName ? `Vehiculo: ${vehicleName}` : `#${label}`;
              }}
            />
            <Line
              type="monotone"
              dataKey="vueltas"
              name="vueltas"
              stroke={TMONE_BLUE}
              strokeWidth={2}
              dot={{ r: 2, fill: TMONE_BLUE }}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  );

  return embedded ? chart : <div>{chart}</div>;
}
