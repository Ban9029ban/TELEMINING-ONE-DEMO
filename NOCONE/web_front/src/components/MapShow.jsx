import React, { useEffect, useMemo, useRef, useState } from "react";
import { BsBroadcastPin, BsCameraVideoFill, BsTrash3 } from "react-icons/bs";
import {
  FaBell,
  FaCarSide,
  FaDrawPolygon,
  FaMapMarkedAlt,
  FaRulerCombined,
  FaSatelliteDish,
  FaTemperatureHigh,
  FaTimes,
  FaTools,
  FaUser,
  FaWind,
} from "react-icons/fa";

import { API_URL } from "../api-config";
import { ActionButton, StatusBadge, joinClasses } from "./SystemTheme";

const API = `${API_URL}/control`;
const MAP_GENERIC_WIDTH_METERS = 1000;

function levelToColorClass(level) {
  switch ((level || "").toLowerCase()) {
    case "green":
      return "bg-emerald-500";
    case "yellow":
      return "bg-amber-400";
    case "red":
      return "bg-rose-500";
    default:
      return "bg-slate-300";
  }
}

function levelToMarkerTone(level) {
  switch ((level || "").toLowerCase()) {
    case "green":
      return "from-emerald-500 to-lime-400 text-white ring-emerald-300/60 shadow-[0_18px_30px_rgba(16,185,129,0.3)]";
    case "yellow":
      return "from-amber-400 to-orange-400 text-slate-900 ring-amber-200/90 shadow-[0_18px_30px_rgba(245,158,11,0.26)]";
    case "red":
      return "from-rose-500 to-red-500 text-white ring-rose-300/60 shadow-[0_18px_30px_rgba(239,68,68,0.28)]";
    default:
      return "from-slate-500 to-slate-400 text-white ring-slate-300/70 shadow-[0_16px_28px_rgba(100,116,139,0.2)]";
  }
}

function isPointInPolygon(px, py, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const { x: xi, y: yi } = polygon[i];
    const { x: xj, y: yj } = polygon[j];

    const intersectsY = (yi > py) !== (yj > py);
    const intersect =
      intersectsY &&
      px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-9) + xi;

    if (intersect) inside = !inside;
  }
  return inside;
}

