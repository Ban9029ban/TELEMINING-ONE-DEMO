// web_front/src/components/MapShow_camaras.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { BsCameraVideoFill, BsDoorOpenFill, BsGearFill } from "react-icons/bs";
import { API_URL } from "../api-config";

const API = `${API_URL}/cameras`;

function isCameraOffline(device) {
  // Heurística flexible: si viene algún flag/estado lo usamos; si no, asumimos online.
  const s = (device?.status || "").toString().toLowerCase();
  if (s === "offline" || s === "down" || s === "disconnected") return true;
  if (device?.is_online === false) return true;
  if (device?.online === false) return true;
  return false;
}

export default function MapShowCamaras({
  selectedMap,
  highlightedDeviceId,
  filterKinds, // opcional, pero por defecto solo cámaras
}) {
  const effectiveKinds =
    Array.isArray(filterKinds) && filterKinds.length > 0
      ? filterKinds
      : ["camera"];

  const getKindLabel = (kind) => {
    if (kind === "gate") return "Portón";
    if (kind === "fan") return "Ventilador";
    return "Cámara";
  };

  // Zoom manual + Pan (con FX)
  const [manualScale, setManualScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });

  const [mapDevices, setMapDevices] = useState([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [showActiveOnly, setShowActiveOnly] = useState(true);
  const [showOnlineOnly, setShowOnlineOnly] = useState(true);

  const [selectedPoint, setSelectedPoint] = useState(null);
  const [popupData, setPopupData] = useState(null);

  // Zoom animado por highlight
  const [zoom, setZoom] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });

  const [visualFxOn, setVisualFxOn] = useState(false);
  const mapContainerRef = useRef(null);

  // Valores efectivos según FX
  const effectiveZoom = visualFxOn ? zoom * manualScale : 1;
  const effectiveTranslate = visualFxOn ? translate : { x: 0, y: 0 };
  const effectivePan = visualFxOn ? pan : { x: 0, y: 0 };

  const mapImageSrc = `/maps/${selectedMap}.jpeg`;
  const visibleDevices = useMemo(
    () =>
      mapDevices.filter((device) => {
        if (showActiveOnly && !device?.is_active) return false;
        if (showOnlineOnly && !device?.is_online) return false;
        return true;
      }),
    [mapDevices, showActiveOnly, showOnlineOnly],
  );

  // --------------------------------------------------------
  // 1) Cargar dispositivos del mapa (filtrados solo cámaras)
  // --------------------------------------------------------
  useEffect(() => {
    if (!selectedMap) return;
    setLoadingDevices(true);

    fetch(`${API}/map-devices/${selectedMap}`)
      .then((res) => res.json())
      .then((data) => {
        if (!Array.isArray(data)) {
          console.warn("Respuesta inesperada en /cameras/map-devices:", data);
          setMapDevices([]);
          return;
        }

        const filtered = data.filter((d) => effectiveKinds.includes(d.kind));
        setMapDevices(filtered);
      })
      .catch((err) => {
        console.error("Error cargando devices de mapa (cámaras):", err);
        setMapDevices([]);
      })
      .finally(() => setLoadingDevices(false));
  }, [selectedMap, effectiveKinds.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  // --------------------------------------------------------
  // 2) Animación de zoom cuando llega highlightedDeviceId
  // --------------------------------------------------------
  useEffect(() => {
    if (!highlightedDeviceId || visibleDevices.length === 0) return;

    const device = visibleDevices.find((d) => d.id === highlightedDeviceId);
    if (!device) return;

    if (!visualFxOn) {
      handlePointClick(device);
      return;
    }

    const targetX = device.x_pct;
    const targetY = device.y_pct;
    const tx = (0.5 - targetX) * 100;
    const ty = (0.5 - targetY) * 100;

    setZoom(1.6);
    setTranslate({ x: tx, y: ty });

    handlePointClick(device);

    const timeout = setTimeout(() => {
      setZoom(1);
      setTranslate({ x: 0, y: 0 });
    }, 1800);

    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightedDeviceId, visibleDevices, visualFxOn]);

  useEffect(() => {
    if (!selectedPoint) return;
    const stillVisible = visibleDevices.some((device) => device.id === selectedPoint.id);
    if (!stillVisible) {
      setSelectedPoint(null);
      setPopupData(null);
    }
  }, [selectedPoint, visibleDevices]);

  // --------------------------------------------------------
  // 3) Click en un punto
  // --------------------------------------------------------
  const handlePointClick = (device) => {
    setSelectedPoint(null);
    setPopupData(null);

    setSelectedPoint({
      ...device,
      offline: isCameraOffline(device),
    });
    setPopupData({ type: "device" });
  };

  // Click en fondo: cerrar popup
  const handleMapBackgroundClick = () => {
    setSelectedPoint(null);
    setPopupData(null);
  };

  // Zoom con wheel (solo FX ON)
  const handleWheel = (e) => {
    if (!visualFxOn) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setManualScale((s) => Math.min(3, Math.max(0.4, s + delta)));
  };

  // Pan con click-drag (solo FX ON)
  const startPan = (e) => {
    if (!visualFxOn) return;
    setIsPanning(true);
    panStart.current = {
      x: e.clientX - pan.x,
      y: e.clientY - pan.y,
    };
  };

  const movePan = (e) => {
    if (!visualFxOn || !isPanning) return;
    setPan({
      x: e.clientX - panStart.current.x,
      y: e.clientY - panStart.current.y,
    });
  };

  const endPan = () => setIsPanning(false);

  const toggleVisualFx = () => {
    setVisualFxOn((prev) => !prev);
    // reset transformaciones
    setManualScale(1);
    setPan({ x: 0, y: 0 });
    setZoom(1);
    setTranslate({ x: 0, y: 0 });
  };

  const resetView = () => {
    setSelectedPoint(null);
    setPopupData(null);
    setManualScale(1);
    setPan({ x: 0, y: 0 });
    setZoom(1);
    setTranslate({ x: 0, y: 0 });
  };

  const renderDeviceIcon = (device) => {
    const kind = String(device?.device_kind || device?.kind || "camera").toLowerCase();
    const offline = isCameraOffline(device);
    const isVideoSource =
      device?.camera_source_type === "video_file" || device?.camera_source_type === "mp4_url";
    const iconClass = offline
      ? "bg-[linear-gradient(135deg,#94a3b8_0%,#64748b_100%)] shadow-[0_14px_24px_rgba(148,163,184,0.24)]"
      : isVideoSource
      ? "bg-[linear-gradient(135deg,#2563eb_0%,#38bdf8_100%)] shadow-[0_14px_24px_rgba(37,99,235,0.24)]"
      : "bg-[linear-gradient(135deg,#f97316_0%,#fb7185_100%)] shadow-[0_14px_24px_rgba(249,115,22,0.24)]";
    const shapeClass = kind === "gate" ? "rounded-[8px]" : kind === "fan" ? "rounded-none" : "rounded-full";
    const shapeStyle = kind === "fan" ? { clipPath: "polygon(50% 2%, 96% 94%, 4% 94%)" } : undefined;
    const tailClass = offline ? "bg-slate-500" : isVideoSource ? "bg-sky-500" : "bg-orange-500";

    return (
      <div className="relative">
        <div
          className={`flex h-10 w-10 items-center justify-center border border-white/80 text-white ring-2 ring-white/80 ${shapeClass} ${iconClass}`}
          style={shapeStyle}
        >
          {kind === "gate" ? <BsDoorOpenFill /> : kind === "fan" ? <BsGearFill /> : <BsCameraVideoFill />}
        </div>
        <div className={`absolute -bottom-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 rounded-[3px] ${tailClass}`} />
      </div>
    );
  };

  return (
    <div className="mt-4 relative">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowActiveOnly((prev) => !prev)}
          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
            showActiveOnly
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : "border-slate-200 bg-white text-slate-600"
          }`}
        >
          {showActiveOnly ? "Activas: solo activas" : "Activas: todas"}
        </button>
        <button
          type="button"
          onClick={() => setShowOnlineOnly((prev) => !prev)}
          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
            showOnlineOnly
              ? "border-sky-300 bg-sky-50 text-sky-700"
              : "border-slate-200 bg-white text-slate-600"
          }`}
        >
          {showOnlineOnly ? "Online: solo online" : "Online: todas"}
        </button>
        <div className="text-xs text-slate-500">
          Mostrando {visibleDevices.length} de {mapDevices.length} fuentes del plano.
        </div>
      </div>

      {/* Controles (zoom, FX, reset) */}
      <div className="absolute top-2 right-2 z-30 flex flex-col space-y-2">
        <button
          onClick={() =>
            setManualScale((s) => Math.min(3, visualFxOn ? s + 0.2 : s))
          }
          className="bg-white border rounded px-3 py-1 shadow text-sm"
          title="Acercar (requiere FX ON)"
        >
          +
        </button>
        <button
          onClick={() =>
            setManualScale((s) => Math.max(0.4, visualFxOn ? s - 0.2 : s))
          }
          className="bg-white border rounded px-3 py-1 shadow text-sm"
          title="Alejar (requiere FX ON)"
        >
          −
        </button>

        <button
          onClick={toggleVisualFx}
          className={`bg-white border rounded px-2 py-1 shadow text-xs flex items-center justify-center ${
            visualFxOn ? "bg-purple-100 border-purple-400" : ""
          }`}
          title="Activar/desactivar zoom y pan suaves"
        >
          🎛️
        </button>

        <button
          onClick={resetView}
          className="bg-white border rounded px-2 py-1 shadow text-xs flex items-center justify-center"
          title="Reset vista y cerrar popup"
        >
          🧹
        </button>
      </div>

      {/* Caja del mapa */}
      <div className="relative w-full border rounded bg-gray-100 overflow-hidden">
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
              : "default",
          }}
        >
          <img src={mapImageSrc} alt={selectedMap} className="w-full block" />

          {/* Dispositivos NOC */}
          {visibleDevices.map((d) => (
            <button
              key={d.id}
              type="button"
              className="absolute"
              style={{
                left: `${d.x_pct * 100}%`,
                top: `${d.y_pct * 100}%`,
                transform: "translate(-50%, -50%)",
              }}
              onClick={(e) => {
                e.stopPropagation();
                handlePointClick(d);
              }}
              title={d.label || getKindLabel(d.device_kind || d.kind)}
            >
              <div className="relative">
                {d.id === highlightedDeviceId && (
                  <span className="absolute -inset-3 rounded-full border-2 border-red-500 animate-ping opacity-70" />
                )}
                {renderDeviceIcon(d)}
              </div>
            </button>
          ))}
        </div>

        {loadingDevices && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/60 text-sm">
            Cargando dispositivos...
          </div>
        )}
      </div>

      {/* Popup dispositivo */}
      {selectedPoint && popupData?.type === "device" && (
        <PopupCameraOverlay
          point={selectedPoint}
          onClose={() => {
            setSelectedPoint(null);
            setPopupData(null);
          }}
        />
      )}
    </div>
  );
}

