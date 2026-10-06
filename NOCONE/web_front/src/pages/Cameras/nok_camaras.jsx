import { DIAMANTE_MAP_IMAGE, DIAMANTE_MAP_ASPECT_RATIO } from "../../config/cameraMaps";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BsArrowClockwise,
  BsCameraVideoFill,
  BsDoorOpenFill,
  BsExclamationTriangleFill,
  BsGearFill,
  BsHouseDoorFill,
  BsPersonCircle,
  BsTrash3,
  BsWifi,
  BsWifiOff,
} from "react-icons/bs";
import {
  FaDrawPolygon,
  FaFan,
  FaMapMarkedAlt,
  FaRulerCombined,
} from "react-icons/fa";
import { Link, useLocation } from "react-router-dom";

import { API_URL } from "../../api-config";
import teleminingLogo from "../../images/teleminin.png";
import { isAdminRole } from "../../utils/accessControl";
import {
  ActionButton,
  EmptyState,
  PageShell,
  SectionCard,
  StatusBadge,
  joinClasses,
} from "../../components/SystemTheme";

const NOK_OVERVIEW_API = `${API_URL}/cameras/nok/overview`;
const NOK_LAYOUT_API = `${API_URL}/cameras/nok/layout`;
const MAP_GENERIC_WIDTH_METERS = 1000;
const FEATURED_MAP_CODE = "NP_dia";
const SECONDARY_MAP_LAYOUT_PRIORITY = {
  UCL_dia: 0,
};
const MAP_IMAGE_OVERRIDES = {
  NP_dia: DIAMANTE_MAP_IMAGE,
  NTI_nok: "/maps/NTI_nok.png?v=20260712-2",
  UCL_dia: "/maps/UCL_dia.png?v=20260710-1",
};
// Andes Norte no forma parte de la operación del NOC. Se conserva en los datos
// para los demás módulos que lo utilizan, pero no se dibuja en este tablero.
const HIDDEN_MAP_CODES = new Set(["NTI_andes_norte"]);
const BOTTOM_ROW_POPUP_MAP_CODES = new Set(["UCL_DIA"]);
const DEFAULT_MAP_ASPECT_RATIO = 1600 / 503;
const DEFAULT_NOK_POLL_INTERVAL_MS = 30000;
const MAP_ASPECT_RATIOS = {
  NP_dia: DIAMANTE_MAP_ASPECT_RATIO,
  NTI_dia: 1600 / 503,
  NTI_nok: 1300 / 503,
  UCL_dia: 850 / 601,
  NTI_andes_norte: 2000 / 1294,
};
const FULLSCREEN_CHROME_TOP_PX = 16;
const FULLSCREEN_CHROME_GAP_PX = 20;
const FULLSCREEN_RAIL_LEFT_PX = 72;
const FULLSCREEN_PANEL_LEFT_PX = 88;
const FULLSCREEN_RAIL_ITEMS = [
  { to: "/", label: "Tracking", icon: <BsHouseDoorFill size={12} /> },
  { to: "/access", label: "Acceso", icon: <BsDoorOpenFill size={12} /> },
  { to: "/cameras", label: "Cámaras", icon: <BsCameraVideoFill size={12} /> },
  { to: "/cameras/nok", label: "NOC", icon: <BsExclamationTriangleFill size={12} /> },
  { to: "/config", label: "Configuración", icon: <BsGearFill size={12} /> },
];
const DEVICE_KIND_OPTIONS = ["camera", "gate", "fan"];

const EMPTY_OVERVIEW = {
  generated_at: null,
  refresh_ttl_seconds: 0,
  summary: {
    maps: 0,
    total_cameras: 0,
    online_cameras: 0,
    offline_cameras: 0,
    inactive_cameras: 0,
    last_checked_at: null,
  },
  maps: [],
};

const EMPTY_TABLE_FILTERS = {
  map_number: "",
  map_label: "",
  camera_name: "",
  ip: "",
  checked_at: "",
  offline_since: "",
  duration: "",
  detail: "",
};

