import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

const BLUE = "#3B82F6";

const URStayChart = ({
  startDate,
  endDate,
  nivel,
  porticoId,
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
    if (nivel) nextParams.nivel = nivel;
    if (porticoId) nextParams.portico_id = Number(porticoId);
    if (entityType) nextParams.entity_type = entityType;
    if (entityId) nextParams.entity_id = Number(entityId);
    return nextParams;
  }, [endDate, entityId, entityType, nivel, porticoId, startDate]);

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
        const response = await axios.get("/api/control/transfers/new-permanencias", { params });
        if (!mounted) return;
        setFetchedRows(Array.isArray(response.data) ? response.data : []);
      } catch (requestError) {
        if (!mounted) return;
        setFetchedRows([]);
        setError(
          requestError?.response?.data?.detail ||
            requestError?.message ||
            "Error cargando permanencias"
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
          duracion_minutos: Number(row?.duracion_minutos ?? 0),
          inicio: row?.inicio,
          portico_id: row?.portico_id,
          ur: row?.ur,
          nivel: row?.nivel,
          entity_name: row?.entity_name,
          entity_type: row?.entity_type,
          entity_id: row?.entity_id,
        }))
        .filter((item) => Number.isFinite(item.duracion_minutos)),
    [sourceRows]
  );

  useEffect(() => {
    onExportDataChange?.(data);
  }, [data, onExportDataChange]);

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const point = payload[0]?.payload;
    if (!point) return null;

    return (
      <div className="rounded border bg-white px-3 py-2 text-sm shadow">
        <div className="font-semibold">{point.entity_name || "Entidad"}</div>
        <div className="text-gray-700">Minutos: {point.duracion_minutos}</div>
        <div className="text-gray-600">
          {point.ur ? `UR: ${point.ur}` : ""}
          {point.portico_id ? ` · Pórtico #${point.portico_id}` : ""}
        </div>
        {point.inicio ? <div className="text-gray-500">Inicio: {point.inicio}</div> : null}
      </div>
    );
  };

  const content = (
    <>
      <div className={`mb-3 flex items-center ${embedded ? "justify-end" : "justify-between"}`}>
        {!embedded ? <h3 className="text-lg font-semibold">Permanencias (minutos)</h3> : null}
        <div className="text-xs text-gray-500">
          {loading ? "Cargando..." : `${data.length} registros`}
          {error ? ` · ${error}` : ""}
        </div>
      </div>

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
              dataKey="duracion_minutos"
              label={{ value: "Minutos", angle: -90, position: "insideLeft" }}
            />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<CustomTooltip />} />
            <Scatter name="Permanencias" data={data} fill={BLUE} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </>
  );

  if (embedded) return content;

  return <div className="rounded-lg bg-white p-4 shadow">{content}</div>;
};

export default URStayChart;
