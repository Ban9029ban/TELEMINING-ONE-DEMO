import React, { useContext, useEffect, useState } from "react";
import {
  BsArrowBarLeft,
  BsArrowBarRight,
  BsCameraVideoFill,
  BsCpuFill,
  BsDoorOpenFill,
  BsExclamationTriangleFill,
  BsGearFill,
  BsHouseDoorFill,
  BsLightbulbFill,
  BsMapFill,
  BsPieChartFill,
  BsX,
} from "react-icons/bs";
import { FaTrafficLight } from "react-icons/fa";
import { FaRoadBarrier } from "react-icons/fa6";
import { GiMountains } from "react-icons/gi";
import { Link, useLocation } from "react-router-dom";

import AccessDeniedModal from "./AccessDeniedModal";
import { DarkModeContext } from "./DarkModeContext";
import useUserPermissions from "../hooks/useUserPermissions";
import {
  canAccessRoute,
  getRouteAccessRule,
} from "../utils/accessControl";

const BASE_NAV_ITEMS = [
  { path: "/", label: "Tracking", icon: <BsHouseDoorFill size={11} /> },
  { path: "/produccion", label: "Producción", icon: <BsMapFill size={11} /> },
  { path: "/access", label: "Acceso", icon: <BsDoorOpenFill size={11} /> },
  { path: "/cameras", label: "Cámaras", icon: <BsCameraVideoFill size={11} /> },
  {
    path: "/cameras/nok",
    label: "NOC",
    icon: <BsExclamationTriangleFill size={11} />,
  },
  {
    path: "/sismico",
    label: "Semáforos sísmicos",
    icon: <GiMountains size={11} />,
    multiline: true,
  },
  {
    path: "/semaforos-control-vial",
    label: "Semáforos control vial",
    icon: <FaTrafficLight size={11} />,
    multiline: true,
  },
  {
    path: "/control-trafico-barreras",
    label: "Control de tráfico vial / barreras",
    icon: <FaRoadBarrier size={11} />,
    multiline: true,
  },
  { path: "/productividad", label: "Productividad", icon: <BsPieChartFill size={11} /> },
  { path: "/mcp", label: "Agente IA TM One", icon: <BsCpuFill size={11} />, multiline: true },
  { path: "/config", label: "Configuración", icon: <BsGearFill size={11} /> },
];

const SECONDARY_ITEMS = [
  { path: "/lobby", label: "Zonas DET", icon: <BsMapFill size={11} /> },
];