function PopupCameraOverlay({ point, onClose }) {
  const kind = String(point?.device_kind || point?.kind || "camera").toLowerCase();
  const kindLabel = kind === "gate" ? "Portón" : kind === "fan" ? "Ventilador" : "Cámara";

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/20"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl px-5 py-4 text-xs max-w-xl w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-2">
          <div className="font-semibold text-sm">{point.label || kindLabel}</div>
          <button
            className="text-gray-500 hover:text-gray-700 text-lg leading-none"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="text-center text-[11px] space-y-2 mt-2 mb-1">
          <div>
            {kindLabel} en monitoreo NOC{" "}
            {point.offline ? (
              <span className="text-rose-600">(Off)</span>
            ) : (
              <span className="text-emerald-600">(On)</span>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-[11px] text-slate-600">
            <div>
              <b>Tipo:</b> {kindLabel}
            </div>
            <div>
              <b>Estado:</b> {point.is_active ? "Activa" : "Inactiva"} / {point.is_online ? "On" : "Off"}
            </div>
            <div>
              <b>Sitio:</b> {[point.camera_site, point.camera_nivel].filter(Boolean).join(" / ") || "-"}
            </div>
            <div>
              <b>Host:</b> {point.camera_ip || "-"}
            </div>
            <div>
              <b>Puerto:</b> {point.camera_port || "-"}
            </div>
            <div className="break-all">
              <b>Origen:</b> {point.camera_source || "-"}
            </div>
          </div>

          {kind === "camera" ? (
            <a
              href={`/cameras/ver?cam=${encodeURIComponent(point.ref_id ?? point.camera_id ?? point.id ?? "")}`}
              className="inline-block px-3 py-1 text-[11px] rounded bg-blue-600 text-white hover:bg-blue-700"
            >
              Ver cámaras
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
