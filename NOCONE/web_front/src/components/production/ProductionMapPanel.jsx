import React, { useMemo, useRef, useState } from "react";
import { BsTrash3 } from "react-icons/bs";
import {
  FaClipboardCheck,
  FaDrawPolygon,
  FaExclamationTriangle,
  FaMapMarkedAlt,
  FaMapMarkerAlt,
  FaMountain,
  FaPlus,
  FaRoute,
  FaRulerCombined,
} from "react-icons/fa";

import {
  ActionButton,
  FieldShell,
  MetricStrip,
  SectionCard,
  StatusBadge,
  joinClasses,
} from "../SystemTheme";

const MAP_GENERIC_WIDTH_METERS = 1000;

function toneForStatus(status) {
  if (status === "completed") return "bg-emerald-500";
  if (status === "in_progress") return "bg-sky-500";
  if (status === "delayed") return "bg-rose-500";
  return "bg-amber-400";
}

function waypointPulseClass(tasks) {
  if (tasks.some((task) => task.status === "delayed")) return "ring-rose-300/85";
  if (tasks.some((task) => task.status === "in_progress")) return "ring-sky-300/85";
  if (tasks.some((task) => task.status === "completed")) return "ring-emerald-300/85";
  return "ring-amber-300/85";
}

function formatTaskTimeRange(task) {
  const start = task.plannedStart || task.realStart;
  const end = task.plannedEnd || task.realEnd;
  if (!start || !end) return "Sin horario";

  const options = { hour: "2-digit", minute: "2-digit", timeZone: "America/Santiago" };
  const startDate = new Date(start);
  const endDate = new Date(end);

  return `${startDate.toLocaleTimeString("es-CL", options)} - ${endDate.toLocaleTimeString("es-CL", options)}`;
}

function renderTaskStatus(task) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={joinClasses("h-2.5 w-2.5 rounded-full", toneForStatus(task.status))} />
      <span className="capitalize">{task.status || "planned"}</span>
    </span>
  );
}

function MapControlButton({ icon, label, active = false, disabled = false, onClick }) {
  return (
    <button
      type="button"
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={joinClasses(
        "flex h-9 w-9 items-center justify-center rounded-xl border text-xs transition disabled:cursor-not-allowed disabled:opacity-50 sm:h-10 sm:w-10 sm:rounded-2xl sm:text-sm",
        active
          ? "border-transparent bg-[linear-gradient(135deg,#4f46e5_0%,#2563eb_100%)] text-white shadow-[0_16px_30px_rgba(79,70,229,0.26)]"
          : "border-white/75 bg-white/92 text-slate-600 shadow-[0_12px_25px_rgba(15,23,42,0.12)] hover:bg-white hover:text-slate-900"
      )}
    >
      {icon}
    </button>
  );
}