const Sidebar = ({
  isCollapsed,
  toggleSidebar,
  isMobileOpen = false,
  onCloseMobile,
}) => {
  const { isDarkMode, toggleDarkMode } = useContext(DarkModeContext);
  const location = useLocation();
  const { permissions, roles } = useUserPermissions({ syncOnMount: false });
  const [blockedResource, setBlockedResource] = useState("");
  const [trafficBarriersInstalled, setTrafficBarriersInstalled] = useState(true);
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 1024 : true
  );

  useEffect(() => {
    const syncViewport = () => {
      setIsDesktop(window.innerWidth >= 1024);
    };

    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  useEffect(() => {
    let active = true;
    const refreshInstalledUpdates = async () => {
      const token = localStorage.getItem("token");
      try {
        const response = await fetch("/api/config/updates", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) return;
        const payload = await response.json();
        const item = (Array.isArray(payload?.items) ? payload.items : []).find(
          (entry) => entry.id === "control-trafico-barreras",
        );
        if (active) setTrafficBarriersInstalled(Boolean(item?.installed));
      } catch (_error) {
        // Conserva el estado visible durante una interrupción temporal del API.
      }
    };
    refreshInstalledUpdates();
    window.addEventListener("zenit-updates-changed", refreshInstalledUpdates);
    return () => {
      active = false;
      window.removeEventListener("zenit-updates-changed", refreshInstalledUpdates);
    };
  }, []);

  useEffect(() => {
    if (!isDesktop) {
      onCloseMobile?.();
    }
  }, [isDesktop, location.pathname, onCloseMobile]);

  const showExpanded = !isDesktop || !isCollapsed;
  const navItems = BASE_NAV_ITEMS.filter(
    (item) => item.path !== "/control-trafico-barreras" || trafficBarriersInstalled,
  );

  const isActive = (path) => {
    if (path === "/productividad") {
      return (
        location.pathname.startsWith("/productividad") ||
        location.pathname.startsWith("/grafic")
      );
    }

    if (path === "/cameras") {
      return (
        location.pathname === "/cameras" ||
        (location.pathname.startsWith("/cameras/") &&
          !location.pathname.startsWith("/cameras/nok"))
      );
    }

    if (path === "/cameras/nok") {
      return (
        location.pathname === "/cameras/nok" ||
        location.pathname.startsWith("/cameras/nok/")
      );
    }

    return path === "/"
      ? location.pathname === "/"
      : location.pathname.startsWith(path);
  };

  const navClass = (path) =>
    [
      "group flex items-center gap-1.5 rounded-[13px] border px-1.5 py-1.5 text-[9px] font-medium transition duration-200",
      showExpanded ? "" : "justify-center",
      isActive(path)
        ? "border-indigo-400/35 bg-[linear-gradient(135deg,rgba(79,70,229,0.32)_0%,rgba(37,99,235,0.18)_55%,rgba(6,182,212,0.14)_100%)] text-white shadow-[0_18px_34px_rgba(37,99,235,0.2)]"
        : "border-transparent text-slate-200/88 hover:border-white/10 hover:bg-white/8 hover:text-white",
    ].join(" ");

  const renderNavItem = (item) => (
    <li key={item.path}>
      {(() => {
        const allowed = canAccessRoute(item.path, { permissions, roles });
        const rule = getRouteAccessRule(item.path);
        return (
      <Link
        to={item.path}
        className={navClass(item.path)}
        onClick={(event) => {
          if (!allowed) {
            event.preventDefault();
            setBlockedResource(rule?.label || item.label);
            return;
          }
          onCloseMobile?.();
        }}
      >
        <span
          className={[
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-[11px] border transition",
            isActive(item.path)
              ? "border-white/20 bg-white/14 text-white"
              : allowed
              ? "border-white/8 bg-white/5 text-slate-200/90 group-hover:border-white/14 group-hover:bg-white/10"
              : "border-white/8 bg-white/5 text-slate-400/70",
          ].join(" ")}
        >
          {item.icon}
        </span>
        {showExpanded && (
          <span
            className={[
              item.multiline ? "max-w-[104px] leading-tight text-[9px]" : "max-w-[104px] text-[9px]",
              allowed ? "" : "text-slate-400/70",
            ].join(" ")}
          >
            {item.label}
          </span>
        )}
      </Link>
        );
      })()}
    </li>
  );

  return (
    <aside
      id="sidebar"
      className={`fixed left-0 top-0 z-40 flex h-screen flex-col justify-between border-r border-white/8 bg-[linear-gradient(180deg,#091224_0%,#0b1530_46%,#101c3f_100%)] text-white shadow-[0_32px_80px_rgba(2,6,23,0.42)] transition-all duration-300 ${
        isMobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      } w-[280px] sm:w-[312px] ${
        isCollapsed ? "lg:w-[78px]" : "lg:w-[160px] xl:w-[168px]"
      }`}
    >
      <div className="min-h-0">
        <div className="border-b border-white/8 px-2.5 pb-3 pt-3">
          <div className="flex items-start justify-between gap-1.5">
            {showExpanded ? (
              <div className="space-y-1.5">
                <div className="inline-flex items-center rounded-full border border-cyan-400/18 bg-cyan-400/10 px-1.5 py-0.5 text-[7px] font-semibold uppercase tracking-[0.2em] text-cyan-100">
                  Operations OS
                </div>
                <div>
                  <Link
                    to="/"
                    className="font-['Sora'] text-[14px] font-semibold tracking-tight text-white"
                  >
                    TM One
                  </Link>
                  <div className="mt-1 text-[7px] text-slate-300/72">
                    Control operacional, flota y analítica en una sola vista.
                  </div>
                </div>
              </div>
            ) : (
              <Link
                to="/"
                className="mx-auto flex h-7 w-7 items-center justify-center rounded-2xl border border-white/12 bg-white/8 font-['Sora'] text-base font-semibold tracking-tight"
              >
                TM
              </Link>
            )}

            <button
              type="button"
              onClick={() => {
                if (isDesktop) toggleSidebar();
                else onCloseMobile?.();
              }}
              className="flex h-8 w-8 items-center justify-center rounded-2xl border border-white/12 bg-white/6 text-white/90 transition hover:bg-white/12"
            >
              {isDesktop ? (
                showExpanded ? <BsArrowBarLeft size={11} /> : <BsArrowBarRight size={11} />
              ) : (
                <BsX size={16} />
              )}
            </button>
          </div>
        </div>

        <div className="px-2.5 py-3">
          {showExpanded && (
            <div className="mb-2 px-1 text-[8px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Navegación principal
            </div>
          )}
          <ul className="space-y-1.5">{navItems.map(renderNavItem)}</ul>
        </div>
      </div>

      <div className="border-t border-white/8 px-2.5 py-3">
        {showExpanded && (
          <div className="mb-2 px-1 text-[8px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Extras
          </div>
        )}

        <div className="space-y-1.5">
          {SECONDARY_ITEMS.map(renderNavItem)}

          <button
            type="button"
            onClick={toggleDarkMode}
            className={[
              "group flex w-full items-center gap-1.5 rounded-[13px] border border-transparent px-1.5 py-1 text-left text-[9px] font-medium text-slate-200/88 transition hover:border-white/10 hover:bg-white/8 hover:text-white",
              showExpanded ? "" : "justify-center",
            ].join(" ")}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[11px] border border-white/8 bg-white/5 text-slate-200/90 transition group-hover:border-white/14 group-hover:bg-white/10">
              <BsLightbulbFill size={11} />
            </span>
            {showExpanded && (
              <span className="flex flex-1 items-center justify-between gap-2">
                <span>Tema</span>
                <span className="rounded-full bg-white/8 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.16em] text-slate-300">
                  {isDarkMode ? "Dark" : "Light"}
                </span>
              </span>
            )}
          </button>
        </div>

        {showExpanded && (
          <div className="mt-3 rounded-[18px] border border-white/10 bg-white/6 px-2 py-2.5">
            <div className="text-[8px] font-semibold uppercase tracking-[0.16em] text-slate-300">
              Estado UI
            </div>
            <div className="mt-2 flex items-center justify-between text-[9px] text-white/92">
              <span>Modo visual</span>
              <span className="rounded-full bg-emerald-400/16 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.14em] text-emerald-200">
                Moderno
              </span>
            </div>
          </div>
        )}
      </div>

      <AccessDeniedModal
        open={Boolean(blockedResource)}
        resourceLabel={blockedResource || "este recurso"}
        onClose={() => setBlockedResource("")}
      />
    </aside>
  );
};

export default Sidebar;
