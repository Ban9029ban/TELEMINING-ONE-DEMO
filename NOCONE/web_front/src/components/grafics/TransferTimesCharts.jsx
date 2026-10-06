import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const BLUE = "#3B82F6";
const DISPLAY_LIMIT = 240;

const TransferTimesCharts = ({
  startDate,
  endDate,
  fromPorticoId,
  toPorticoId,
  entityType,
  entityId,
  rows,
  embedded = false,
  onExportDataChange,
}) => {
  const [fetchedRows, setFetchedRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const params = useMemo(() => {
    const nextParams = {};
    if (startDate) nextParams.start_date = startDate;
    if (endDate) nextParams.end_date = endDate;
    if (fromPorticoId) nextParams.from_portico_id = Number(fromPorticoId);
    if (toPorticoId) nextParams.to_portico_id = Number(toPorticoId);
    if (entityType) nextParams.entity_type = entityType;
    if (entityId) nextParams.entity_id = Number(entityId);
    return nextParams;
  }, [endDate, entityId, entityType, fromPorticoId, startDate, toPorticoId]);

  useEffect(() => {
    if (Array.isArray(rows)) {
      setFetchedRows([]);
      setLoading(false);
      setError("");
      return undefined;
    }

    let mounted = true;

    const load = async () => {
      setLoading(true);
      setError("");

      try {
        const response = await axios.get("/api/control/transfers/new-traslados", { params });
        if (!mounted) return;
        setFetchedRows(Array.isArray(response.data) ? response.data : []);
      } catch (requestError) {
        if (!mounted) return;
        setFetchedRows([]);
        setError(
          requestError?.response?.data?.detail ||
            requestError?.message ||
            "Error cargando traslados"
        );
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();

    return () => {
      mounted = false;
    };
  }, [params, rows]);

  const sourceRows = Array.isArray(rows) ? rows : fetchedRows;

  const data = useMemo(
    () =>
      sourceRows
        .map((row, idx) => ({
          idx,
          time: Number(row.time ?? row.minutes ?? 0),
          timestamp: row.timestamp,
          end_timestamp: row.end_timestamp,
          device_name: row.device_name,
          location_name: row.location_name,
          location_id: row.location_id,
          destiny_name: row.destiny_name,
          destiny_id: row.destiny_id,
          entity_type: row.entity_type,
          entity_id: row.entity_id,
        }))
        .filter((item) => Number.isFinite(item.time)),
    [sourceRows]
  );

  const visibleData = useMemo(() => {
    const sorted = [...data].sort((left, right) => {
      const leftTs = new Date(left.end_timestamp || left.timestamp || 0).getTime();
      const rightTs = new Date(right.end_timestamp || right.timestamp || 0).getTime();
      const safeLeftTs = Number.isFinite(leftTs) ? leftTs : 0;
      const safeRightTs = Number.isFinite(rightTs) ? rightTs : 0;
      return safeLeftTs - safeRightTs;
    });

    const sliced = sorted.length > DISPLAY_LIMIT ? sorted.slice(-DISPLAY_LIMIT) : sorted;
    return sliced.map((item, idx) => ({
      ...item,
      idx,
    }));
  }, [data]);

  useEffect(() => {
    onExportDataChange?.(data);
  }, [data, onExportDataChange]);

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const point = payload[0]?.payload;
    if (!point) return null;

    return (
      <div className="rounded border bg-white px-3 py-2 text-sm shadow">
        <div className="font-semibold">{point.device_name || "Entidad"}</div>
        <div className="text-gray-700">Minutos: {point.time}</div>
        <div className="text-gray-600">
          {point.location_name || ""} {"->"} {point.destiny_name || ""}
        </div>
        {point.timestamp ? <div className="text-gray-500">Inicio: {point.timestamp}</div> : null}
        {point.end_timestamp ? <div className="text-gray-500">Fin: {point.end_timestamp}</div> : null}
      </div>
    );
  };

  const content = (
    <>
      <div className={`mb-3 flex items-center ${embedded ? "justify-end" : "justify-between"}`}>
        {!embedded ? <h3 className="text-lg font-semibold">Traslados (minutos)</h3> : null}
        <div className="text-xs text-gray-500">
          {loading ? "Cargando..." : `${data.length} registros`}
          {error ? ` | ${error}` : ""}
        </div>
      </div>

      {!loading && !error && data.length > DISPLAY_LIMIT ? (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Mostrando los {DISPLAY_LIMIT} traslados mas recientes de {data.length} registros para evitar saturacion visual.
        </div>
      ) : null}

      <div style={{ width: "100%", height: 340 }}>
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 0 }}>
            <CartesianGrid />
            <XAxis
              type="number"
              dataKey="idx"
              tick={false}
              label={{ value: "Eventos (orden)", position: "insideBottom", offset: -10 }}
            />
            <YAxis
              type="number"
              dataKey="time"
              label={{ value: "Minutos", angle: -90, position: "insideLeft" }}
            />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<CustomTooltip />} />
            <Scatter name="Traslados" data={visibleData} fill={BLUE} line={false} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </>
  );

  if (embedded) return content;

  return <div className="rounded-lg bg-white p-4 shadow">{content}</div>;
};

export default TransferTimesCharts;