function isPointInPolygon(px, py, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const { x: xi, y: yi } = polygon[i];
    const { x: xj, y: yj } = polygon[j];
    const intersectsY = (yi > py) !== (yj > py);
    const intersect = intersectsY && px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function normalizedDistance(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export default function ProductionMapPanel({
  maps,
  selectedMapCode,
  onMapCodeChange,
  waypoints,
  tasksByWaypoint,
  selectedWaypointId,
  onSelectWaypoint,
  onOpenNewTask,
  onOpenEditTask,
  canManageTasks = true,
  onBlockedTaskAction,
}) {
  const [popupWaypointId, setPopupWaypointId] = useState(null);
  const [manualScale, setManualScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [mapFilter, setMapFilter] = useState("all");
  const [showLabels, setShowLabels] = useState(true);
  const [visualFxOn, setVisualFxOn] = useState(true);
  const [polygonMode, setPolygonMode] = useState(false);
  const [polygonPoints, setPolygonPoints] = useState([]);
  const [polygonSummary, setPolygonSummary] = useState(null);
  const [measureMode, setMeasureMode] = useState(false);
  const [measurePoints, setMeasurePoints] = useState([]);
  const [measureDistance, setMeasureDistance] = useState(null);
  const [markerMode, setMarkerMode] = useState(false);
  const [markerPoints, setMarkerPoints] = useState([]);
  const mapContainerRef = useRef(null);
  const panStart = useRef({ x: 0, y: 0 });

  const selectedWaypoint = useMemo(
    () => waypoints.find((item) => item.id === selectedWaypointId) || null,
    [selectedWaypointId, waypoints]
  );
  const popupWaypoint = useMemo(
    () => waypoints.find((item) => item.id === popupWaypointId) || null,
    [popupWaypointId, waypoints]
  );

  const selectedWaypointTasks = selectedWaypoint ? tasksByWaypoint.get(selectedWaypoint.id) || [] : [];
  const popupWaypointTasks = popupWaypoint ? tasksByWaypoint.get(popupWaypoint.id) || [] : [];

  const filteredWaypoints = useMemo(() => {
    return waypoints.filter((item) => {
      if (item.mapCode !== selectedMapCode) return false;
      const tasks = tasksByWaypoint.get(item.id) || [];

      if (mapFilter === "delayed") {
        return tasks.some((task) => task.status === "delayed");
      }

      if (mapFilter === "validated") {
        return tasks.some((task) => task.trackingPorticoId);
      }

      return true;
    });
  }, [mapFilter, selectedMapCode, tasksByWaypoint, waypoints]);

  const delayedCount = filteredWaypoints.filter((item) =>
    (tasksByWaypoint.get(item.id) || []).some((task) => task.status === "delayed")
  ).length;
  const inProgressCount = filteredWaypoints.filter((item) =>
    (tasksByWaypoint.get(item.id) || []).some((task) => task.status === "in_progress")
  ).length;
  const validatedCount = filteredWaypoints.filter((item) =>
    (tasksByWaypoint.get(item.id) || []).some((task) => task.trackingPorticoId)
  ).length;

  const selectedMap = maps.find((item) => item.code === selectedMapCode) || null;
  const mapModeLabel =
    mapFilter === "all" ? "Todos" : mapFilter === "delayed" ? "Solo atrasos" : "Validados";
  const effectiveScale = visualFxOn ? manualScale : 1;
  const effectivePan = visualFxOn ? pan : { x: 0, y: 0 };

  const clearMapOverlays = () => {
    setPolygonMode(false);
    setPolygonPoints([]);
    setPolygonSummary(null);
    setMeasureMode(false);
    setMeasurePoints([]);
    setMeasureDistance(null);
    setMarkerMode(false);
    setMarkerPoints([]);
    setManualScale(1);
    setPan({ x: 0, y: 0 });
  };

  const summarizePolygon = (points) => {
    const insideWaypoints = filteredWaypoints.filter((waypoint) =>
      isPointInPolygon(waypoint.xPct, waypoint.yPct, points)
    );
    const insideTasks = insideWaypoints.flatMap((waypoint) => tasksByWaypoint.get(waypoint.id) || []);

    setPolygonSummary({
      totalWaypoints: insideWaypoints.length,
      totalTasks: insideTasks.length,
      validated: insideTasks.filter((task) => task.trackingPorticoId).length,
      delayed: insideTasks.filter((task) => task.status === "delayed").length,
      waypoints: insideWaypoints.map((item) => ({
        id: item.id,
        postura: item.postura,
        nivel: item.nivel,
        tasks: (tasksByWaypoint.get(item.id) || []).length,
      })),
    });
  };

  const finalizePolygon = () => {
    if (polygonPoints.length < 3) {
      setPolygonMode(false);
      return;
    }
    summarizePolygon(polygonPoints);
    setPolygonMode(false);
  };

  const handleMapSurfaceClick = (event) => {
    if (!mapContainerRef.current) return;
    const rect = mapContainerRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const point = {
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
    };

    if (polygonMode) {
      setPolygonSummary(null);
      setPolygonPoints((current) => [...current, point]);
      return;
    }

    if (measureMode) {
      setMeasurePoints((current) => {
        const next = current.length < 2 ? [...current, point] : [current[1], point];
        if (next.length === 2) {
          setMeasureDistance(normalizedDistance(next[0], next[1]) * MAP_GENERIC_WIDTH_METERS);
        } else {
          setMeasureDistance(null);
        }
        return next;
      });
      return;
    }

    if (markerMode) {
      setMarkerPoints((current) => [
        ...current,
        { ...point, id: `mark-${current.length + 1}`, label: `P${current.length + 1}` },
      ]);
      return;
    }

    setPolygonSummary(null);
  };

  const handleWheel = (event) => {
    if (!visualFxOn) return;
    const delta = event.deltaY > 0 ? -0.12 : 0.12;
    setManualScale((current) => Math.max(0.55, Math.min(3, current + delta)));
  };

  const startPan = (event) => {
    if (!visualFxOn || polygonMode || measureMode || markerMode) return;
    setIsPanning(true);
    panStart.current = {
      x: event.clientX - pan.x,
      y: event.clientY - pan.y,
    };
  };

  const movePan = (event) => {
    if (!visualFxOn || !isPanning) return;
    setPan({
      x: event.clientX - panStart.current.x,
      y: event.clientY - panStart.current.y,
    });
  };

  const endPan = () => setIsPanning(false);

  const togglePolygonMode = () => {
    setPolygonMode((current) => {
      const next = !current;
      if (next) {
        setMeasureMode(false);
        setMarkerMode(false);
        setMeasurePoints([]);
        setMeasureDistance(null);
        setPolygonPoints([]);
        setPolygonSummary(null);
      }
      return next;
    });
  };

  const toggleMeasureMode = () => {
    setMeasureMode((current) => {
      const next = !current;
      if (next) {
        setPolygonMode(false);
        setMarkerMode(false);
        setPolygonPoints([]);
        setPolygonSummary(null);
      } else {
        setMeasurePoints([]);
        setMeasureDistance(null);
      }
      return next;
    });
  };

  const toggleMarkerMode = () => {
    setMarkerMode((current) => {
      const next = !current;
      if (next) {
        setPolygonMode(false);
        setMeasureMode(false);
        setPolygonPoints([]);
        setMeasurePoints([]);
        setMeasureDistance(null);
      }
      return next;
    });
  };

  const activeInteractionLabel = polygonMode
    ? "Zona"
    : measureMode
    ? "Medición"
    : markerMode
    ? "Marcado"
    : visualFxOn
    ? "Navegación"
    : "Vista fija";
  const handleTaskAction = (callback, resourceLabel = "Producción / Gestión de tareas") => {
    if (!canManageTasks) {
      onBlockedTaskAction?.(resourceLabel);
      return;
    }
    callback();
  };

  return (
    <SectionCard
      title="Plano de producción"
      subtitle="Cada postura actúa como waypoint operativo para resumir tareas, gantt y validación con Tracking."
      actions={
        <ActionButton
          onClick={() =>
            handleTaskAction(() => onOpenNewTask(selectedWaypoint || null))
          }
        >
          <FaPlus />
          Nuevo plan
        </ActionButton>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <div className="rounded-[24px] border border-white/70 bg-white/92 px-4 py-4 shadow-[0_18px_32px_rgba(15,23,42,0.08)]">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div className="w-full lg:max-w-[280px]">
                  <FieldShell label="Mapa activo">
                    <select
                      className="tm-control"
                      value={selectedMapCode}
                      onChange={(event) => onMapCodeChange(event.target.value)}
                    >
                      {maps.map((item) => (
                        <option key={item.code} value={item.code}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </FieldShell>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone="blue">
                    <FaMapMarkedAlt />
                    {selectedMap?.label || "Mapa"}
                  </StatusBadge>
                  <StatusBadge tone="amber">
                    <FaRoute />
                    {filteredWaypoints.length} puntos visibles
                  </StatusBadge>
                  <StatusBadge tone={visualFxOn ? "indigo" : "red"}>
                    Navegación {visualFxOn ? "activa" : "pausada"}
                  </StatusBadge>
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-700/65 bg-[radial-gradient(circle_at_top_right,_rgba(56,189,248,0.16),_transparent_30%),linear-gradient(180deg,#0f172a_0%,#111827_100%)] p-4 shadow-[0_24px_60px_rgba(15,23,42,0.28)]">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="grid gap-2 sm:grid-cols-[repeat(3,minmax(0,1fr))]">
                  {[
                    { label: "Todos", value: "all" },
                    { label: "Solo atrasos", value: "delayed" },
                    { label: "Validados", value: "validated" },
                  ].map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setMapFilter(item.value)}
                      className={joinClasses(
                        "rounded-full border px-3 py-2 text-xs font-semibold transition",
                        mapFilter === item.value
                          ? "border-sky-500 bg-sky-500 text-white"
                          : "border-slate-200 bg-white/80 text-slate-700 hover:bg-slate-100"
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone="indigo">Modo {activeInteractionLabel}</StatusBadge>
                  {measureDistance != null ? (
                    <StatusBadge tone="green">Distancia {measureDistance.toFixed(0)} m</StatusBadge>
                  ) : null}
                  {markerPoints.length ? (
                    <StatusBadge tone="amber">Marcas {markerPoints.length}</StatusBadge>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setShowLabels((current) => !current)}
                    className="rounded-full border border-slate-200 bg-white/90 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                  >
                    {showLabels ? "Ocultar etiquetas" : "Mostrar etiquetas"}
                  </button>
                </div>
              </div>

              <div className="overflow-hidden rounded-[24px] border border-white/10 bg-slate-900">
                <div className="relative overflow-hidden">
                  <div className="absolute right-3 top-3 z-20 flex flex-row flex-wrap justify-end gap-2 sm:right-4 sm:top-4 sm:flex-col">
                    <MapControlButton
                      icon={<span className="text-base font-bold">+</span>}
                      label="Acercar"
                      disabled={!visualFxOn}
                      onClick={() => setManualScale((current) => Math.min(3, current + 0.2))}
                    />
                    <MapControlButton
                      icon={<span className="text-base font-bold">-</span>}
                      label="Alejar"
                      disabled={!visualFxOn}
                      onClick={() => setManualScale((current) => Math.max(0.55, current - 0.2))}
                    />
                    <MapControlButton
                      icon={<FaMapMarkerAlt />}
                      label="Marcar puntos"
                      active={markerMode}
                      onClick={toggleMarkerMode}
                    />
                    <MapControlButton
                      icon={<FaRulerCombined />}
                      label="Medir distancia"
                      active={measureMode}
                      onClick={toggleMeasureMode}
                    />
                    <MapControlButton
                      icon={<FaDrawPolygon />}
                      label="Dibujar polígono"
                      active={polygonMode}
                      onClick={togglePolygonMode}
                    />
                    <MapControlButton
                      icon={<FaMapMarkedAlt />}
                      label="Activar o pausar efectos"
                      active={visualFxOn}
                      onClick={() => {
                        setVisualFxOn((current) => !current);
                        setManualScale(1);
                        setPan({ x: 0, y: 0 });
                      }}
                    />
                    <MapControlButton
                      icon={<BsTrash3 />}
                      label="Limpiar herramientas"
                      onClick={clearMapOverlays}
                    />
                  </div>

                  <div
                    ref={mapContainerRef}
                    className="relative"
                    onClick={handleMapSurfaceClick}
                    onWheel={handleWheel}
                    onMouseDown={startPan}
                    onMouseMove={movePan}
                    onMouseUp={endPan}
                    onMouseLeave={endPan}
                    style={{
                      transform: `translate(${effectivePan.x}px, ${effectivePan.y}px) scale(${effectiveScale})`,
                      transformOrigin: "center center",
                      transition: isPanning ? "none" : "transform 0.2s ease-out",
                      cursor: polygonMode || measureMode || markerMode ? "crosshair" : visualFxOn ? (isPanning ? "grabbing" : "grab") : "default",
                    }}
                  >
                    <img
                      src={`/maps/${selectedMapCode}.jpeg`}
                      alt="Mapa operativo de producción"
                      className="block w-full select-none"
                    />

                    {(polygonPoints.length >= 2 || measurePoints.length === 2) && (
                      <svg
                        className="absolute inset-0 h-full w-full"
                        viewBox="0 0 1 1"
                        preserveAspectRatio="none"
                      >
                        {polygonPoints.length >= 2 ? (
                          <polygon
                            points={polygonPoints.map((point) => `${point.x},${point.y}`).join(" ")}
                            fill="rgba(56,189,248,0.14)"
                            stroke="rgba(37,99,235,0.95)"
                            strokeWidth="0.003"
                            strokeLinejoin="round"
                            strokeLinecap="round"
                            vectorEffect="non-scaling-stroke"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (polygonPoints.length >= 3) finalizePolygon();
                            }}
                            style={{ cursor: polygonPoints.length >= 3 ? "pointer" : "default" }}
                          />
                        ) : null}

                        {measurePoints.length === 2 ? (
                          <line
                            x1={measurePoints[0].x}
                            y1={measurePoints[0].y}
                            x2={measurePoints[1].x}
                            y2={measurePoints[1].y}
                            stroke="rgba(16,185,129,0.95)"
                            strokeWidth="0.003"
                            vectorEffect="non-scaling-stroke"
                          />
                        ) : null}
                      </svg>
                    )}

                    {polygonPoints.map((point, index) => (
                      <div
                        key={`poly-point-${index}`}
                        className="pointer-events-none absolute h-3.5 w-3.5 rounded-full border-2 border-white bg-sky-500 shadow-[0_8px_18px_rgba(37,99,235,0.35)]"
                        style={{
                          left: `${point.x * 100}%`,
                          top: `${point.y * 100}%`,
                          transform: "translate(-50%, -50%)",
                        }}
                      />
                    ))}

                    {measurePoints.map((point, index) => (
                      <div
                        key={`measure-point-${index}`}
                        className="pointer-events-none absolute h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-500 shadow-[0_8px_18px_rgba(16,185,129,0.3)]"
                        style={{
                          left: `${point.x * 100}%`,
                          top: `${point.y * 100}%`,
                          transform: "translate(-50%, -50%)",
                        }}
                      />
                    ))}

                    {markerPoints.map((point) => (
                      <div
                        key={point.id}
                        className="pointer-events-none absolute"
                        style={{
                          left: `${point.x * 100}%`,
                          top: `${point.y * 100}%`,
                          transform: "translate(-50%, -50%)",
                        }}
                      >
                        <div className="flex flex-col items-center gap-1">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full border border-white/90 bg-amber-400 text-slate-900 shadow-[0_10px_18px_rgba(245,158,11,0.28)]">
                            <FaMapMarkerAlt className="text-xs" />
                          </div>
                          <div className="rounded-full bg-slate-950/85 px-2 py-0.5 text-[10px] font-semibold text-white">
                            {point.label}
                          </div>
                        </div>
                      </div>
                    ))}

                    {filteredWaypoints.map((waypoint) => {
                      const tasks = tasksByWaypoint.get(waypoint.id) || [];
                      const isSelected = waypoint.id === selectedWaypointId;

                      return (
                        <button
                          key={waypoint.id}
                          type="button"
                          className="absolute transition hover:scale-[1.04]"
                          style={{
                            left: `${waypoint.xPct * 100}%`,
                            top: `${waypoint.yPct * 100}%`,
                            transform: "translate(-50%, -50%)",
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (polygonMode || measureMode || markerMode) return;
                            onSelectWaypoint(waypoint.id);
                            setPopupWaypointId(waypoint.id);
                          }}
                        >
                          <span className="relative block">
                            {isSelected ? (
                              <>
                                <span className="absolute -inset-4 animate-ping rounded-full border border-white/70" />
                                <span className="absolute -inset-2 rounded-[24px] border border-white/55" />
                              </>
                            ) : null}

                            <span
                              className={joinClasses(
                                "flex min-h-[52px] min-w-[52px] flex-col items-center justify-center rounded-[20px] border border-white/70 bg-[linear-gradient(135deg,rgba(14,165,233,0.95)_0%,rgba(37,99,235,0.95)_55%,rgba(15,23,42,0.98)_100%)] px-3 py-2 text-white shadow-[0_18px_34px_rgba(37,99,235,0.24)] ring-2",
                                waypointPulseClass(tasks)
                              )}
                            >
                              <span
                                className={joinClasses(
                                  showLabels ? "block" : "hidden",
                                  "text-[9px] font-semibold uppercase tracking-[0.18em]"
                                )}
                              >
                                {waypoint.nivel}
                              </span>
                              <span
                                className={joinClasses(
                                  showLabels ? "block" : "hidden",
                                  "mt-0.5 max-w-[92px] truncate text-[11px] font-semibold"
                                )}
                              >
                                {waypoint.postura}
                              </span>
                              <span className="mt-1 text-[10px] text-white/80">{tasks.length} tareas</span>
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {polygonSummary ? (
                <div className="mt-4 rounded-[22px] border border-slate-700/80 bg-slate-900/92 p-4 text-white">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">Resumen de zona seleccionada</div>
                      <div className="mt-1 text-xs text-slate-300">
                        Conteo de posturas y tareas dentro del polígono dibujado sobre el plano.
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge tone="blue">{polygonSummary.totalWaypoints} posturas</StatusBadge>
                      <StatusBadge tone="indigo">{polygonSummary.totalTasks} tareas</StatusBadge>
                      <StatusBadge tone="green">{polygonSummary.validated} con tracking</StatusBadge>
                      <StatusBadge tone="red">{polygonSummary.delayed} con atraso</StatusBadge>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {polygonSummary.waypoints.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-[18px] border border-slate-700/70 bg-slate-950/70 px-3 py-2"
                      >
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-200">
                          {item.nivel}
                        </div>
                        <div className="mt-1 text-sm font-semibold text-white">{item.postura}</div>
                        <div className="mt-1 text-xs text-slate-300">{item.tasks} tareas visibles</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-4">
            <MetricStrip
              items={[
                { label: "Waypoints con atraso", value: delayedCount },
                { label: "Frentes activos", value: inProgressCount },
                { label: "Cruces listos", value: validatedCount },
                { label: "Total puntos", value: filteredWaypoints.length },
              ]}
            />

            <div className="rounded-[24px] border border-white/70 bg-white/92 px-4 py-4 shadow-[0_18px_32px_rgba(15,23,42,0.08)]">
              <div className="flex items-center gap-2">
                <FaMountain className="text-indigo-600" />
                <div className="text-sm font-semibold text-slate-900">Estado del plano</div>
              </div>

              <div className="mt-3 space-y-3">
                <div className="flex items-center justify-between rounded-[18px] border border-slate-200 bg-slate-50/80 px-3 py-3 text-sm">
                  <span className="text-slate-600">Tareas con atraso</span>
                  <span className="font-semibold text-rose-600">{delayedCount}</span>
                </div>
                <div className="flex items-center justify-between rounded-[18px] border border-slate-200 bg-slate-50/80 px-3 py-3 text-sm">
                  <span className="text-slate-600">Waypoints validados con Tracking</span>
                  <span className="font-semibold text-sky-700">{validatedCount}</span>
                </div>
                <div className="flex items-center justify-between rounded-[18px] border border-slate-200 bg-slate-50/80 px-3 py-3 text-sm">
                  <span className="text-slate-600">Frentes en ejecución</span>
                  <span className="font-semibold text-emerald-700">{inProgressCount}</span>
                </div>
                <div className="flex items-center justify-between rounded-[18px] border border-slate-200 bg-slate-50/80 px-3 py-3 text-sm">
                  <span className="text-slate-600">Modo de mapa</span>
                  <span className="font-semibold text-slate-900">{mapModeLabel}</span>
                </div>
                <div className="flex items-center justify-between rounded-[18px] border border-slate-200 bg-slate-50/80 px-3 py-3 text-sm">
                  <span className="text-slate-600">Efectos visuales</span>
                  <span className="font-semibold text-slate-900">{visualFxOn ? "Activos" : "Pausados"}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {selectedWaypoint ? (
          <div className="rounded-[26px] border border-white/70 bg-white/94 shadow-[0_22px_40px_rgba(15,23,42,0.08)]">
            <div className="flex flex-col gap-4 border-b border-slate-200/80 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone="indigo">{selectedWaypoint.nivel}</StatusBadge>
                  <StatusBadge tone="blue">{selectedWaypoint.postura}</StatusBadge>
                  <StatusBadge tone="amber">{selectedWaypointTasks.length} tareas</StatusBadge>
                </div>
                <div className="mt-3 text-lg font-semibold tracking-tight text-slate-900">
                  Resumen de waypoint / postura
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  Plan y ejecución consolidada para el frente seleccionado.
                </div>
              </div>

              <ActionButton
                variant="secondary"
                onClick={() =>
                  handleTaskAction(() => onOpenNewTask(selectedWaypoint))
                }
              >
                <FaPlus />
                Crear tarea en esta postura
              </ActionButton>
            </div>

            <div className="grid gap-4 px-5 py-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
              <div className="overflow-hidden rounded-[22px] border border-slate-200/80 bg-white/92">
                <div className="border-b border-slate-200/80 px-4 py-3 text-sm font-semibold text-slate-900">
                  Tareas del frente
                </div>
                <div className="overflow-x-auto">
                  <table className="tm-data-table min-w-full text-slate-900">
                    <thead>
                      <tr className="text-left">
                        <th>Actividad</th>
                        <th>Plan</th>
                        <th>Estado</th>
                        <th>Tracking</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedWaypointTasks.map((task) => (
                        <tr key={task.id}>
                          <td>
                            <div className="font-medium text-slate-800">{task.activity}</div>
                            <div className="text-xs text-slate-500">
                              {task.type || "Sin tipo"} - {task.turno || "Sin turno"}
                            </div>
                          </td>
                          <td>{formatTaskTimeRange(task)}</td>
                          <td>{renderTaskStatus(task)}</td>
                          <td>{task.trackingPorticoId ? "Vinculado" : "Pendiente"}</td>
                          <td>
                            <ActionButton
                              variant="secondary"
                              className="!px-3 !py-1.5"
                              onClick={() =>
                                handleTaskAction(() => onOpenEditTask(task))
                              }
                            >
                              Editar
                            </ActionButton>
                          </td>
                        </tr>
                      ))}

                      {selectedWaypointTasks.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="text-center text-slate-500">
                            Aún no hay tareas para esta postura.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-[22px] border border-slate-200 bg-slate-50/85 px-4 py-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <FaClipboardCheck className="text-emerald-600" />
                    Foco operativo
                  </div>
                  <div className="mt-3 space-y-2 text-sm text-slate-600">
                    <div>Dominio minería: {selectedWaypoint.taskCounts?.mineria || 0}</div>
                    <div>Dominio OO.CC: {selectedWaypoint.taskCounts?.oocc || 0}</div>
                    <div>Pórtico de Tracking: {selectedWaypoint.trackingPorticoName || "Por definir en la tarea"}</div>
                  </div>
                </div>

                <div className="rounded-[22px] border border-slate-200 bg-slate-50/85 px-4 py-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <FaExclamationTriangle className="text-amber-600" />
                    Alertas del frente
                  </div>
                  <div className="mt-3 space-y-2 text-sm text-slate-600">
                    {selectedWaypointTasks.some((task) => task.status === "delayed") ? (
                      <div>Existe al menos una actividad atrasada respecto al plan.</div>
                    ) : (
                      <div>No hay atrasos visibles para este waypoint.</div>
                    )}
                    {selectedWaypointTasks.some((task) => !task.trackingPorticoId) ? (
                      <div>Hay tareas sin pórtico de validación configurado.</div>
                    ) : (
                      <div>Todas las tareas tienen cruce base con Tracking.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {popupWaypoint ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/75 px-4 py-8 backdrop-blur-sm"
          onClick={() => setPopupWaypointId(null)}
        >
          <div
            className="w-full max-w-5xl overflow-hidden rounded-[30px] border border-slate-700/60 bg-slate-900 shadow-[0_30px_80px_rgba(15,23,42,0.28)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-700/50 px-5 py-5">
              <div>
                <div className="text-lg font-semibold tracking-tight text-slate-100">{popupWaypoint.postura}</div>
                <div className="mt-1 text-sm text-slate-400">Resumen rapido del waypoint operativo seleccionado.</div>
              </div>

              <button
                type="button"
                onClick={() => setPopupWaypointId(null)}
                className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900 text-slate-400 shadow-sm transition hover:bg-slate-800 hover:text-slate-100"
              >
                x
              </button>
            </div>

            <div className="max-h-[80vh] overflow-y-auto px-5 py-5 text-slate-100">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[22px] border border-slate-700/70 bg-slate-900/95 px-4 py-4 shadow-[0_14px_28px_rgba(0,0,0,0.35)]">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">Nivel</div>
                  <div className="mt-2 text-2xl font-semibold tracking-tight text-white">{popupWaypoint.nivel}</div>
                </div>
                <div className="rounded-[22px] border border-slate-700/70 bg-slate-900/95 px-4 py-4 shadow-[0_14px_28px_rgba(0,0,0,0.35)]">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">Mineria</div>
                  <div className="mt-2 text-2xl font-semibold tracking-tight text-white">
                    {popupWaypoint.taskCounts?.mineria || 0}
                  </div>
                </div>
                <div className="rounded-[22px] border border-slate-700/70 bg-slate-900/95 px-4 py-4 shadow-[0_14px_28px_rgba(0,0,0,0.35)]">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">OO.CC</div>
                  <div className="mt-2 text-2xl font-semibold tracking-tight text-white">
                    {popupWaypoint.taskCounts?.oocc || 0}
                  </div>
                </div>
                <div className="rounded-[22px] border border-slate-700/70 bg-slate-900/95 px-4 py-4 shadow-[0_14px_28px_rgba(0,0,0,0.35)]">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">Tracking</div>
                  <div className="mt-2 text-2xl font-semibold tracking-tight text-white">
                    {popupWaypoint.trackingPorticoName ? "Listo" : "Pend"}
                  </div>
                </div>
              </div>

              {popupWaypoint.trackingPorticoName ? (
                <div className="mt-5 rounded-[22px] border border-slate-700/80 bg-slate-900/90 px-4 py-3 text-sm text-slate-300">
                  Pórtico asociado: <span className="font-semibold text-white">{popupWaypoint.trackingPorticoName}</span>
                </div>
              ) : null}

              <div className="mt-5 overflow-hidden rounded-[22px] border border-slate-700/80 bg-slate-900/92">
                <div className="overflow-x-auto">
                  <table className="tm-data-table min-w-full text-slate-900 [&_thead_tr]:!bg-slate-900/95 [&_thead_th]:!border-slate-700/80 [&_thead_th]:!text-slate-300 [&_tbody_td]:!border-slate-700/70 [&_tbody_td]:!text-white [&_tbody_tr:hover]:bg-white/5">
                    <thead>
                      <tr className="text-left">
                        <th>Tarea</th>
                        <th>Ventana</th>
                        <th>Estado</th>
                        <th>Tracking</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="bg-slate-900/80 text-white">
                      {popupWaypointTasks.map((task) => (
                        <tr key={`${task.id}-popup`}>
                          <td>
                            <div className="font-semibold text-white">{task.activity}</div>
                            <div className="text-xs text-slate-400">
                              {task.type || "Sin tipo"} - {task.turno || "Sin turno"}
                            </div>
                          </td>
                          <td>{formatTaskTimeRange(task)}</td>
                          <td>
                            <span className="inline-flex items-center gap-2 text-white">
                              <span className={joinClasses("h-2.5 w-2.5 rounded-full", toneForStatus(task.status))} />
                              <span className="capitalize">{task.status || "planned"}</span>
                            </span>
                          </td>
                          <td>{task.trackingPorticoId ? "Vinculado" : "Pendiente"}</td>
                          <td>
                            <ActionButton
                              variant="secondary"
                              className="!border-slate-700 !bg-slate-900/60 !text-slate-100 hover:!bg-slate-800 !px-3 !py-1.5"
                              onClick={() => {
                                handleTaskAction(() => {
                                  setPopupWaypointId(null);
                                  onOpenEditTask(task);
                                });
                              }}
                            >
                              Editar
                            </ActionButton>
                          </td>
                        </tr>
                      ))}

                      {popupWaypointTasks.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="text-center !text-slate-400">
                            Esta postura aun no tiene tareas programadas.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </SectionCard>
  );
}