function buildAuthHeaders() {
  if (typeof window === "undefined") {
    return {};
  }

  const token = window.localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function defaultNokLayoutMap(mapItem, index = 0) {
  return {
    code: mapItem.code,
    label: mapItem.label || mapItem.code,
    image_url: resolveMapImageUrl(mapItem),
    visible: true,
    layout: {
      x: index % 2 ? 50 : 0,
      y: Math.floor(index / 2) * 50,
      width: 50,
      height: 50,
    },
  };
}

function normalizeNokLayout(payload) {
  return {
    version: 1,
    mode: ["manual", "manual_visual"].includes(payload?.mode)
      ? payload.mode
      : "responsive",
    maps: Array.isArray(payload?.maps) ? payload.maps : [],
  };
}

function mergeNokLayoutMaps(maps, layout) {
  const sourceMaps = Array.isArray(maps) ? maps : [];
  const configuredMaps = Array.isArray(layout?.maps) ? layout.maps : [];
  if (!configuredMaps.length) return sourceMaps;

  const sourceByCode = new Map(sourceMaps.map((item) => [item.code, item]));
  const configuredCodes = new Set();
  const merged = configuredMaps.map((configured, index) => {
    configuredCodes.add(configured.code);
    const source = sourceByCode.get(configured.code);
    return {
      ...(source || { code: configured.code, cameras: [], sort_order: index }),
      ...configured,
      configured_image_url: configured.image_url,
      image_url: configured.image_url || source?.image_url,
      cameras: source?.cameras || [],
    };
  });

  return [
    ...merged,
    ...sourceMaps.filter((item) => !configuredCodes.has(item.code)),
  ];
}

function buildMarkerBlinkSeed(camera) {
  const cameraId = Number(camera.camera_id || 0);
  const mapNumber = Number(camera.map_number || 0);
  const xSeed = Math.round(Number(camera.x_pct || 0) * 1000);
  const ySeed = Math.round(Number(camera.y_pct || 0) * 1000);

  return cameraId * 17 + mapNumber * 31 + xSeed * 7 + ySeed * 13;
}

function buildMarkerBlinkStyle(camera) {
  const seed = buildMarkerBlinkSeed(camera);
  const duration = 1.45 + (seed % 9) * 0.16;
  const delay = -((seed % 11) * 0.23);
  const minOpacity = camera.is_online
    ? 0.58 + (seed % 3) * 0.06
    : 0.34 + (seed % 3) * 0.07;
  const glowBoost = camera.is_online
    ? 1.05 + (seed % 4) * 0.04
    : 1.08 + (seed % 4) * 0.05;

  return {
    animation: `nokMarkerBlink ${duration.toFixed(2)}s ease-in-out ${delay.toFixed(2)}s infinite`,
    "--nok-marker-min-opacity": minOpacity.toFixed(2),
    "--nok-marker-glow-boost": glowBoost.toFixed(2),
  };
}

function NokMarkerAnimationStyles() {
  return (
    <style>
      {`
        @keyframes nokMarkerBlink {
          0%, 100% {
            opacity: 1;
            filter: brightness(1) saturate(1);
          }
          12% {
            opacity: var(--nok-marker-min-opacity, 0.5);
            filter: brightness(var(--nok-marker-glow-boost, 1.1)) saturate(1.14);
          }
          22% {
            opacity: 0.96;
            filter: brightness(1.02) saturate(1.02);
          }
          48% {
            opacity: calc(var(--nok-marker-min-opacity, 0.5) + 0.1);
            filter: brightness(calc(var(--nok-marker-glow-boost, 1.1) + 0.06)) saturate(1.2);
          }
          62% {
            opacity: 1;
            filter: brightness(1.03) saturate(1.04);
          }
        }
      `}
    </style>
  );
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function resolveNokPollIntervalMs(value) {
  const intervalSeconds = Number(value);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    return DEFAULT_NOK_POLL_INTERVAL_MS;
  }

  return Math.max(DEFAULT_NOK_POLL_INTERVAL_MS, Math.round(intervalSeconds * 1000));
}

function useChileDateTimeLabel() {
  const [label, setLabel] = useState("");

  useEffect(() => {
    const updateLabel = () => {
      const now = new Date();
      const day = now.toLocaleString("es-CL", {
        day: "2-digit",
        timeZone: "America/Santiago",
      });
      const month = now.toLocaleString("es-CL", {
        month: "long",
        timeZone: "America/Santiago",
      });
      const year = now.toLocaleString("es-CL", {
        year: "numeric",
        timeZone: "America/Santiago",
      });
      const time = now.toLocaleString("es-CL", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: "America/Santiago",
      });
      setLabel(`${day} de ${month} de ${year}, ${time}`);
    };

    updateLabel();
    const intervalId = window.setInterval(updateLabel, 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  return label;
}

function isFullscreenRailItemActive(pathname, path) {
  if (path === "/cameras") {
    return (
      pathname === "/cameras" ||
      (pathname.startsWith("/cameras/") && !pathname.startsWith("/cameras/nok"))
    );
  }

  if (path === "/cameras/nok") {
    return pathname === "/cameras/nok" || pathname.startsWith("/cameras/nok/");
  }

  return path === "/" ? pathname === "/" : pathname.startsWith(path);
}

function NokFullscreenRail() {
  const location = useLocation();

  return (
    <aside className="absolute bottom-4 left-4 top-4 z-[175] flex w-[64px] flex-col justify-between rounded-[28px] border border-white/12 bg-[linear-gradient(180deg,#091224_0%,#0b1530_46%,#101c3f_100%)] shadow-[0_28px_55px_rgba(2,6,23,0.42)]">
      <div>
        <div className="border-b border-white/8 px-2.5 py-3">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl border border-white/12 bg-white/8 font-['Sora'] text-base font-semibold tracking-tight text-white">
            TM
          </div>
        </div>

        <nav className="px-2 py-3">
          <ul className="space-y-2">
            {FULLSCREEN_RAIL_ITEMS.map((item) => {
              const active = isFullscreenRailItemActive(location.pathname, item.to);
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    title={item.label}
                    className={joinClasses(
                      "flex h-10 w-10 items-center justify-center rounded-[14px] border transition",
                      active
                        ? "border-indigo-400/35 bg-[linear-gradient(135deg,rgba(79,70,229,0.32)_0%,rgba(37,99,235,0.18)_55%,rgba(6,182,212,0.14)_100%)] text-white shadow-[0_18px_34px_rgba(37,99,235,0.2)]"
                        : "border-white/8 bg-white/5 text-slate-200/88 hover:border-white/12 hover:bg-white/10 hover:text-white"
                    )}
                  >
                    {item.icon}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      <div className="px-2 pb-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-[14px] border border-cyan-400/18 bg-cyan-400/10 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
          NOC
        </div>
      </div>
    </aside>
  );
}

function NokFullscreenStatBox({ icon, label, value, meta, tone = "blue" }) {
  const toneStyles = {
    blue: "border-sky-100 bg-sky-50/88 text-sky-700",
    green: "border-emerald-100 bg-emerald-50/88 text-emerald-700",
    red: "border-rose-100 bg-rose-50/88 text-rose-700",
  };

  return (
    <div className="rounded-[18px] border border-white/80 bg-white/92 px-3 py-2.5 shadow-[0_12px_26px_rgba(15,23,42,0.08)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            {label}
          </div>
          <div className="mt-1.5 text-[1.55rem] font-semibold tracking-tight text-slate-950">
            {value}
          </div>
          {meta ? (
            <div className="mt-1 text-[11px] leading-4 text-slate-500">{meta}</div>
          ) : null}
        </div>

        {icon ? (
          <div
            className={joinClasses(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border",
              toneStyles[tone] || toneStyles.blue
            )}
          >
            {icon}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function NokFullscreenChrome({
  title,
  subtitle,
  onExit,
  onConfigure,
  stats = [],
  onHeightChange,
}) {
  const dateTimeLabel = useChileDateTimeLabel();
  const chromeRef = useRef(null);
  const displayName =
    (typeof window !== "undefined" &&
      (window.localStorage.getItem("full_name") ||
        window.localStorage.getItem("username"))) ||
    "Administrador";
  const displayRole =
    (typeof window !== "undefined" && window.localStorage.getItem("role_name")) ||
    "Admin";

  useEffect(() => {
    if (typeof onHeightChange !== "function") return undefined;

    const syncHeight = () => {
      const nextHeight = Math.ceil(chromeRef.current?.getBoundingClientRect?.().height || 0);
      onHeightChange(nextHeight);
    };

    syncHeight();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncHeight);
      return () => window.removeEventListener("resize", syncHeight);
    }

    const observer = new ResizeObserver(syncHeight);
    if (chromeRef.current) {
      observer.observe(chromeRef.current);
    }
    window.addEventListener("resize", syncHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncHeight);
    };
  }, [onHeightChange, stats.length, subtitle, title]);

  return (
    <>
      <NokFullscreenRail />

      <div
        ref={chromeRef}
        className="absolute right-4 top-4 z-[180] rounded-[24px] border border-white/70 bg-white/94 px-4 py-3 shadow-[0_24px_44px_rgba(15,23,42,0.16)] backdrop-blur"
        style={{ left: `${FULLSCREEN_PANEL_LEFT_PX}px` }}
      >
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0 xl:max-w-[22rem]">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              {dateTimeLabel}
            </div>
            <div className="mt-2">
              <div className="truncate font-['Sora'] text-[21px] font-semibold tracking-tight text-slate-950">
                {title}
              </div>
              {subtitle ? (
                <div className="mt-1 text-[12px] text-slate-500">{subtitle}</div>
              ) : null}
            </div>
          </div>

          {stats.length ? (
            <div className="xl:flex-1 xl:px-4">
              <div className="grid gap-2 md:grid-cols-3 xl:mx-auto xl:max-w-[760px]">
                {stats.map((stat) => (
                  <NokFullscreenStatBox key={stat.label} {...stat} />
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2 xl:shrink-0">
            <div className="inline-flex rounded-[20px] border border-white/70 bg-white/86 px-3 py-2.5 shadow-[0_14px_26px_rgba(15,23,42,0.08)]">
              <img src={teleminingLogo} alt="Telemining" className="w-28 sm:w-32" />
            </div>

            <div className="flex min-w-0 items-center gap-3 rounded-[20px] border border-white/70 bg-white/90 px-3 py-2 shadow-[0_14px_26px_rgba(15,23,42,0.08)]">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#4f46e5_0%,#2563eb_100%)] text-white shadow-[0_10px_22px_rgba(79,70,229,0.26)]">
                <BsPersonCircle className="text-xl" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">
                  {displayName}
                </div>
                <div className="truncate text-[11px] text-slate-500">{displayRole}</div>
              </div>
            </div>

            {onConfigure &&
            (isAdminRole(typeof window !== "undefined" ? window.localStorage.getItem("role_name") : "") ||
              String(typeof window !== "undefined" ? window.localStorage.getItem("username") : "").trim().toLowerCase() === "admin") ? (
              <button
                type="button"
                onClick={onConfigure}
                className="rounded-[18px] border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-[0_14px_24px_rgba(15,23,42,0.12)] transition hover:bg-slate-50"
              >
                <BsGearFill className="mr-2 inline" />
                Configurar Visual
              </button>
            ) : null}

            <button
              type="button"
              onClick={onExit}
              className="rounded-[18px] border border-slate-200 bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-[0_14px_24px_rgba(15,23,42,0.16)] transition hover:bg-slate-800"
            >
              Salir full screen
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  if (seconds < 60) return "menos de 1 min";

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}

function deriveOfflineRows(maps) {
  return (Array.isArray(maps) ? maps : [])
    .flatMap((mapItem) =>
      (Array.isArray(mapItem.cameras) ? mapItem.cameras : [])
        .filter((camera) => !camera.is_online)
        .map((camera) => ({
          ...camera,
          map_label: mapItem.label,
          map_code: mapItem.code,
        }))
    )
    .sort(
      (left, right) =>
        (right.offline_duration_seconds || 0) -
        (left.offline_duration_seconds || 0)
    );
}

function formatOfflineCompactDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  const dateLabel = date
    .toLocaleDateString("es-CL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
    .replace(/\//g, "-");
  const timeLabel = date.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${dateLabel} ${timeLabel}`;
}

function normalizeOverview(data) {
  return {
    ...EMPTY_OVERVIEW,
    ...(data || {}),
    summary: {
      ...EMPTY_OVERVIEW.summary,
      ...(data?.summary || {}),
    },
    maps: Array.isArray(data?.maps) ? data.maps : [],
  };
}

function buildOverviewStats(summary) {
  return [
    {
      label: "Dispositivos",
      value: summary.total_cameras,
      meta: "Inventario operativo NOC",
      tone: "blue",
      icon: <BsCameraVideoFill />,
    },
    {
      label: "On",
      value: summary.online_cameras,
      meta: "Respuesta positiva en el último chequeo",
      tone: "green",
      icon: <BsWifi />,
    },
    {
      label: "Off",
      value: summary.offline_cameras,
      meta: "Sin respuesta en el backend",
      tone: "red",
      icon: <BsWifiOff />,
    },
  ];
}

function getDeviceKindLabel(deviceKind) {
  const key = String(deviceKind || "camera").toLowerCase();
  if (key === "gate") return "Portón";
  if (key === "fan") return "Ventilador";
  return "Cámara";
}

function buildOfflineRowSearchIndex(camera) {
  return [
    camera.map_number ?? "",
    camera.map_label ?? "",
    camera.display_name ?? camera.name ?? "",
    camera.ip ?? "",
    formatDateTime(camera.checked_at),
    formatDateTime(camera.offline_since || camera.last_offline_at),
    formatDuration(camera.offline_duration_seconds),
    camera.error_detail || "Sin respuesta en el último chequeo de red.",
  ]
    .join(" ")
    .toLowerCase();
}

function normalizedDistance(pointA, pointB) {
  const dx = pointB.x - pointA.x;
  const dy = pointB.y - pointA.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function filterVisibleMaps(maps) {
  return (Array.isArray(maps) ? maps : []).filter(
    (mapItem) => !HIDDEN_MAP_CODES.has(mapItem.code)
  );
}

function sortMapsForLayout(maps) {
  const collection = filterVisibleMaps(maps);
  const mapOrder = new Map(
    collection.map((mapItem, index) => [mapItem.code, index])
  );
  const featured = collection.find((item) => item.code === FEATURED_MAP_CODE) || collection[0] || null;
  const secondary = collection
    .filter((item) => item.code !== featured?.code)
    .sort((left, right) => {
      const leftPriority =
        SECONDARY_MAP_LAYOUT_PRIORITY[left.code] ?? Number.MAX_SAFE_INTEGER;
      const rightPriority =
        SECONDARY_MAP_LAYOUT_PRIORITY[right.code] ?? Number.MAX_SAFE_INTEGER;

      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      return (mapOrder.get(left.code) ?? 0) - (mapOrder.get(right.code) ?? 0);
    });
  return { featured, secondary };
}

function resolveMapImageUrl(mapItem) {
  return mapItem.configured_image_url || MAP_IMAGE_OVERRIDES[mapItem.code] || mapItem.image_url;
}

async function toggleFullscreenForElement(element) {
  if (!element) return;

  if (document.fullscreenElement === element) {
    if (document.exitFullscreen) {
      await document.exitFullscreen();
    }
    return;
  }

  if (element.requestFullscreen) {
    await element.requestFullscreen();
  }
}

function MapToolButton({ icon, label, active = false, onClick, disabled = false }) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={joinClasses(
        "flex h-9 w-9 items-center justify-center rounded-xl border text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 sm:h-10 sm:w-10 sm:rounded-2xl sm:text-sm",
        active
          ? "border-transparent bg-[linear-gradient(135deg,#2563eb_0%,#0ea5e9_100%)] text-white shadow-[0_16px_30px_rgba(37,99,235,0.28)]"
          : "border-slate-300/70 bg-white/95 text-slate-700 shadow-[0_12px_24px_rgba(15,23,42,0.12)] hover:bg-white hover:text-slate-950"
      )}
    >
      {icon}
    </button>
  );
}

export default function NokCamarasPage() {
  const [overview, setOverview] = useState(EMPTY_OVERVIEW);
  const [nokLayout, setNokLayout] = useState(normalizeNokLayout());
  const [isLayoutEditorOpen, setIsLayoutEditorOpen] = useState(false);
  const [layoutSaving, setLayoutSaving] = useState(false);
  const [layoutMessage, setLayoutMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [showOverviewDetails, setShowOverviewDetails] = useState(true);
  const [selectedDeviceKinds, setSelectedDeviceKinds] = useState(DEVICE_KIND_OPTIONS);
  const [tableSearch, setTableSearch] = useState("");
  const [tableFilters, setTableFilters] = useState(EMPTY_TABLE_FILTERS);
  const [isOverviewFullscreen, setIsOverviewFullscreen] = useState(false);
  const [overviewChromeHeight, setOverviewChromeHeight] = useState(0);

  const overviewFullscreenRef = useRef(null);
  const overviewPollTimeoutRef = useRef(null);
  const overviewPollStoppedRef = useRef(false);
  const overviewPollIntervalMsRef = useRef(DEFAULT_NOK_POLL_INTERVAL_MS);
  const loadOverviewRef = useRef(null);
  const overviewContentTop = FULLSCREEN_CHROME_TOP_PX + overviewChromeHeight + FULLSCREEN_CHROME_GAP_PX;
  const isAdmin =
    typeof window !== "undefined" &&
    (isAdminRole(window.localStorage.getItem("role_name")) ||
      String(window.localStorage.getItem("username") || "").trim().toLowerCase() === "admin");

  const visibleMaps = useMemo(() => {
    const selectedKinds = new Set(selectedDeviceKinds);
    const maps = mergeNokLayoutMaps(filterVisibleMaps(overview.maps), nokLayout)
      .filter((mapItem) => mapItem.visible !== false);
    return maps.map((mapItem) => ({
      ...mapItem,
      cameras: (Array.isArray(mapItem.cameras) ? mapItem.cameras : []).filter((device) =>
        selectedKinds.has(String(device.device_kind || "camera").toLowerCase())
      ),
    }));
  }, [nokLayout, overview.maps, selectedDeviceKinds]);
  const visibleSummary = useMemo(() => {
    const uniqueCameras = new Map();
    visibleMaps.forEach((mapItem) => {
      (Array.isArray(mapItem.cameras) ? mapItem.cameras : []).forEach((camera) => {
        const key = Number(camera.camera_id);
        if (!key || uniqueCameras.has(key)) return;
        uniqueCameras.set(key, camera);
      });
    });

    return {
      maps: visibleMaps.length,
      total_cameras: uniqueCameras.size,
      online_cameras: Array.from(uniqueCameras.values()).filter((camera) => camera.is_online).length,
      offline_cameras: Array.from(uniqueCameras.values()).filter((camera) => !camera.is_online).length,
    };
  }, [visibleMaps]);
  const overviewStats = useMemo(
    () => buildOverviewStats(visibleSummary),
    [visibleSummary]
  );

  const offlineRows = useMemo(() => deriveOfflineRows(visibleMaps), [visibleMaps]);
  const filteredOfflineRows = useMemo(() => {
    const globalNeedle = tableSearch.trim().toLowerCase();

    return offlineRows.filter((camera) => {
      const filterValues = {
        map_number: String(camera.map_number ?? "").toLowerCase(),
        map_label: String(camera.map_label ?? "").toLowerCase(),
        camera_name: String(camera.display_name || camera.name || "").toLowerCase(),
        ip: String(camera.ip || "").toLowerCase(),
        checked_at: formatDateTime(camera.checked_at).toLowerCase(),
        offline_since: formatDateTime(
          camera.offline_since || camera.last_offline_at
        ).toLowerCase(),
        duration: formatDuration(camera.offline_duration_seconds).toLowerCase(),
        detail: String(
          camera.error_detail || "Sin respuesta en el último chequeo de red."
        ).toLowerCase(),
      };

      if (globalNeedle && !buildOfflineRowSearchIndex(camera).includes(globalNeedle)) {
        return false;
      }

      return Object.entries(tableFilters).every(([key, value]) => {
        const needle = value.trim().toLowerCase();
        if (!needle) return true;
        return filterValues[key]?.includes(needle);
      });
    });
  }, [offlineRows, tableFilters, tableSearch]);

  const { featured, secondary } = useMemo(
    () => sortMapsForLayout(visibleMaps),
    [visibleMaps]
  );

  const allKindsSelected = selectedDeviceKinds.length === DEVICE_KIND_OPTIONS.length;

  const toggleAllDeviceKinds = () => {
    setSelectedDeviceKinds(DEVICE_KIND_OPTIONS);
  };

  const toggleDeviceKind = (kind) => {
    setSelectedDeviceKinds((current) => {
      const hasKind = current.includes(kind);
      if (hasKind) {
        const next = current.filter((item) => item !== kind);
        return next.length ? next : DEVICE_KIND_OPTIONS;
      }
      return [...current, kind];
    });
  };

  const clearOverviewPoll = useCallback(() => {
    if (overviewPollTimeoutRef.current) {
      window.clearTimeout(overviewPollTimeoutRef.current);
      overviewPollTimeoutRef.current = null;
    }
  }, []);

  const scheduleNextOverviewPoll = useCallback(() => {
    clearOverviewPoll();
    if (overviewPollStoppedRef.current) {
      return;
    }

    overviewPollTimeoutRef.current = window.setTimeout(() => {
      if (loadOverviewRef.current) {
        void loadOverviewRef.current({ silent: true });
      }
    }, overviewPollIntervalMsRef.current);
  }, [clearOverviewPoll]);

  const loadOverview = useCallback(
    async ({ silent = false, force = false } = {}) => {
      clearOverviewPoll();

      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const response = await fetch(`${NOK_OVERVIEW_API}${force ? "?force=true" : ""}`, {
          headers: buildAuthHeaders(),
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        if (overviewPollStoppedRef.current) {
          return;
        }

        const normalizedOverview = normalizeOverview(data);
        overviewPollIntervalMsRef.current = resolveNokPollIntervalMs(
          normalizedOverview.refresh_ttl_seconds
        );
        setOverview(normalizedOverview);
        setError("");
      } catch (_error) {
        if (overviewPollStoppedRef.current) {
          return;
        }
        setError("No se pudo cargar el monitoreo NOC de dispositivos.");
      } finally {
        if (overviewPollStoppedRef.current) {
          return;
        }
        setLoading(false);
        setRefreshing(false);
        scheduleNextOverviewPoll();
      }
    },
    [clearOverviewPoll, scheduleNextOverviewPoll]
  );

  useEffect(() => {
    loadOverviewRef.current = loadOverview;
  }, [loadOverview]);

  useEffect(() => {
    overviewPollStoppedRef.current = false;
    void loadOverview({ silent: false });

    return () => {
      overviewPollStoppedRef.current = true;
      clearOverviewPoll();
    };
  }, [clearOverviewPoll, loadOverview]);

  useEffect(() => {
    let cancelled = false;
    fetch(NOK_LAYOUT_API, { headers: buildAuthHeaders() })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!cancelled && payload) setNokLayout(normalizeNokLayout(payload));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const saveNokLayout = async (nextLayout) => {
    setLayoutSaving(true);
    setLayoutMessage("");
    try {
      const response = await fetch(NOK_LAYOUT_API, {
        method: "PUT",
        headers: { ...buildAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(nextLayout),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.detail || "No se pudo guardar el layout");
      setNokLayout(normalizeNokLayout(payload));
      setLayoutMessage("Configuracion guardada para todos los usuarios.");
    } catch (saveError) {
      setLayoutMessage(saveError.message || "No se pudo guardar la configuracion.");
    } finally {
      setLayoutSaving(false);
    }
  };

  useEffect(() => {
    const syncFullscreenState = () => {
      const overviewElement = overviewFullscreenRef.current;
      setIsOverviewFullscreen(
        Boolean(
          overviewElement && document.fullscreenElement === overviewElement
        )
      );
    };

    document.addEventListener("fullscreenchange", syncFullscreenState);
    syncFullscreenState();
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, [loading, visibleMaps.length]);

  return (
    <PageShell
      eyebrow="NOC CCTV"
      title="NOC"
      description=""
      showDemoBadge={false}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <StatusBadge tone={visibleSummary.offline_cameras > 0 ? "red" : "green"}>
            {visibleSummary.offline_cameras > 0 ? "Incidencias activas" : "Sin incidencias"}
          </StatusBadge>
          <ActionButton
            variant="secondary"
            onClick={() => setShowOverviewDetails((current) => !current)}
          >
            {showOverviewDetails ? "Ocultar" : "Mostrar"}
          </ActionButton>
          <ActionButton
            variant="secondary"
            onClick={() => toggleFullscreenForElement(overviewFullscreenRef.current)}
          >
            {isOverviewFullscreen ? "Salir full screen" : "Full screen"}
          </ActionButton>
          {isAdmin ? (
            <ActionButton variant="secondary" onClick={() => setIsLayoutEditorOpen(true)}>
              <BsGearFill /> Configurar Visual
            </ActionButton>
          ) : null}
          <ActionButton
            variant="secondary"
            onClick={() => void loadOverview({ silent: true, force: true })}
            disabled={refreshing}
          >
            <BsArrowClockwise className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Actualizando..." : "Actualizar ahora"}
          </ActionButton>
        </div>
      }
      stats={
        showOverviewDetails
          ? overviewStats
          : []
      }
    >
      <NokMarkerAnimationStyles />
      <SectionCard
        title="Planos NOC"
        actions={
          <div className="text-right text-xs text-slate-500">
            <div>Último chequeo: {formatDateTime(overview.summary.last_checked_at)}</div>
            <div>TTL backend: {overview.refresh_ttl_seconds || 0}s</div>
          </div>
        }
        bodyClassName={isOverviewFullscreen ? "p-3" : ""}
      >
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[18px] border border-slate-200 bg-slate-50/90 px-3 py-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Filtros de íconos
          </span>
          <button
            type="button"
            onClick={toggleAllDeviceKinds}
            className={joinClasses(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
              allKindsSelected
                ? "border-sky-300 bg-sky-50 text-sky-700"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            )}
          >
            Todos
          </button>
          <button
            type="button"
            onClick={() => toggleDeviceKind("camera")}
            className={joinClasses(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
              selectedDeviceKinds.includes("camera")
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            )}
          >
            <BsCameraVideoFill /> Cámaras
          </button>
          <button
            type="button"
            onClick={() => toggleDeviceKind("gate")}
            className={joinClasses(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
              selectedDeviceKinds.includes("gate")
                ? "border-amber-300 bg-amber-50 text-amber-700"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            )}
          >
            <BsDoorOpenFill /> Portones
          </button>
          <button
            type="button"
            onClick={() => toggleDeviceKind("fan")}
            className={joinClasses(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
              selectedDeviceKinds.includes("fan")
                ? "border-violet-300 bg-violet-50 text-violet-700"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            )}
          >
            <FaFan /> Ventiladores
          </button>
        </div>

        {loading && visibleMaps.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/90 px-5 py-10 text-center text-sm text-slate-500">
            Cargando planos y estados de dispositivos...
          </div>
        ) : error && visibleMaps.length === 0 ? (
          <EmptyState
            title="No fue posible abrir el módulo NOC"
            description={error}
          />
        ) : (
          <div
            ref={overviewFullscreenRef}
            className={joinClasses(
              "relative rounded-[28px]",
              isOverviewFullscreen ? "min-h-screen overflow-hidden rounded-none bg-white px-4 py-4" : ""
            )}
          >
            {isOverviewFullscreen ? (
              <>
                <NokFullscreenChrome
                  title="NOC"
                  subtitle="Monitoreo IP, estado On/Off y alertas visuales por plano."
                  onConfigure={() => setIsLayoutEditorOpen(true)}
                  stats={overviewStats}
                  onHeightChange={setOverviewChromeHeight}
                  onExit={() => toggleFullscreenForElement(overviewFullscreenRef.current)}
                />
                <img
                  src={teleminingLogo}
                  alt="Telemining"
                  className="pointer-events-none absolute bottom-4 left-[88px] z-[176] h-16 w-auto opacity-95 drop-shadow-[0_10px_18px_rgba(0,0,0,0.26)]"
                />
              </>
            ) : null}
            <div
              className={joinClasses(
                isOverviewFullscreen ? "box-border h-[calc(100vh-32px)] pl-[84px]" : ""
              )}
              style={
                isOverviewFullscreen
                  ? {
                      paddingTop: `${overviewContentTop}px`,
                    }
                  : undefined
              }
            >
              {isOverviewFullscreen && ["manual", "manual_visual"].includes(nokLayout.mode) ? (
                <div
                  className="relative min-h-0 overflow-hidden"
                  style={{
                    height: `calc(100vh - ${overviewContentTop + 32}px)`,
                  }}
                >
                  {visibleMaps.map((mapItem, index) => {
                    const layoutMap = nokLayout.maps.find((item) => item.code === mapItem.code) ||
                      defaultNokLayoutMap(mapItem, index);
                    const placement = layoutMap.layout || {};
                    return (
                      <div
                        key={mapItem.code}
                        className="absolute min-h-0 min-w-0"
                        style={{
                          left: `${placement.x ?? 0}%`,
                          top: `${placement.y ?? 0}%`,
                          width: `${placement.width ?? 50}%`,
                          height: `${placement.height ?? 50}%`,
                        }}
                      >
                        <NokMapCard
                          mapItem={mapItem}
                          variant="compact"
                          isOverviewFullscreen
                          manualLayout
                        />
                      </div>
                    );
                  })}
                </div>
              ) : featured ? (
                <div
                  className={joinClasses(
                    "grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)] xl:items-stretch 2xl:grid-cols-[minmax(0,1.12fr)_minmax(0,1.58fr)]",
                    isOverviewFullscreen ? "h-full" : ""
                  )}
                >
                  <div
                    className={joinClasses(
                      "grid gap-4",
                      secondary.length === 3
                        ? "xl:h-full xl:grid-rows-[1.42fr_0.79fr_0.79fr]"
                        : secondary.length === 2
                        ? "xl:h-full xl:grid-rows-[1.24fr_0.86fr]"
                        : secondary.length > 3
                        ? "xl:auto-rows-fr"
                        : "xl:auto-rows-fr"
                    )}
                  >
                    {secondary.map((mapItem) => (
                      <NokMapCard
                        key={mapItem.code}
                        mapItem={mapItem}
                        variant="compact"
                        isOverviewFullscreen={isOverviewFullscreen}
                        stretchToColumn={secondary.length >= 2}
                      />
                    ))}
                  </div>
                  <NokMapCard
                    key={featured.code}
                    mapItem={featured}
                    variant="featured"
                    isOverviewFullscreen={isOverviewFullscreen}
                  />
                </div>
              ) : (
                <div
                  className={joinClasses(
                    "grid gap-4",
                    isOverviewFullscreen ? "pb-20" : ""
                  )}
                >
                  {visibleMaps.map((mapItem) => (
                    <NokMapCard
                      key={mapItem.code}
                      mapItem={mapItem}
                      variant="compact"
                      isOverviewFullscreen={isOverviewFullscreen}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </SectionCard>

      {isLayoutEditorOpen ? (
        <NokVisualLayoutEditor
          layout={nokLayout}
          maps={filterVisibleMaps(overview.maps)}
          saving={layoutSaving}
          message={layoutMessage}
          onClose={() => setIsLayoutEditorOpen(false)}
          onSave={saveNokLayout}
        />
      ) : null}

      <SectionCard
        title="Dispositivos en Off"
        subtitle="Resumen consolidado de dispositivos con alerta NOC, incluyendo última consulta, inicio de la caída y tiempo acumulado offline."
      >
        {offlineRows.length === 0 ? (
          <EmptyState
            title="No hay dispositivos Off en este momento"
            description="Cuando un dispositivo deje de responder, aparecerá en el plano y en esta tabla de seguimiento."
          />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-col gap-3 rounded-[20px] border border-slate-200 bg-slate-50/90 p-3 md:flex-row md:items-center md:justify-between">
              <label className="block w-full md:max-w-md">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Buscador general
                </div>
                <input
                  type="text"
                  value={tableSearch}
                  onChange={(event) => setTableSearch(event.target.value)}
                  placeholder="Buscar por nombre, IP, mapa, fecha o detalle..."
                  className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                />
              </label>

              <div className="flex flex-wrap items-center justify-end gap-2">
                <div className="text-xs text-slate-500">
                  Mostrando {filteredOfflineRows.length} de {offlineRows.length}
                </div>
                <ActionButton
                  variant="secondary"
                  onClick={() => {
                    setTableSearch("");
                    setTableFilters(EMPTY_TABLE_FILTERS);
                  }}
                >
                  Limpiar filtros
                </ActionButton>
              </div>
            </div>

            {filteredOfflineRows.length === 0 ? (
              <EmptyState
                title="Sin resultados para los filtros aplicados"
                description="Ajusta el buscador o limpia los filtros por columna para volver a ver los dispositivos en Off."
              />
            ) : null}

            <div className="overflow-auto rounded-[24px] border border-slate-200">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-[0.14em] text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Nro mapa</th>
                    <th className="px-4 py-3">Mapa</th>
                    <th className="px-4 py-3">Dispositivo</th>
                    <th className="px-4 py-3">IP</th>
                    <th className="px-4 py-3">Últ. consulta</th>
                    <th className="px-4 py-3">Offline desde</th>
                    <th className="px-4 py-3">Duración</th>
                    <th className="px-4 py-3">Detalle</th>
                  </tr>
                  <tr className="border-t border-slate-200 bg-white/80 align-top">
                    <TableFilterCell
                      value={tableFilters.map_number}
                      onChange={(value) =>
                        setTableFilters((current) => ({ ...current, map_number: value }))
                      }
                    />
                    <TableFilterCell
                      value={tableFilters.map_label}
                      onChange={(value) =>
                        setTableFilters((current) => ({ ...current, map_label: value }))
                      }
                    />
                    <TableFilterCell
                      value={tableFilters.camera_name}
                      onChange={(value) =>
                        setTableFilters((current) => ({ ...current, camera_name: value }))
                      }
                    />
                    <TableFilterCell
                      value={tableFilters.ip}
                      onChange={(value) =>
                        setTableFilters((current) => ({ ...current, ip: value }))
                      }
                    />
                    <TableFilterCell
                      value={tableFilters.checked_at}
                      onChange={(value) =>
                        setTableFilters((current) => ({ ...current, checked_at: value }))
                      }
                    />
                    <TableFilterCell
                      value={tableFilters.offline_since}
                      onChange={(value) =>
                        setTableFilters((current) => ({ ...current, offline_since: value }))
                      }
                    />
                    <TableFilterCell
                      value={tableFilters.duration}
                      onChange={(value) =>
                        setTableFilters((current) => ({ ...current, duration: value }))
                      }
                    />
                    <TableFilterCell
                      value={tableFilters.detail}
                      onChange={(value) =>
                        setTableFilters((current) => ({ ...current, detail: value }))
                      }
                    />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
                  {filteredOfflineRows.map((camera) => (
                    <tr key={`${camera.map_code}-${camera.camera_id}`}>
                      <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-900">
                        {camera.map_number ?? "-"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-800">
                        {camera.map_label}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-slate-900">
                          {camera.display_name || camera.name}
                        </span>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {getDeviceKindLabel(camera.device_kind)}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">{camera.ip || "-"}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {formatDateTime(camera.checked_at)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {formatDateTime(camera.offline_since || camera.last_offline_at)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-semibold text-rose-700">
                        {formatDuration(camera.offline_duration_seconds)}
                      </td>
                      <td className="min-w-[240px] px-4 py-3 text-slate-500">
                        {camera.error_detail || "Sin respuesta en el ultimo chequeo de red."}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </SectionCard>
    </PageShell>
  );
}

function TableFilterCell({ value, onChange }) {
  return (
    <th className="px-3 py-2">
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Filtrar"
        className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-[12px] font-medium normal-case tracking-normal text-slate-700 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
      />
    </th>
  );
}

function NokVisualLayoutCanvas({ maps, onUpdateMap, onReorder }) {
  const canvasRef = useRef(null);
  const interactionRef = useRef(null);

  useEffect(() => {
    const handlePointerMove = (event) => {
      const interaction = interactionRef.current;
      const canvas = canvasRef.current;
      if (!interaction || !canvas) return;

      const rect = canvas.getBoundingClientRect();
      const deltaX = ((event.clientX - interaction.startX) / rect.width) * 100;
      const deltaY = ((event.clientY - interaction.startY) / rect.height) * 100;
      const start = interaction.startLayout;
      const nextLayout = interaction.resize
        ? {
            ...start,
            width: Math.min(100 - start.x, Math.max(10, start.width + deltaX)),
            height: Math.min(100 - start.y, Math.max(10, start.height + deltaY)),
          }
        : {
            ...start,
            x: Math.min(100 - start.width, Math.max(0, start.x + deltaX)),
            y: Math.min(100 - start.height, Math.max(0, start.y + deltaY)),
          };

      onUpdateMap(interaction.code, { layout: nextLayout });
    };

    const handlePointerUp = () => {
      interactionRef.current = null;
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [onUpdateMap]);

  const startInteraction = (event, item, resize = false) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    interactionRef.current = {
      code: item.code,
      resize,
      startX: event.clientX,
      startY: event.clientY,
      startLayout: {
        x: Number(item.layout?.x ?? 0),
        y: Number(item.layout?.y ?? 0),
        width: Number(item.layout?.width ?? 50),
        height: Number(item.layout?.height ?? 40),
      },
    };
    document.body.style.userSelect = "none";
    if (!resize) onReorder(item.code);
  };

  return (
    <div
      ref={canvasRef}
      className="relative mx-auto h-[min(70vh,720px)] min-h-[520px] w-full max-w-[1600px] touch-none overflow-hidden rounded-2xl border-2 border-dashed border-sky-200 bg-[linear-gradient(90deg,rgba(14,165,233,0.06)_1px,transparent_1px),linear-gradient(rgba(14,165,233,0.06)_1px,transparent_1px)] bg-[size:10%_10%] select-none"
    >
      <div className="pointer-events-none absolute left-3 top-3 z-[100] rounded-lg bg-slate-950/80 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white">
        Vista previa fullscreen
      </div>
      {maps.filter((item) => item.visible !== false).map((item, index) => {
        const layout = item.layout || {};
        return (
          <div
            key={item.code}
            onPointerDown={(event) => startInteraction(event, item)}
            className="absolute cursor-move overflow-hidden rounded-xl border-2 border-sky-500 bg-white shadow-[0_10px_22px_rgba(15,23,42,0.18)]"
            style={{
              left: `${layout.x ?? 0}%`,
              top: `${layout.y ?? 0}%`,
              width: `${layout.width ?? 50}%`,
              height: `${layout.height ?? 40}%`,
              zIndex: index + 1,
            }}
          >
            <img
              src={item.image_url}
              alt={item.label}
              draggable="false"
              className="pointer-events-none h-full w-full object-cover opacity-75"
            />
            <div className="absolute inset-x-0 top-0 truncate bg-slate-950/80 px-2 py-1 text-[11px] font-semibold text-white">
              {item.label}
            </div>
            <button
              type="button"
              aria-label={`Redimensionar ${item.label}`}
              onPointerDown={(event) => startInteraction(event, item, true)}
              className="absolute bottom-0 right-0 h-5 w-5 cursor-se-resize rounded-tl-lg bg-sky-600 text-[10px] font-bold text-white"
            >
              ↘
            </button>
          </div>
        );
      })}
      <div className="pointer-events-none absolute bottom-2 left-2 rounded-lg bg-white/90 px-2 py-1 text-[10px] font-semibold text-slate-500 shadow-sm">
        Arrastra para mover · Esquina inferior derecha para redimensionar
      </div>
    </div>
  );
}

function NokVisualLayoutEditor({ layout, maps, saving, message, onClose, onSave }) {
  const [draft, setDraft] = useState(() => {
    const configured = new Map((layout.maps || []).map((item) => [item.code, item]));
    const sourceByCode = new Map(maps.map((item) => [item.code, item]));
    const configuredMaps = (layout.maps || [])
      .map((item) => sourceByCode.get(item.code) || { ...item, cameras: [] })
      .filter(Boolean);
    const configuredCodes = new Set(configuredMaps.map((item) => item.code));
    const sourceMaps = [
      ...configuredMaps,
      ...maps.filter((item) => !configuredCodes.has(item.code)),
    ];
    const initialMaps = sourceMaps.map((mapItem, index) =>
      configured.get(mapItem.code) || defaultNokLayoutMap(mapItem, index)
    );
    return { ...layout, maps: initialMaps };
  });

  const updateMap = (code, changes) => {
    setDraft((current) => ({
      ...current,
      maps: current.maps.map((item) =>
        item.code === code ? { ...item, ...changes } : item
      ),
    }));
  };

  const addMap = () => {
    const code = `custom-${Date.now()}`;
    setDraft((current) => ({
      ...current,
      maps: [
        ...current.maps,
        {
          code,
          label: "Nuevo mapa",
          image_url: "",
          visible: true,
          layout: { x: 0, y: 0, width: 50, height: 40 },
        },
      ],
    }));
  };

  const removeMap = (code) => {
    setDraft((current) => ({
      ...current,
      maps: current.maps.filter((item) => item.code !== code),
    }));
  };

  const handleImageFile = (code, event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) {
      window.alert("La imagen debe pesar 2 MB o menos.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => updateMap(code, { image_url: String(reader.result || "") });
    reader.readAsDataURL(file);
  };

  return (
    <div className="fixed inset-0 z-[300] overflow-y-auto bg-slate-950/45 p-4 backdrop-blur-sm">
      <div className="mx-auto max-w-6xl rounded-[28px] border border-white/80 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.28)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-600">Administrador</div>
            <h2 className="mt-1 font-['Sora'] text-xl font-semibold text-slate-950">Configurar Visual</h2>
            <p className="mt-1 text-sm text-slate-500">La configuracion se comparte con todos los usuarios del NOC.</p>
          </div>
          <div className="flex gap-2">
            <ActionButton variant="secondary" onClick={onClose}>Cancelar</ActionButton>
            <ActionButton onClick={() => onSave(draft)} disabled={saving || draft.maps.some((item) => !item.label || !item.image_url)}>
              {saving ? "Guardando..." : "Guardar ubicacion"}
            </ActionButton>
          </div>
        </div>

        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Distribucion</span>
            {["responsive", "manual", "manual_visual"].map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setDraft((current) => ({ ...current, mode }))}
                className={joinClasses(
                  "rounded-xl border px-3 py-2 text-sm font-semibold",
                  draft.mode === mode ? "border-sky-400 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-600"
                )}
              >
                {mode === "manual_visual"
                  ? "Manual visual"
                  : mode === "manual"
                  ? "Manual"
                  : "Responsive"}
              </button>
            ))}
            <button type="button" onClick={addMap} className="ml-auto rounded-xl bg-slate-950 px-3 py-2 text-sm font-semibold text-white">
              + Añadir mapa
            </button>
          </div>

          {draft.mode === "manual_visual" ? (
            <NokVisualLayoutCanvas
              maps={draft.maps}
              onUpdateMap={updateMap}
              onReorder={(code) =>
                setDraft((current) => ({
                  ...current,
                  maps: [
                    ...current.maps.filter((item) => item.code !== code),
                    current.maps.find((item) => item.code === code),
                  ].filter(Boolean),
                }))
              }
            />
          ) : null}

          {draft.mode !== "manual_visual" ? (
          <div className="grid gap-3 md:grid-cols-2">
            {draft.maps.map((item) => (
              <div key={item.code} className="rounded-2xl border border-slate-200 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <input type="checkbox" checked={item.visible !== false} onChange={(event) => updateMap(item.code, { visible: event.target.checked })} />
                    Mostrar mapa
                  </label>
                  <button type="button" onClick={() => removeMap(item.code)} className="text-xs font-semibold text-rose-600">Quitar</button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-semibold text-slate-500">Nombre
                    <input value={item.label} onChange={(event) => updateMap(item.code, { label: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-800" />
                  </label>
                  <label className="text-xs font-semibold text-slate-500">Codigo
                    <input value={item.code} disabled className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-500" />
                  </label>
                </div>
                <label className="mt-3 block text-xs font-semibold text-slate-500">Imagen de mapa (URL o archivo)
                  <input value={item.image_url.startsWith("data:") ? "Imagen cargada" : item.image_url} onChange={(event) => updateMap(item.code, { image_url: event.target.value })} placeholder="/maps/mi-plano.png" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-800" />
                  <input type="file" accept="image/*" onChange={(event) => handleImageFile(item.code, event)} className="mt-2 block w-full text-xs text-slate-500" />
                </label>
                {draft.mode === "manual" ? (
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    {["x", "y", "width", "height"].map((key) => (
                      <label key={key} className="text-[10px] font-semibold uppercase text-slate-500">{key} %
                        <input type="number" min="0" max="100" step="1" value={item.layout?.[key] ?? 0} onChange={(event) => updateMap(item.code, { layout: { ...item.layout, [key]: Number(event.target.value) } })} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal text-slate-800" />
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          ) : null}
          {message ? <div className="rounded-xl bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700">{message}</div> : null}
        </div>
      </div>
    </div>
  );
}

function NokMapCard({
  mapItem,
  variant = "compact",
  isOverviewFullscreen = false,
  stretchToColumn = false,
  manualLayout = false,
}) {
  const [manualScale, setManualScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [measureMode, setMeasureMode] = useState(false);
  const [measurePoints, setMeasurePoints] = useState([]);
  const [measureDistance, setMeasureDistance] = useState(null);
  const [polygonMode, setPolygonMode] = useState(false);
  const [polygonPoints, setPolygonPoints] = useState([]);
  const [navigationMode, setNavigationMode] = useState(false);
  const [openPopupIds, setOpenPopupIds] = useState([]);
  const [isMapFullscreen, setIsMapFullscreen] = useState(false);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [mapChromeHeight, setMapChromeHeight] = useState(0);

  const mapSurfaceRef = useRef(null);
  const mapViewportRef = useRef(null);
  const imageFrameRef = useRef(null);
  const markerRefs = useRef(new Map());
  const panStart = useRef({ x: 0, y: 0 });
  const [markerAnchors, setMarkerAnchors] = useState({});

  const mapDevices = useMemo(
    () => (Array.isArray(mapItem.cameras) ? mapItem.cameras : []),
    [mapItem.cameras]
  );
  const activeCount = mapDevices.filter((device) => device.is_online).length;
  const inactiveCount = mapDevices.filter((device) => !device.is_online).length;
  const visibleDeviceCount = mapDevices.length;
  const mapAspectRatio =
    MAP_ASPECT_RATIOS[mapItem.code] || DEFAULT_MAP_ASPECT_RATIO;
  const mapImageUrl = resolveMapImageUrl(mapItem);
  const popupCardWidth = isMapFullscreen ? 248 : 224;
  const popupCardHeight = 58;
  const popupRowsPerColumn = 12;
  const normalizedMapCode = String(mapItem.code || "").trim().toUpperCase();
  const normalizedMapLabel = String(mapItem.label || "").trim().toLowerCase();
  const useBottomRowPopups =
    BOTTOM_ROW_POPUP_MAP_CODES.has(normalizedMapCode) ||
    normalizedMapLabel.includes("ucl");
  const mapFullscreenContentTop =
    FULLSCREEN_CHROME_TOP_PX + mapChromeHeight + FULLSCREEN_CHROME_GAP_PX;

  const syncViewportSize = () => {
    const viewportNode = mapViewportRef.current;
    if (!viewportNode) return;

    const rect = viewportNode.getBoundingClientRect();
    setViewportSize({
      width: rect.width || 0,
      height: rect.height || 0,
    });
  };

  const registerMarkerRef = useCallback((cameraId, node) => {
    const nextKey = Number(cameraId);
    if (!nextKey) return;
    if (node) {
      markerRefs.current.set(nextKey, node);
    } else {
      markerRefs.current.delete(nextKey);
    }
  }, []);

  const syncMarkerAnchors = useCallback(() => {
    const viewportNode = mapViewportRef.current;
    if (!viewportNode) return;

    const viewportRect = viewportNode.getBoundingClientRect();
    const nextAnchors = {};
    markerRefs.current.forEach((node, key) => {
      if (!node?.getBoundingClientRect) return;
      const rect = node.getBoundingClientRect();
      nextAnchors[key] = {
        x: rect.left - viewportRect.left + rect.width / 2,
        y: rect.top - viewportRect.top + rect.height / 2,
      };
    });
    setMarkerAnchors(nextAnchors);
  }, []);

  useEffect(() => {
    const syncFullscreenState = () => {
      const mapSurfaceElement = mapSurfaceRef.current;
      const isFullscreen =
        Boolean(
          mapSurfaceElement && document.fullscreenElement === mapSurfaceElement
        );

      setIsMapFullscreen(isFullscreen);

      window.requestAnimationFrame(() => {
        syncViewportSize();
      });
    };

    document.addEventListener("fullscreenchange", syncFullscreenState);
    syncFullscreenState();
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, [mapItem.code]);

  useEffect(() => {
    const viewportNode = mapViewportRef.current;
    if (!viewportNode) return undefined;

    syncViewportSize();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncViewportSize);
      return () => window.removeEventListener("resize", syncViewportSize);
    }

    const observer = new ResizeObserver(() => syncViewportSize());
    observer.observe(viewportNode);
    return () => observer.disconnect();
  }, [isMapFullscreen, mapItem.code]);

  useEffect(() => {
    const frameOne = window.requestAnimationFrame(() => syncViewportSize());
    const frameTwo = window.requestAnimationFrame(() => syncViewportSize());
    const timerId = window.setTimeout(() => syncViewportSize(), 140);

    return () => {
      window.cancelAnimationFrame(frameOne);
      window.cancelAnimationFrame(frameTwo);
      window.clearTimeout(timerId);
    };
  }, [isMapFullscreen]);

  useEffect(() => {
    const frameOne = window.requestAnimationFrame(syncMarkerAnchors);
    const frameTwo = window.requestAnimationFrame(syncMarkerAnchors);
    const timerId = window.setTimeout(syncMarkerAnchors, 140);

    return () => {
      window.cancelAnimationFrame(frameOne);
      window.cancelAnimationFrame(frameTwo);
      window.clearTimeout(timerId);
    };
  }, [
    isMapFullscreen,
    manualScale,
    openPopupIds,
    pan.x,
    pan.y,
    syncMarkerAnchors,
    viewportSize.height,
    viewportSize.width,
    mapItem.cameras,
  ]);

  useEffect(() => {
    const offlineIds = mapDevices
      .filter((camera) => !camera.is_online)
      .map((camera) => camera.camera_id);
    setOpenPopupIds(offlineIds);
  }, [isMapFullscreen, isOverviewFullscreen, mapDevices]);

  const surfaceHeightClass = useMemo(() => {
    if (manualLayout) {
      return "h-full min-h-0";
    }

    if (isMapFullscreen) {
      return "h-screen min-h-screen";
    }

    if (variant === "featured") {
      return isOverviewFullscreen
        ? "h-full min-h-0"
        : "h-[690px] lg:h-[860px] xl:h-[1080px]";
    }

    if (stretchToColumn) {
      return isOverviewFullscreen
        ? "h-full min-h-0"
        : "h-full min-h-[340px] lg:min-h-[440px] xl:min-h-[360px]";
    }

    return isOverviewFullscreen
      ? "h-[calc((100vh-11rem)/3)] min-h-[220px]"
      : "h-[300px] lg:h-[340px] xl:h-[360px]";
  }, [isMapFullscreen, isOverviewFullscreen, manualLayout, stretchToColumn, variant]);

  const imageFrameStyle = useMemo(() => {
    if (!viewportSize.width || !viewportSize.height) {
      return {
        inset: "0px",
      };
    }

    const viewportAspectRatio = viewportSize.width / viewportSize.height;
    let width = viewportSize.width;
    let height = viewportSize.height;
    let left = 0;
    let top = 0;

    if (viewportAspectRatio > mapAspectRatio) {
      height = viewportSize.height;
      width = height * mapAspectRatio;
      left = (viewportSize.width - width) / 2;
    } else {
      width = viewportSize.width;
      height = width / mapAspectRatio;
      top = (viewportSize.height - height) / 2;
    }

    return {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
    };
  }, [mapAspectRatio, viewportSize.height, viewportSize.width]);

  const clearMapTools = () => {
    setManualScale(1);
    setPan({ x: 0, y: 0 });
    setIsPanning(false);
    setMeasureMode(false);
    setMeasurePoints([]);
    setMeasureDistance(null);
    setPolygonMode(false);
    setPolygonPoints([]);
    setOpenPopupIds([]);
    setNavigationMode(false);
  };

  const togglePolygonMode = () => {
    setPolygonMode((current) => {
      const next = !current;
      if (next) {
        setMeasureMode(false);
        setMeasurePoints([]);
        setMeasureDistance(null);
        setPolygonPoints([]);
      } else if (polygonPoints.length < 3) {
        setPolygonPoints([]);
      }
      return next;
    });
  };

  const toggleMeasureMode = () => {
    setMeasureMode((current) => {
      const next = !current;
      if (next) {
        setPolygonMode(false);
        setPolygonPoints([]);
      } else {
        setMeasurePoints([]);
        setMeasureDistance(null);
      }
      return next;
    });
  };

  const handleWheel = (event) => {
    if (!navigationMode) return;
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.12 : 0.12;
    setManualScale((scale) => Math.min(3, Math.max(0.45, scale + delta)));
  };

  const startPan = (event) => {
    if (!navigationMode) return;
    setIsPanning(true);
    panStart.current = {
      x: event.clientX - pan.x,
      y: event.clientY - pan.y,
    };
  };

  const movePan = (event) => {
    if (!navigationMode || !isPanning) return;
    setPan({
      x: event.clientX - panStart.current.x,
      y: event.clientY - panStart.current.y,
    });
  };

  const endPan = () => setIsPanning(false);

  const handleMapBackgroundClick = (event) => {
    const frameNode = imageFrameRef.current;
    if (!frameNode) return;

    const rect = frameNode.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      if (!polygonMode && !measureMode) {
        setOpenPopupIds([]);
      }
      return;
    }

    const point = {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };

    if (polygonMode) {
      setPolygonPoints((current) => [...current, point]);
      return;
    }

    if (measureMode) {
      setOpenPopupIds([]);

      setMeasurePoints((current) => {
        let next = [];
        if (current.length === 0) next = [point];
        else if (current.length === 1) next = [current[0], point];
        else next = [current[1], point];

        if (next.length === 2) {
          setMeasureDistance(
            normalizedDistance(next[0], next[1]) * MAP_GENERIC_WIDTH_METERS
          );
        } else {
          setMeasureDistance(null);
        }

        return next;
      });
      return;
    }

    setOpenPopupIds([]);
  };

  const handleCameraClick = (camera) => {
    if (polygonMode || measureMode) return;

    if (!camera.is_online) {
      setOpenPopupIds((current) =>
        current.includes(camera.camera_id)
          ? current.filter((item) => item !== camera.camera_id)
          : [...current, camera.camera_id]
      );
    } else {
      setOpenPopupIds((current) =>
        current.filter((item) => item !== camera.camera_id)
      );
    }
  };

  const openOfflineEntries = useMemo(() => {
    const openCameras = mapDevices
      .filter((camera) => !camera.is_online && openPopupIds.includes(camera.camera_id))
      .map((camera) => ({
        camera,
        anchor: markerAnchors[camera.camera_id],
      }))
      .filter((item) => item.anchor)
      .sort((left, right) =>
        useBottomRowPopups
          ? left.anchor.x - right.anchor.x || left.anchor.y - right.anchor.y
          : left.anchor.y - right.anchor.y || left.anchor.x - right.anchor.x
      );

    if (useBottomRowPopups) {
      const rowGap = isMapFullscreen ? 18 : 12;
      const sidePadding = isMapFullscreen ? 20 : 12;
      const bottomPadding = isMapFullscreen ? 18 : 12;
      const viewportWidth = viewportSize.width || 0;
      const viewportHeight = viewportSize.height || 0;
      const totalGapWidth = Math.max(0, openCameras.length - 1) * rowGap;
      const availableRowWidth = Math.max(0, viewportWidth - sidePadding * 2 - totalGapWidth);
      const computedCardWidth =
        openCameras.length > 0 && availableRowWidth > 0
          ? Math.min(popupCardWidth, availableRowWidth / openCameras.length)
          : popupCardWidth;
      const totalRowWidth = openCameras.length * computedCardWidth + totalGapWidth;
      const startLeft = Math.max(sidePadding, (viewportWidth - totalRowWidth) / 2);
      const rowTop = Math.max(8, viewportHeight - popupCardHeight - bottomPadding);

      return openCameras.map((item, index) => ({
        ...item,
        layoutMode: "bottom-row",
        left: startLeft + index * (computedCardWidth + rowGap),
        top: rowTop,
        width: computedCardWidth,
        height: popupCardHeight,
      }));
    }

    const startTop = isMapFullscreen ? mapFullscreenContentTop + 88 : 112;
    const startLeft = 18;
    const columnGap = isMapFullscreen ? 22 : 16;
    const rowCount = Math.min(openCameras.length, popupRowsPerColumn);
    const defaultGap = 10;
    const availableHeight = Math.max(
      popupCardHeight,
      (viewportSize.height || 0) - startTop - 18
    );
    const contentHeight = rowCount * popupCardHeight;
    const computedGap =
      rowCount > 1
        ? Math.max(
            6,
            Math.min(
              defaultGap,
              (availableHeight - contentHeight) / (rowCount - 1)
            )
          )
        : 0;

    return openCameras.map((item, index) => {
      const columnIndex = Math.floor(index / popupRowsPerColumn);
      const rowIndex = index % popupRowsPerColumn;

      return {
        ...item,
        layoutMode: "left-column",
        left: startLeft + columnIndex * (popupCardWidth + columnGap),
        top: startTop + rowIndex * (popupCardHeight + computedGap),
        width: popupCardWidth,
        height: popupCardHeight,
      };
    });
  }, [
    isMapFullscreen,
    mapFullscreenContentTop,
    mapDevices,
    markerAnchors,
    openPopupIds,
    popupCardHeight,
    popupCardWidth,
    popupRowsPerColumn,
    useBottomRowPopups,
    viewportSize.height,
    viewportSize.width,
  ]);

  return (
    <article
      className={joinClasses(
        "overflow-hidden rounded-[28px]",
        variant === "featured" ? "xl:rounded-[30px]" : "",
        manualLayout ? "h-full" : ""
      )}
    >
      <div
        ref={mapSurfaceRef}
        className={joinClasses(
          "relative overflow-hidden rounded-[24px] border border-slate-200 bg-white",
          isMapFullscreen ? "rounded-none border-0 bg-white" : "",
          surfaceHeightClass
        )}
      >
        {isMapFullscreen ? (
          <NokFullscreenChrome
            title={`Plano NOC - ${mapItem.label}`}
            subtitle="Vista fullscreen del plano operativo NOC."
            onHeightChange={setMapChromeHeight}
            onExit={() => toggleFullscreenForElement(mapSurfaceRef.current)}
          />
        ) : null}

        <div
          className={joinClasses(
            "absolute z-30 flex flex-row flex-wrap justify-end gap-2 sm:flex-col",
            isMapFullscreen ? "right-4" : "right-3 top-3 sm:right-4 sm:top-4"
          )}
          style={
            isMapFullscreen
              ? { top: `${mapFullscreenContentTop}px` }
              : undefined
          }
        >
          <MapToolButton
            icon={<span className="text-base font-bold">+</span>}
            label="Acercar"
            onClick={() => setManualScale((scale) => Math.min(3, scale + 0.2))}
          />
          <MapToolButton
            icon={<span className="text-base font-bold">-</span>}
            label="Alejar"
            onClick={() => setManualScale((scale) => Math.max(0.45, scale - 0.2))}
          />
          <MapToolButton
            icon={<FaDrawPolygon />}
            label="Dibujar zona"
            active={polygonMode}
            onClick={togglePolygonMode}
          />
          <MapToolButton
            icon={<FaRulerCombined />}
            label="Medir distancia"
            active={measureMode}
            onClick={toggleMeasureMode}
          />
          <MapToolButton
            icon={<FaMapMarkedAlt />}
            label="Activar navegación"
            active={navigationMode}
            onClick={() => setNavigationMode((current) => !current)}
          />
          <MapToolButton
            icon={
              <span className="text-[10px] font-black">
                {isMapFullscreen ? "X" : "FS"}
              </span>
            }
            label={isMapFullscreen ? "Salir full screen" : "Plano full screen"}
            onClick={() => toggleFullscreenForElement(mapSurfaceRef.current)}
          />
          <MapToolButton
            icon={<BsTrash3 />}
            label="Limpiar mapa"
            onClick={clearMapTools}
          />
        </div>

        {measureDistance != null ? (
          <div
            className={joinClasses(
              "absolute z-30 rounded-full border border-emerald-300/70 bg-emerald-50/95 px-3 py-2 text-[11px] font-semibold text-emerald-800 shadow-[0_12px_22px_rgba(16,185,129,0.14)]",
              isMapFullscreen ? "right-4" : "right-3 top-[6.2rem] sm:right-4 sm:top-[22rem]"
            )}
            style={
              isMapFullscreen
                ? { top: `${mapFullscreenContentTop + 56}px` }
                : undefined
            }
          >
            Distancia: {measureDistance.toFixed(0)} m
          </div>
        ) : null}

        <div
          className={joinClasses(
            "absolute z-30 max-w-[280px] rounded-[18px] border px-4 py-3",
            isMapFullscreen ? "" : "left-3 top-3 sm:left-4 sm:top-4"
          )}
          style={{
            ...(isMapFullscreen
              ? {
                  left: `${FULLSCREEN_PANEL_LEFT_PX}px`,
                  top: `${mapFullscreenContentTop}px`,
                }
              : {}),
            backgroundColor: "#07121f",
            borderColor: "rgba(96, 165, 250, 0.58)",
            color: "#f8fafc",
            boxShadow: "0 22px 42px rgba(2, 6, 23, 0.48)",
          }}
        >
          <div
            className="font-['Sora'] text-[14px] font-semibold tracking-tight"
            style={{ color: "#86c8ff" }}
          >
            {mapItem.label}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold">
            <span style={{ color: "#f8fafc" }}>{visibleDeviceCount} dispositivos</span>
            <span style={{ color: "#86efac" }}>{activeCount} On</span>
            <span style={{ color: "#fda4af" }}>{inactiveCount} Off</span>
          </div>
        </div>

        {isMapFullscreen ? (
          <img
            src={teleminingLogo}
            alt="Telemining"
            className="pointer-events-none absolute bottom-4 left-[88px] z-[176] h-16 w-auto opacity-95 drop-shadow-[0_10px_18px_rgba(0,0,0,0.4)]"
          />
        ) : null}

        {visibleDeviceCount === 0 ? (
          <div
            className={joinClasses(
              "absolute bottom-4 z-20 rounded-[14px] border border-slate-300/90 bg-white/96 px-3 py-2 text-[11px] font-semibold text-slate-900 shadow-[0_12px_28px_rgba(15,23,42,0.14)]",
              isMapFullscreen ? "left-[88px]" : "left-4"
            )}
          >
            Sin dispositivos NOC visibles en este plano.
          </div>
        ) : null}

        <div
          ref={mapViewportRef}
          className={joinClasses(
            "relative h-full w-full overflow-hidden",
            isMapFullscreen ? "absolute z-10" : ""
          )}
          style={
            isMapFullscreen
              ? {
                  top: `${mapFullscreenContentTop}px`,
                  right: "0px",
                  bottom: "0px",
                  left: `${FULLSCREEN_RAIL_LEFT_PX}px`,
                }
              : undefined
          }
          onClick={handleMapBackgroundClick}
          onWheel={handleWheel}
          onMouseDown={startPan}
          onMouseMove={movePan}
          onMouseUp={endPan}
          onMouseLeave={endPan}
        >
          <div
            ref={imageFrameRef}
            className="absolute"
            style={{
              ...imageFrameStyle,
              transform: `
                translate(${navigationMode ? pan.x : 0}px, ${navigationMode ? pan.y : 0}px)
                scale(${manualScale})
              `,
              transformOrigin: "center center",
              transition: isPanning ? "none" : "transform 0.25s ease-out",
              cursor: navigationMode
                ? isPanning
                  ? "grabbing"
                  : "grab"
                : polygonMode || measureMode
                ? "crosshair"
                : "default",
            }}
          >
            <img
              src={mapImageUrl}
              alt={mapItem.label}
              className="block h-full w-full select-none"
              draggable="false"
              onLoad={syncViewportSize}
            />

            {(polygonPoints.length >= 2 || measurePoints.length === 2) ? (
              <svg
                className="absolute inset-0 h-full w-full"
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
              >
                {polygonPoints.length >= 2 ? (
                  <polygon
                    points={polygonPoints.map((point) => `${point.x},${point.y}`).join(" ")}
                    fill="rgba(37,99,235,0.18)"
                    stroke="rgba(56,189,248,0.95)"
                    strokeWidth="0.003"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
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
            ) : null}

            {mapDevices.map((camera) => (
              <CameraMarker
                key={`${mapItem.code}-${camera.camera_id}`}
                camera={camera}
                isPopupOpen={openPopupIds.includes(camera.camera_id)}
                markerRef={(node) => registerMarkerRef(camera.camera_id, node)}
                onClick={() => handleCameraClick(camera)}
              />
            ))}
          </div>

          {openOfflineEntries.length > 0 ? (
            <OfflinePopupLayer
              entries={openOfflineEntries}
              mapCode={mapItem.code}
              onCloseCamera={(cameraId) =>
                setOpenPopupIds((current) =>
                  current.filter((item) => item !== cameraId)
                )
              }
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}

function CameraMarker({ camera, isPopupOpen, onClick, markerRef }) {
  const deviceKind = String(camera.device_kind || "camera").toLowerCase();
  const markerTone = camera.is_online
    ? "border-emerald-950 bg-[#00d26a] text-black shadow-[0_10px_18px_rgba(16,185,129,0.36)]"
    : "border-rose-950 bg-[#ff4141] text-black shadow-[0_10px_18px_rgba(244,63,94,0.36)]";
  const markerBlinkStyle = buildMarkerBlinkStyle(camera);
  const markerShapeClass =
    deviceKind === "gate"
      ? "rounded-[2px]"
      : deviceKind === "fan"
      ? "rounded-none"
      : "rounded-full";
  const markerShapeStyle =
    deviceKind === "fan"
      ? { clipPath: "polygon(50% 2%, 96% 94%, 4% 94%)" }
      : undefined;
  const markerIcon =
    deviceKind === "gate" ? (
      <BsDoorOpenFill />
    ) : deviceKind === "fan" ? (
      <FaFan />
    ) : (
      <BsCameraVideoFill />
    );

  return (
    <div
      className={joinClasses("absolute h-0 w-0", isPopupOpen ? "z-[120]" : "z-20")}
      style={{
        left: `${Number(camera.x_pct || 0) * 100}%`,
        top: `${Number(camera.y_pct || 0) * 100}%`,
      }}
    >
      <button
        ref={markerRef}
        type="button"
        className="group absolute left-0 top-0 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center border-0 bg-transparent p-0"
        onClick={(event) => {
          event.stopPropagation();
          onClick?.();
        }}
        title={`${camera.display_name || camera.name} - ${getDeviceKindLabel(camera.device_kind)} ${camera.is_online ? "On" : "Off"}`}
      >
        <span
          className={joinClasses(
            "flex h-4 w-4 items-center justify-center border text-[7px] ring-[1.5px] ring-white/90 transition group-hover:scale-105",
            markerShapeClass,
            markerTone
          )}
          style={{ ...markerBlinkStyle, ...markerShapeStyle }}
        >
          {markerIcon}
        </span>
        <span className="mt-0.5 text-[7px] font-extrabold text-slate-950 drop-shadow-[0_1px_1px_rgba(255,255,255,0.92)]">
          {camera.map_number ?? camera.camera_id}
        </span>
      </button>
    </div>
  );
}

function OfflinePopupLayer({ entries, mapCode, onCloseCamera }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[140]">
      <svg className="absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <marker
            id={`nok-arrow-${mapCode}`}
            markerWidth="10"
            markerHeight="10"
            refX="8"
            refY="3"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L0,6 L8,3 z" fill="rgba(255, 88, 104, 0.9)" />
          </marker>
        </defs>

        {entries.map((entry) => {
          const bottomRowLayout = entry.layoutMode === "bottom-row";
          const startX = bottomRowLayout
            ? entry.left + entry.width / 2
            : entry.left + entry.width;
          const startY = bottomRowLayout
            ? entry.top
            : entry.top + entry.height / 2;
          const endX = bottomRowLayout ? entry.anchor.x : entry.anchor.x - 10;
          const endY = entry.anchor.y;
          const pathData = bottomRowLayout
            ? `M ${startX} ${startY} C ${startX} ${Math.max(
                12,
                startY - 34
              )}, ${endX} ${Math.min(startY - 28, endY + 46)}, ${endX} ${endY}`
            : `M ${startX} ${startY} C ${startX + 28} ${startY}, ${Math.max(
                startX + 54,
                endX - 34
              )} ${endY}, ${endX} ${endY}`;

          return (
            <path
              key={`line-${entry.camera.camera_id}`}
              d={pathData}
              fill="none"
              stroke="rgba(255, 88, 104, 0.82)"
              strokeDasharray="8 6"
              strokeWidth="2"
              markerEnd={`url(#nok-arrow-${mapCode})`}
            />
          );
        })}
      </svg>

      {entries.map((entry) => (
        <OfflineCameraCallout
          key={`popup-${entry.camera.camera_id}`}
          camera={entry.camera}
          popupStyle={{
            left: `${entry.left}px`,
            top: `${entry.top}px`,
            width: `${entry.width}px`,
          }}
          onClose={() => onCloseCamera?.(entry.camera.camera_id)}
        />
      ))}
    </div>
  );
}

function OfflineCameraCallout({ camera, popupStyle, onClose }) {
  return (
    <button
      type="button"
      className="pointer-events-auto absolute z-[145] rounded-[16px] border-2 border-[#ff3748] bg-[#02050d] px-3.5 py-3 text-left text-[10px] leading-4 text-slate-50 shadow-[0_24px_44px_rgba(0,0,0,0.66)]"
      style={popupStyle}
      onClick={(event) => {
        event.stopPropagation();
        onClose?.();
      }}
    >
      <div className="truncate text-[11px] font-semibold text-white">
        {camera.display_name || camera.name}
      </div>
      <div className="mt-1 text-[10px] font-medium text-[#ff9aa3]">
        FI: {formatOfflineCompactDate(camera.offline_since || camera.last_offline_at)}
      </div>
    </button>
  );
}