function normalizedDistance(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function mapCodeToLabel(mapCode) {
  if (mapCode === "NP_dia") return "Diamante - NP";
  if (mapCode === "NTI_andes_norte") return "NTI Andes Norte";
  return mapCode || "Mapa operativo";
}

function formatDateTime(value) {
  if (!value) return "N/A";
  try {
    return new Date(value).toLocaleString("es-CL", {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone: "America/Santiago",
    });
  } catch (_error) {
    return "N/A";
  }
}

function MapControlButton({ icon, label, active = false, onClick, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
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

function OverlayShell({ title, subtitle, children, onClose }) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/75 px-4 py-8 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl overflow-hidden rounded-[30px] border border-slate-700/60 bg-slate-900 shadow-[0_30px_80px_rgba(15,23,42,0.28)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-700/50 px-5 py-5">
          <div>
            <div className="text-lg font-semibold tracking-tight text-slate-100">
              {title}
            </div>
            {subtitle ? (
              <div className="mt-1 text-sm text-slate-400">{subtitle}</div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900 text-slate-400 shadow-sm transition hover:bg-slate-800 hover:text-slate-100"
          >
            <FaTimes />
          </button>
        </div>

        <div className="max-h-[80vh] overflow-y-auto px-5 py-5 text-slate-100">{children}</div>
      </div>
    </div>
  );
}

function PopupStat({ icon, label, value, tone = "blue" }) {
  const toneClasses = {
    blue: "from-sky-500 to-cyan-400 text-white ring-sky-400/35 shadow-[0_18px_30px_rgba(56,189,248,0.24)]",
    green: "from-emerald-500 to-lime-400 text-white ring-emerald-400/35 shadow-[0_18px_30px_rgba(16,185,129,0.24)]",
    amber: "from-amber-400 to-orange-400 text-slate-900 ring-amber-300/40 shadow-[0_18px_30px_rgba(245,158,11,0.22)]",
    rose: "from-rose-500 to-red-500 text-white ring-rose-300/35 shadow-[0_18px_30px_rgba(239,68,68,0.24)]",
  };

  return (
    <div className="rounded-[22px] border border-slate-700/70 bg-slate-900/95 px-4 py-4 shadow-[0_14px_28px_rgba(0,0,0,0.35)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
            {label}
          </div>
          <div className="mt-2 text-2xl font-semibold tracking-tight text-white">
            {value}
          </div>
        </div>
        <div
          className={joinClasses(
            "flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br ring-1",
            toneClasses[tone] || toneClasses.blue
          )}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

function ClimateSensorIcon({ className = "" }) {
  return (
    <span className={joinClasses("relative inline-flex h-5 w-5 items-center justify-center", className)}>
      <FaTemperatureHigh className="absolute left-[1px] top-[1px] text-[12px]" />
      <FaWind className="absolute -right-[2px] bottom-0 text-[11px]" />
    </span>
  );
}

function MarkerPreview({ kind, level, cameraSourceType, communicationStatus }) {
  const porticoOffline = communicationStatus === "offline";

  if (kind === "portico") {
    return (
      <div className="relative">
        <div
          className={joinClasses(
            "flex h-10 w-10 items-center justify-center rounded-[16px] border border-white/80 text-white ring-2 ring-white/80",
            porticoOffline
              ? "bg-[linear-gradient(135deg,#64748b_0%,#94a3b8_100%)] shadow-[0_14px_24px_rgba(100,116,139,0.26)]"
              : "bg-[linear-gradient(135deg,#2563eb_0%,#38bdf8_100%)] shadow-[0_14px_24px_rgba(37,99,235,0.26)]"
          )}
        >
          <BsBroadcastPin />
        </div>
        <div
          className={joinClasses(
            "absolute -bottom-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 rounded-[3px]",
            porticoOffline ? "bg-slate-500" : "bg-sky-500"
          )}
        />
      </div>
    );
  }

  if (kind === "portico_clima") {
    return (
      <div className="relative">
        <div
          className={joinClasses(
            "flex h-10 w-10 items-center justify-center rounded-[16px] border border-white/80 bg-gradient-to-br ring-2 ring-white/80",
            porticoOffline ? levelToMarkerTone("gray") : levelToMarkerTone(level)
          )}
        >
          <ClimateSensorIcon className="text-[1.05rem]" />
        </div>
        <div
          className={joinClasses(
            "absolute -bottom-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 rounded-[3px]",
            porticoOffline ? levelToColorClass("gray") : levelToColorClass(level)
          )}
        />
      </div>
    );
  }

  const isVideoSource =
    cameraSourceType === "video_file" || cameraSourceType === "mp4_url";
  const iconClass = isVideoSource
    ? "bg-[linear-gradient(135deg,#2563eb_0%,#38bdf8_100%)] shadow-[0_14px_24px_rgba(37,99,235,0.24)]"
    : "bg-[linear-gradient(135deg,#f97316_0%,#fb7185_100%)] shadow-[0_14px_24px_rgba(249,115,22,0.24)]";
  const tailClass = isVideoSource ? "bg-sky-500" : "bg-orange-500";

  return (
    <div className="relative">
      <div className={joinClasses("flex h-10 w-10 items-center justify-center rounded-[16px] border border-white/80 text-white ring-2 ring-white/80", iconClass)}>
        <BsCameraVideoFill />
      </div>
      <div className={joinClasses("absolute -bottom-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 rounded-[3px]", tailClass)} />
    </div>
  );
}

export default function MapShow({
  selectedMap,
  highlightedDeviceId,
  climateAlertDeviceId,
  onPickEquipmentAlertEntityId,
  highlightReason,
  onSelectionSource,
  onDeviceDetails,
  onDetailType,
  onClearHighlight,
}) {
  const [manualScale, setManualScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });

  const [mapDevices, setMapDevices] = useState([]);
  const [, setLoadingDevices] = useState(false);

  const [selectedPoint, setSelectedPoint] = useState(null);
  const [popupData, setPopupData] = useState(null);

  const [zoom, setZoom] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });

  const [polygonMode, setPolygonMode] = useState(false);
  const [polygonPoints, setPolygonPoints] = useState([]);
  const [polygonSummary, setPolygonSummary] = useState(null);
  const mapContainerRef = useRef(null);

  const [measureMode, setMeasureMode] = useState(false);
  const [measurePoints, setMeasurePoints] = useState([]);
  const [measureDistance, setMeasureDistance] = useState(null);
  const [showRadarCard, setShowRadarCard] = useState(true);

  const [visualFxOn, setVisualFxOn] = useState(false);

  const effectiveZoom = visualFxOn ? zoom * manualScale : 1;
  const effectiveTranslate = visualFxOn ? translate : { x: 0, y: 0 };
  const effectivePan = visualFxOn ? pan : { x: 0, y: 0 };

  const mapImageSrc = `/maps/${selectedMap}.jpeg`;

  const deviceCounters = useMemo(
    () => ({
      porticos: mapDevices.filter((device) => device.kind === "portico").length,
      climate: mapDevices.filter((device) => device.kind === "portico_clima").length,
      cameras: mapDevices.filter(
        (device) =>
          device.kind === "camera" &&
          device.camera_source_type !== "video_file" &&
          device.camera_source_type !== "mp4_url"
      ).length,
      videos: mapDevices.filter(
        (device) =>
          device.kind === "camera" &&
          (device.camera_source_type === "video_file" || device.camera_source_type === "mp4_url")
      ).length,
    }),
    [mapDevices]
  );

  useEffect(() => {
    if (!selectedMap) return;
    let active = true;

    const loadDevices = async () => {
      setLoadingDevices(true);
      try {
        const response = await fetch(`${API}/maps/devices/${selectedMap}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (active) setMapDevices(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error("Error cargando devices de mapa:", error);
        if (active) setMapDevices([]);
      } finally {
        if (active) setLoadingDevices(false);
      }
    };

    loadDevices();
    const refreshTimer = setInterval(loadDevices, 30000);
    return () => {
      active = false;
      clearInterval(refreshTimer);
    };
  }, [selectedMap]);

  useEffect(() => {
    if (!highlightedDeviceId || mapDevices.length === 0) return undefined;

    const device = mapDevices.find((item) => item.id === highlightedDeviceId);
    if (!device) return undefined;

    const source =
      highlightReason === "search"
        ? "search"
        : highlightReason === "alert"
        ? "alert"
        : "map";

    if (!visualFxOn) {
      handlePointClick(device, source);
      return undefined;
    }

    const tx = (0.5 - device.x_pct) * 100;
    const ty = (0.5 - device.y_pct) * 100;

    setZoom(1.6);
    setTranslate({ x: tx, y: ty });
    handlePointClick(device, source);

    const timeout = setTimeout(() => {
      setZoom(1);
      setTranslate({ x: 0, y: 0 });
    }, 1800);

    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightedDeviceId, mapDevices, visualFxOn]);

  const handlePointClick = async (device, source = "map") => {
    if (typeof onSelectionSource === "function") onSelectionSource(source);
    if (measureMode) return;

    setSelectedPoint(null);
    setPopupData(null);
    setPolygonSummary(null);

    if (source !== "alert" && typeof onPickEquipmentAlertEntityId === "function") {
      onPickEquipmentAlertEntityId(null);
    }

    if (device.kind === "camera") {
      if (source !== "search") {
        setSelectedPoint({
          ...device,
          totalPersonas: 0,
          totalVehiculos: 0,
          totalEquipos: 0,
          personas: [],
          vehiculos: [],
          equipos: [],
          climate: [],
        });
        setPopupData({ type: "camera" });
      }
      return;
    }

    try {
      const response = await fetch(`${API}/maps/portico-popup/${device.ref_id}`);
      const data = await response.json();

      const totalPersonas = data.personas?.length || 0;
      const totalVehiculos = data.vehiculos?.length || 0;
      const totalEquipos = data.equipos?.length || 0;

      const isClimatePortico = device.kind === "portico_clima";
      const climateRaw = isClimatePortico ? data.climate || [] : [];
      const isForcedClimate =
        isClimatePortico &&
        climateAlertDeviceId &&
        device.id === climateAlertDeviceId;

      if (
        source === "alert" &&
        !isForcedClimate &&
        Array.isArray(data.equipos) &&
        data.equipos.length > 0 &&
        typeof onPickEquipmentAlertEntityId === "function"
      ) {
        const idx = Math.floor(Math.random() * data.equipos.length);
        const equipment = data.equipos[idx];
        const equipmentId =
          equipment?.entity_id ??
          equipment?.entityId ??
          equipment?.id ??
          equipment?.equipment_id ??
          null;

        onPickEquipmentAlertEntityId(equipmentId);
      } else if (
        typeof onPickEquipmentAlertEntityId === "function" &&
        source === "alert"
      ) {
        onPickEquipmentAlertEntityId(null);
      }

      if (onDeviceDetails) {
        onDeviceDetails({
          ur_name: data.portico?.name || device.label || `Pórtico ${device.ref_id}`,
          personas: data.personas || [],
          vehiculos: data.vehiculos || [],
          equipos: data.equipos || [],
          climate: climateRaw,
          has_climate: isClimatePortico,
        });
      }

      if (onDetailType) onDetailType("tabs");

      if (source !== "search") {
        setSelectedPoint({
          ...device,
          totalPersonas,
          totalVehiculos,
          totalEquipos,
          last_event_at: data.portico?.last_event_at || null,
          has_climate: isClimatePortico,
          climate: climateRaw,
          equipos: data.equipos || [],
        });

        setPopupData({ type: "portico" });
      }
    } catch (error) {
      console.error("Error cargando popup de pórtico:", error);
    }
  };

  const handleMapBackgroundClick = (event) => {
    if (!mapContainerRef.current) return;

    const rect = mapContainerRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const point = {
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
    };

    if (polygonMode) {
      setPolygonPoints((prev) => [...prev, point]);
      return;
    }

    if (measureMode) {
      setPolygonSummary(null);
      setSelectedPoint(null);
      setPopupData(null);

      setMeasurePoints((prev) => {
        let next;
        if (prev.length === 0) next = [point];
        else if (prev.length === 1) next = [prev[0], point];
        else next = [prev[1], point];

        if (next.length === 2) {
          const meters = normalizedDistance(next[0], next[1]) * MAP_GENERIC_WIDTH_METERS;
          setMeasureDistance(meters);
        } else {
          setMeasureDistance(null);
        }

        return next;
      });

      return;
    }

    setSelectedPoint(null);
    setPopupData(null);
    setPolygonSummary(null);
  };

  const finalizePolygon = async () => {
    if (polygonPoints.length < 3) {
      setPolygonMode(false);
      return;
    }

    const insideDevices = mapDevices.filter((device) =>
      isPointInPolygon(device.x_pct, device.y_pct, polygonPoints)
    );

    const insidePorticos = insideDevices.filter(
      (device) => device.kind === "portico" || device.kind === "portico_clima"
    );

    let totalPersonas = 0;
    let totalVehiculos = 0;
    let totalEquipos = 0;
    const porticos = [];
    let allPersonas = [];
    let allVehiculos = [];
    let allEquipos = [];

    for (const device of insidePorticos) {
      try {
        const response = await fetch(`${API}/maps/portico-popup/${device.ref_id}`);
        const data = await response.json();

        const personas = data.personas || [];
        const vehiculos = data.vehiculos || [];
        const equipos = data.equipos || [];

        totalPersonas += personas.length;
        totalVehiculos += vehiculos.length;
        totalEquipos += equipos.length;

        allPersonas = allPersonas.concat(personas);
        allVehiculos = allVehiculos.concat(vehiculos);
        allEquipos = allEquipos.concat(equipos);

        porticos.push({
          id: device.id,
          name: data.portico?.name || device.label || `Pórtico ${device.ref_id}`,
          kind: device.kind,
          personas: personas.length,
          vehiculos: vehiculos.length,
          equipos: equipos.length,
        });
      } catch (error) {
        console.error("Error cargando resumen de pórtico en zona:", error);
      }
    }

    setPolygonSummary({
      totalDevices: insideDevices.length,
      totalPorticos: insidePorticos.length,
      totalPersonas,
      totalVehiculos,
      totalEquipos,
      porticos,
    });
    setSelectedPoint(null);
    setPopupData(null);
    setPolygonMode(false);

    if (onDeviceDetails) {
      onDeviceDetails({
        ur_name: `Zona seleccionada (${insidePorticos.length} pórticos)`,
        personas: allPersonas,
        vehiculos: allVehiculos,
        equipos: allEquipos,
        climate: [],
        has_climate: false,
      });
    }

    if (onDetailType) onDetailType("tabs");
  };

  const clearMapOverlays = () => {
    setPolygonMode(false);
    setPolygonPoints([]);
    setPolygonSummary(null);

    setMeasureMode(false);
    setMeasurePoints([]);
    setMeasureDistance(null);

    setSelectedPoint(null);
    setPopupData(null);

    setManualScale(1);
    setPan({ x: 0, y: 0 });
    setZoom(1);
    setTranslate({ x: 0, y: 0 });

    if (typeof onPickEquipmentAlertEntityId === "function") {
      onPickEquipmentAlertEntityId(null);
    }

    if (typeof onClearHighlight === "function") onClearHighlight();
  };

  const handleWheel = (event) => {
    if (!visualFxOn) return;
    const delta = event.deltaY > 0 ? -0.1 : 0.1;
    setManualScale((scale) => Math.min(3, Math.max(0.4, scale + delta)));
  };

  const startPan = (event) => {
    if (!visualFxOn) return;
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

  const renderIcon = (device) => {
    if (device.kind === "portico") {
      return <MarkerPreview kind="portico" communicationStatus={device.communication_status} />;
    }

    if (device.kind === "portico_clima") {
      const forced = climateAlertDeviceId && device.id === climateAlertDeviceId;
      const level = forced ? "red" : device.climate_level || "gray";
      return <MarkerPreview kind="portico_clima" level={level} communicationStatus={device.communication_status} />;
    }

    if (device.kind === "camera") {
      return <MarkerPreview kind="camera" cameraSourceType={device.camera_source_type} />;
    }

    return (
      <div className="flex h-10 w-10 items-center justify-center rounded-[16px] border border-white/80 bg-[linear-gradient(135deg,#64748b_0%,#94a3b8_100%)] text-white shadow-[0_16px_28px_rgba(100,116,139,0.18)] ring-2 ring-white/80">
        <FaSatelliteDish className="text-sm" />
      </div>
    );
  };

  const togglePolygonMode = () => {
    setPolygonMode((prev) => {
      const next = !prev;
      if (next) {
        setMeasureMode(false);
        setMeasurePoints([]);
        setMeasureDistance(null);
        setPolygonPoints([]);
        setPolygonSummary(null);
      }
      return next;
    });
  };

  const toggleMeasureMode = () => {
    setMeasureMode((prev) => {
      const next = !prev;
      if (next) {
        setPolygonMode(false);
        setPolygonPoints([]);
        setPolygonSummary(null);
      } else {
        setMeasurePoints([]);
        setMeasureDistance(null);
      }
      return next;
    });
  };

  const toggleVisualFx = () => {
    setVisualFxOn((prev) => !prev);
    setManualScale(1);
    setPan({ x: 0, y: 0 });
    setZoom(1);
    setTranslate({ x: 0, y: 0 });
  };

  return (
    <section className="mt-3 overflow-hidden rounded-[26px] border border-slate-800/20 bg-slate-950/90 p-3 shadow-[0_26px_50px_rgba(15,23,42,0.08)] sm:mt-4 sm:rounded-[30px] sm:p-4">
      <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between sm:mb-4 sm:gap-4">
        <div className="space-y-3 text-slate-100">
          <StatusBadge tone="indigo">Mapa GPS operativo</StatusBadge>
          <div>
            <h3 className="text-lg font-semibold tracking-tight text-white sm:text-xl">
              Navegación interactiva sobre {mapCodeToLabel(selectedMap)}
            </h3>
            <p className="mt-1 text-xs text-slate-300 sm:text-sm">
              Visualiza pórticos, cámaras, alertas y selección espacial desde una vista tipo centro de monitoreo.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="rounded-full border border-slate-700/40 bg-slate-900/80 px-2.5 py-1 text-[11px] font-semibold text-slate-100 shadow-sm sm:px-3 sm:py-1.5">
              Pórticos: {deviceCounters.porticos}
            </div>
            <div className="rounded-full border border-slate-700/40 bg-slate-900/80 px-2.5 py-1 text-[11px] font-semibold text-slate-100 shadow-sm sm:px-3 sm:py-1.5">
                Ambientales: {deviceCounters.climate}
            </div>
            <div className="rounded-full border border-slate-700/40 bg-slate-900/80 px-2.5 py-1 text-[11px] font-semibold text-slate-100 shadow-sm sm:px-3 sm:py-1.5">
              Cámaras: {deviceCounters.cameras}
            </div>
            <div className="rounded-full border border-slate-700/40 bg-slate-900/80 px-2.5 py-1 text-[11px] font-semibold text-slate-100 shadow-sm sm:px-3 sm:py-1.5">
              Videos: {deviceCounters.videos}
            </div>
            <div className="rounded-full border border-slate-700/40 bg-slate-900/80 px-2.5 py-1 text-[11px] font-semibold text-slate-100 shadow-sm sm:px-3 sm:py-1.5">
              Efectos: {visualFxOn ? "Activos" : "Bloqueados"}
            </div>
            <div className="rounded-full border border-slate-700/40 bg-slate-900/80 px-2.5 py-1 text-[11px] font-semibold text-slate-100 shadow-sm sm:px-3 sm:py-1.5">
              Modo: {polygonMode ? "Zona" : measureMode ? "Medición" : visualFxOn ? "Navegación" : "Vista fija"}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {measureDistance != null ? (
            <div className="rounded-full border border-emerald-200 bg-emerald-50/90 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 shadow-sm sm:px-3 sm:py-2">
              Distancia: {measureDistance.toFixed(0)} m aprox.
            </div>
          ) : null}

          {polygonMode && polygonPoints.length >= 3 ? (
            <ActionButton variant="secondary" onClick={finalizePolygon}>
              <FaDrawPolygon />
              Cerrar zona y calcular
            </ActionButton>
          ) : null}
        </div>
      </div>

      <div className="relative overflow-hidden rounded-[24px] border border-slate-200/80 bg-slate-100/90 sm:rounded-[28px]">
        {showRadarCard ? (
          <div className="absolute left-3 right-20 top-3 z-30 max-w-[240px] rounded-[20px] border border-slate-700/70 bg-slate-900/95 px-3 py-2.5 shadow-[0_18px_32px_rgba(15,23,42,0.16)] sm:left-4 sm:right-auto sm:top-4 sm:max-w-[260px] sm:rounded-[24px] sm:px-4 sm:py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 sm:text-[11px]">
                Radar de mapa
              </div>
              <button
                type="button"
                className="rounded-full border border-slate-700/80 bg-slate-900/90 px-2 py-1 text-[10px] font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
                onClick={() => setShowRadarCard(false)}
              >
                Cerrar
              </button>
            </div>
            <div className="mt-1.5 text-[13px] font-semibold text-white sm:mt-2 sm:text-sm">
              {selectedPoint?.label || "Selecciona un nodo para ver detalle"}
            </div>
            <div className="mt-1.5 text-[11px] leading-5 text-slate-400 sm:mt-2 sm:text-xs">
              Usa zoom, medición o selección de zona para explorar el plano sin salir de Tracking.
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="absolute left-3 top-3 z-30 rounded-full border border-slate-700/70 bg-slate-900/95 px-3 py-2 text-[11px] font-semibold text-white shadow-[0_18px_32px_rgba(15,23,42,0.16)] transition hover:bg-slate-800 sm:left-4 sm:top-4"
            onClick={() => setShowRadarCard(true)}
          >
            Radar
          </button>
        )}

        <div className="absolute right-3 top-3 z-30 flex flex-row flex-wrap justify-end gap-2 sm:right-4 sm:top-4 sm:flex-col">
          <MapControlButton
            icon={<span className="text-base font-bold">+</span>}
            label="Acercar"
            onClick={() => setManualScale((scale) => Math.min(3, visualFxOn ? scale + 0.2 : scale))}
          />
          <MapControlButton
            icon={<span className="text-base font-bold">-</span>}
            label="Alejar"
            onClick={() => setManualScale((scale) => Math.max(0.4, visualFxOn ? scale - 0.2 : scale))}
          />
          <MapControlButton
            icon={<FaDrawPolygon />}
            label="Dibujar zona"
            active={polygonMode}
            onClick={togglePolygonMode}
          />
          <MapControlButton
            icon={<FaRulerCombined />}
            label="Medir distancia"
            active={measureMode}
            onClick={toggleMeasureMode}
          />
          <MapControlButton
            icon={<FaMapMarkedAlt />}
            label="Activar o desactivar navegación"
            active={visualFxOn}
            onClick={toggleVisualFx}
          />
          <MapControlButton
            icon={<BsTrash3 />}
            label="Limpiar mapa"
            onClick={clearMapOverlays}
          />
        </div>

        <div
          ref={mapContainerRef}
          className="relative"
          onClick={handleMapBackgroundClick}
          onWheel={handleWheel}
          onMouseDown={startPan}
          onMouseMove={movePan}
          onMouseUp={endPan}
          onMouseLeave={endPan}
          style={{
            transform: `
              translate(${effectiveTranslate.x}%, ${effectiveTranslate.y}%)
              translate(${effectivePan.x}px, ${effectivePan.y}px)
              scale(${effectiveZoom})
            `,
            transformOrigin: "center center",
            transition: isPanning ? "none" : "transform 0.25s ease-out",
            cursor: visualFxOn
              ? isPanning
                ? "grabbing"
                : "grab"
              : polygonMode || measureMode
              ? "crosshair"
              : "default",
          }}
        >
          <img src={mapImageSrc} alt={selectedMap} className="block w-full select-none" />

          {(polygonPoints.length >= 2 || measurePoints.length === 2) && (
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
            >
              {polygonPoints.length >= 2 && (
                <polygon
                  points={polygonPoints.map((point) => `${point.x},${point.y}`).join(" ")}
                  fill="rgba(99,102,241,0.16)"
                  stroke="rgba(79,70,229,0.92)"
                  strokeWidth="0.003"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (polygonPoints.length >= 3) finalizePolygon();
                  }}
                  style={{
                    cursor: polygonPoints.length >= 3 ? "pointer" : "default",
                  }}
                />
              )}

              {measurePoints.length === 2 && (
                <line
                  x1={measurePoints[0].x}
                  y1={measurePoints[0].y}
                  x2={measurePoints[1].x}
                  y2={measurePoints[1].y}
                  stroke="rgba(16,185,129,0.94)"
                  strokeWidth="0.003"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>
          )}

          {polygonPoints.map((point, index) => (
            <div
              key={`poly-point-${index}`}
              className="pointer-events-none absolute h-3.5 w-3.5 rounded-full border-2 border-white bg-indigo-500 shadow-[0_8px_18px_rgba(79,70,229,0.35)]"
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

          {mapDevices.map((device) => {
            const isForcedClimate =
              device.kind === "portico_clima" &&
              climateAlertDeviceId &&
              device.id === climateAlertDeviceId;

            return (
              <button
                key={device.id}
                type="button"
                className="absolute transition hover:scale-[1.03]"
                style={{
                  left: `${device.x_pct * 100}%`,
                  top: `${device.y_pct * 100}%`,
                  transform: "translate(-50%, -50%)",
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  handlePointClick(device, "map");
                }}
                title={
                  (device.kind === "portico" || device.kind === "portico_clima") &&
                  device.communication_status === "offline"
                    ? `${device.label || "Pórtico"}: sin comunicación hace más de 5 minutos`
                    : device.label || "Nodo operativo"
                }
              >
                <div className="relative">
                  {(device.id === highlightedDeviceId || isForcedClimate) && (
                    <>
                      <span className="absolute -inset-4 rounded-full border-2 border-rose-500/80 animate-ping opacity-75" />
                      <span className="absolute -inset-2 rounded-[24px] border border-rose-300/80" />
                    </>
                  )}
                  {renderIcon(device)}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {selectedPoint && popupData ? (
        <PopupOverlay
          point={selectedPoint}
          climateAlertDeviceId={climateAlertDeviceId}
          onClose={() => {
            setSelectedPoint(null);
            setPopupData(null);
          }}
        />
      ) : null}

      {polygonSummary ? (
        <PolygonSummaryOverlay
          summary={polygonSummary}
          onClose={() => setPolygonSummary(null)}
        />
      ) : null}
    </section>
  );
}

function PopupOverlay({ point, climateAlertDeviceId, onClose }) {
  const isPortico = point.kind === "portico" || point.kind === "portico_clima";
  const isClimatePortico = point.kind === "portico_clima";
  const isForcedClimate =
    isClimatePortico && climateAlertDeviceId && point.id === climateAlertDeviceId;

  const popupClimateRows = isClimatePortico ? point.climate || [] : [];
  const forcedRows = isForcedClimate
    ? popupClimateRows.map((row) => {
        const yellowMax =
          row.yellow_max != null && !Number.isNaN(Number(row.yellow_max))
            ? Number(row.yellow_max)
            : null;

        const base =
          yellowMax != null
            ? yellowMax + 1.5
            : row.last_value != null
            ? Number(row.last_value) + 10
            : 10;

        return {
          ...row,
          last_value: base + Math.random() * 2,
          last_level: "red",
          last_ts: new Date().toISOString(),
        };
      })
    : popupClimateRows;

  return (
    <OverlayShell
      title={point.label}
      subtitle={
        isPortico
          ? "Resumen rápido del nodo operativo seleccionado."
          : "Acceso directo a la cámara analítica."
      }
      onClose={onClose}
    >
      <div className="space-y-5">
        {isPortico ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <PopupStat icon={<FaCarSide />} label="Vehículos" value={point.totalVehiculos || 0} tone="blue" />
            <PopupStat icon={<FaUser />} label="Personas" value={point.totalPersonas || 0} tone="green" />
            <PopupStat icon={<FaTools />} label="Equipos" value={point.totalEquipos || 0} tone="amber" />
            <PopupStat
              icon={<FaSatelliteDish />}
              label="Último evento"
              value={point.last_event_at ? "Reciente" : "Sin dato"}
              tone="rose"
            />
          </div>
        ) : null}

        {point.last_event_at ? (
          <div className="rounded-[22px] border border-slate-700/80 bg-slate-900/90 px-4 py-3 text-sm text-slate-300">
            Último evento registrado:{" "}
            <span className="font-semibold text-white">
              {formatDateTime(point.last_event_at)}
            </span>
          </div>
        ) : null}

        {isClimatePortico ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <StatusBadge tone={isForcedClimate ? "red" : "blue"}>
                Agentes ambientales
              </StatusBadge>
              {isForcedClimate ? (
                <StatusBadge tone="red">Alerta simulada</StatusBadge>
              ) : null}
            </div>

            <div className="overflow-hidden rounded-[22px] border border-slate-700/80 bg-slate-900/92">
              <div className="overflow-x-auto">
                <table className="tm-data-table min-w-full text-slate-900 [&_tbody_td]:!text-white [&_tbody_td]:border-slate-700/70 [&_tbody_tr:hover]:bg-white/5">
                  <thead>
                    <tr className="text-left">
                      <th>Sensor</th>
                      <th>Valor</th>
                      <th>Estado</th>
                      <th>Actualizado</th>
                    </tr>
                  </thead>
                  <tbody className="bg-slate-900/80 text-white">
                    {forcedRows.map((row, index) => (
                      <tr key={`${row.code || row.name || "sensor"}-${index}`}>
                        <td className="!text-white">{row.name || row.code || "Sensor"}</td>
                        <td className="!text-white">
                          {row.last_value != null
                            ? `${Number(row.last_value).toFixed(2)} ${row.unit || ""}`.trim()
                            : "-"}
                        </td>
                        <td className="!text-white">
                          <span className="inline-flex items-center gap-2 !text-white">
                            <span
                              className={joinClasses(
                                "h-2.5 w-2.5 rounded-full",
                                levelToColorClass(row.last_level)
                              )}
                            />
                            <span className="capitalize !text-white">{row.last_level || "sin dato"}</span>
                          </span>
                        </td>
                        <td className="!text-white">{row.last_ts ? formatDateTime(row.last_ts) : "-"}</td>
                      </tr>
                    ))}

                    {forcedRows.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="text-center !text-slate-200">
                          No hay lecturas ambientales para este portico.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}

        {point.kind === "camera" ? (
          <div className="rounded-[24px] border border-slate-700/80 bg-slate-900/95 px-4 py-5 text-slate-100">
            <div className="text-sm font-semibold text-white">
              Cámara con analítica IA
            </div>
            <p className="mt-2 text-sm text-slate-300">
              Tracking mantiene la referencia visual y el acceso directo; la operación de video vive en el módulo Cámaras.
            </p>
            <a
              href={`/cameras/ver?cam=${encodeURIComponent(point.ref_id ?? point.id ?? "")}`}
              className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-transparent bg-[linear-gradient(135deg,#4f46e5_0%,#2563eb_100%)] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(79,70,229,0.22)] transition hover:-translate-y-0.5"
            >
              <BsCameraVideoFill />
              Ver cámaras
            </a>
          </div>
        ) : null}
      </div>
    </OverlayShell>
  );
}

function PolygonSummaryOverlay({ summary, onClose }) {
  const [searchTerm, setSearchTerm] = useState("");
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredPorticos = (summary.porticos || []).filter((portico) =>
    [portico.name, portico.kind].filter(Boolean).join(" ").toLowerCase().includes(normalizedSearch)
  );

  return (
    <OverlayShell
      title="Zona seleccionada"
      subtitle="Resumen consolidado de entidades dentro del polígono dibujado."
      onClose={onClose}
    >
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <PopupStat icon={<FaMapMarkedAlt />} label="Dispositivos" value={summary.totalDevices} tone="blue" />
          <PopupStat icon={<BsBroadcastPin />} label="Pórticos" value={summary.totalPorticos} tone="indigo" />
          <PopupStat icon={<FaUser />} label="Personas" value={summary.totalPersonas} tone="green" />
          <PopupStat icon={<FaCarSide />} label="Vehículos" value={summary.totalVehiculos} tone="blue" />
          <PopupStat icon={<FaTools />} label="Equipos" value={summary.totalEquipos} tone="amber" />
        </div>

        <div className="space-y-3 overflow-hidden rounded-[22px] border border-slate-200/80 bg-white/92 p-4">
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Buscar en la tabla de pórticos..."
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[13px] text-slate-700 outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-100"
          />

          <div className="overflow-x-auto">
            <table className="tm-data-table min-w-full text-slate-900">
              <thead>
                <tr className="text-left">
                  <th>Pórtico</th>
                  <th>Tipo</th>
                  <th>Personas</th>
                  <th>Vehículos</th>
                  <th>Equipos</th>
                </tr>
              </thead>
              <tbody>
                {filteredPorticos.map((portico) => (
                  <tr key={portico.id}>
                    <td>{portico.name}</td>
                    <td>{portico.kind === "portico_clima" ? "Portico ambiental" : "Portico"}</td>
                    <td>{portico.personas}</td>
                    <td>{portico.vehiculos}</td>
                    <td>{portico.equipos}</td>
                  </tr>
                ))}

                {filteredPorticos.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center text-slate-500">
                      No hay pórticos dentro de la zona seleccionada.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </OverlayShell>
  );
}

function LegendRow({ preview, label }) {
  return (
    <div className="flex items-center gap-3">
      <div className="shrink-0">{preview}</div>
      <span className="text-[13px] text-slate-600 sm:text-sm">{label}</span>
    </div>
  );
}

function MapLegend() {
  const [open, setOpen] = useState(true);

  const thresholds = [
    { code: "CO2", name: "Gases (CO2 ppm)", green: "<= 900", yellow: "> 900 y <= 1200", red: "> 1200" },
    { code: "TEMP", name: "Temperatura (C)", green: "<= 26", yellow: "> 26 y <= 28", red: "> 28" },
    { code: "WIND", name: "Viento (m/s)", green: "<= 8", yellow: "> 8 y <= 12", red: "> 12" },
  ];

  return (
    <div className="overflow-hidden rounded-[24px] border border-white/70 bg-white/92 shadow-[0_18px_32px_rgba(15,23,42,0.08)] sm:rounded-[26px]">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3.5 py-3.5 text-left sm:px-4 sm:py-4"
        onClick={() => setOpen((value) => !value)}
      >
        <div>
          <div className="text-[13px] font-semibold text-slate-900 sm:text-sm">Leyenda interactiva</div>
          <div className="mt-1 text-xs text-slate-500">
            Referencias visuales del tracking y del mapa operativo.
          </div>
        </div>
        <StatusBadge tone="blue">{open ? "Visible" : "Oculta"}</StatusBadge>
      </button>

      {open ? (
        <div className="space-y-4 border-t border-slate-200/80 px-3.5 py-3.5 sm:px-4 sm:py-4">
          <LegendRow preview={<MarkerPreview kind="portico" />} label="Pórtico operativo: transmisión recibida durante los últimos 5 minutos" />
          <LegendRow preview={<MarkerPreview kind="portico" communicationStatus="offline" />} label="Pórtico plomo: sin comunicación hace más de 5 minutos" />
          <LegendRow preview={<MarkerPreview kind="portico_clima" level="green" />} label="Portico ambiental en estado normal" />
          <LegendRow preview={<MarkerPreview kind="portico_clima" level="yellow" />} label="Portico ambiental en advertencia" />
          <LegendRow preview={<MarkerPreview kind="portico_clima" level="red" />} label="Portico ambiental critico" />
          <LegendRow preview={<MarkerPreview kind="camera" />} label="Cámara / stream en vivo" />
          <LegendRow preview={<MarkerPreview kind="camera" cameraSourceType="video_file" />} label="Video local o MP4 configurado" />

          <div className="rounded-[20px] border border-slate-200 bg-slate-50/90 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Operación
            </div>
            <div className="mt-2 space-y-2 text-sm text-slate-600">
              <div>La selección resaltada muestra un pulso rojo alrededor del nodo.</div>
              <div>El polígono sirve para resumir personas, vehículos y equipos por sector.</div>
              <div>La medición usa una escala de referencia genérica sobre el plano.</div>
            </div>
          </div>

          <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-white/92">
            <div className="border-b border-slate-200/80 px-4 py-3 text-sm font-semibold text-slate-900">
              Umbrales ambientales de referencia
            </div>
            <div className="overflow-x-auto">
              <table className="tm-data-table min-w-full text-slate-900">
                <thead>
                  <tr className="text-left">
                    <th>Variable</th>
                    <th>Verde</th>
                    <th>Amarillo</th>
                    <th>Rojo</th>
                  </tr>
                </thead>
                <tbody>
                  {thresholds.map((row) => (
                    <tr key={row.code}>
                      <td>{row.name}</td>
                      <td>{row.green}</td>
                      <td>{row.yellow}</td>
                      <td>{row.red}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AlertToggle({ icon, label, description, enabled, onClick, tone = "blue" }) {
  const toneClasses = {
    blue: enabled
      ? "border-transparent bg-[linear-gradient(135deg,#4f46e5_0%,#2563eb_100%)] text-white shadow-[0_16px_28px_rgba(79,70,229,0.24)]"
      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
    rose: enabled
      ? "border-transparent bg-[linear-gradient(135deg,#ef4444_0%,#f97316_100%)] text-white shadow-[0_16px_28px_rgba(239,68,68,0.22)]"
      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={enabled}
      className={joinClasses(
        "w-full rounded-[22px] border px-4 py-4 text-left transition",
        toneClasses[tone]
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 text-base">{icon}</div>
          <div>
            <div className="text-sm font-semibold">{label}</div>
            <div className={joinClasses("mt-1 text-xs", enabled ? "text-white/80" : "text-slate-500")}>
              {description}
            </div>
          </div>
        </div>
        <StatusBadge tone={enabled ? "green" : "neutral"}>{enabled ? "ON" : "OFF"}</StatusBadge>
      </div>
    </button>
  );
}

function AlertTrackingPanel({ alertsEnabled, onTriggerAlert }) {
  const climateOn = Boolean(alertsEnabled?.climate);
  const equipmentOn = Boolean(alertsEnabled?.equipment);

  return (
    <div className="overflow-hidden rounded-[24px] border border-white/70 bg-white/92 shadow-[0_18px_32px_rgba(15,23,42,0.08)] sm:rounded-[26px]">
      <div className="border-b border-slate-200/80 px-4 py-4">
        <div className="flex items-center gap-2">
          <FaBell className="text-indigo-600" />
          <div className="text-[13px] font-semibold text-slate-900 sm:text-sm">Alertas Tracking</div>
        </div>
        <div className="mt-1 text-xs text-slate-500">
          Seguimiento visual y sonoro de condiciones operativas sobre el mapa.
        </div>
      </div>

      <div className="space-y-3 px-4 py-4">
        <AlertToggle
          icon={<ClimateSensorIcon className="text-[1.05rem]" />}
          label="Agentes ambientales"
          description="Enfoca el pórtico ambiental seleccionado y muestra su estado crítico."
          enabled={climateOn}
          onClick={() => onTriggerAlert?.("climate", !climateOn)}
          tone="rose"
        />

        <AlertToggle
          icon={<FaTools />}
          label="Equipos fuera de pórtico"
          description="Enfoca el pórtico y destaca el equipo implicado en la tabla."
          enabled={equipmentOn}
          onClick={() => onTriggerAlert?.("equipment", !equipmentOn)}
          tone="blue"
        />
      </div>
    </div>
  );
}

export { MapLegend, AlertTrackingPanel };
