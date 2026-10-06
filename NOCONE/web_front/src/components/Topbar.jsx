import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BsBellFill,
  BsChevronDown,
  BsList,
  BsPersonCircle } from
"react-icons/bs";
import { useLocation } from "react-router-dom";

import useFetchUserData from "../hooks/useFetchUserData";
import teleminiblack from "../images/teleminiblack.png";
import teleminin from "../images/teleminin.png";

const MODULE_META = [
  { match: "/produccion", title: "Producci\u00f3n", subtitle: "Plano operativo, gantt y control de turno." },
  { match: "/access", title: "Control de accesos", subtitle: "Interior actual, p\u00f3rticos y trazabilidad diaria." },
  { match: "/cameras/nok", title: "NOC", subtitle: "Monitoreo IP, estado online/offline y alertas visuales por plano." },
  { match: "/cameras", title: "Centro de c\u00e1maras", subtitle: "Operaci\u00f3n CCTV, videoanal\u00edtica y seguimiento visual." },
  { match: "/productividad", title: "Centro anal\u00edtico", subtitle: "Productividad, correlaciones y lectura ejecutiva." },
  { match: "/mcp", title: "Agente IA TM One", subtitle: "Asistente operacional, consultas y automatizaciones seguras." },
  { match: "/config", title: "Configuraci\u00f3n", subtitle: "Maestros operacionales, tags, personas y p\u00f3rticos." },
  { match: "/lobby", title: "Zonas DET", subtitle: "Navegaci\u00f3n espacial y superficies de trabajo." },
  { match: "/sismico", title: "Sem\u00e1foros s\u00edsmicos", subtitle: "Lectura de criticidad y continuidad operacional." },
  { match: "/semaforos-control-vial", title: "Control vial", subtitle: "Estado visual de flujos y circulaci\u00f3n operacional." },
  { match: "/", title: "Tracking y flota", subtitle: "Mapa operativo, waypoints, p\u00f3rticos y movimiento." }
];


function getModuleMeta(pathname) {
  const found = MODULE_META.find((item) =>
    item.match === "/" ? pathname === "/" : pathname.startsWith(item.match)
  );

  return found || MODULE_META[MODULE_META.length - 1];
}

const Topbar = ({ onOpenSidebar }) => {
  const topbarRef = useRef(null);
  const location = useLocation();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [fechaHoraChile, setFechaHoraChile] = useState("");
  const { user, roles } = useFetchUserData();

  const moduleMeta = useMemo(
    () => getModuleMeta(location.pathname),
    [location.pathname]
  );

  useEffect(() => {
    const updateFechaHora = () => {
      const now = new Date();
      const dia = now.toLocaleString("es-CL", {
        day: "2-digit",
        timeZone: "America/Santiago"
      });
      const mes = now.toLocaleString("es-CL", {
        month: "long",
        timeZone: "America/Santiago"
      });
      const anio = now.toLocaleString("es-CL", {
        year: "numeric",
        timeZone: "America/Santiago"
      });
      const hora = now.toLocaleString("es-CL", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: "America/Santiago"
      });

      setFechaHoraChile(`${dia} de ${mes} de ${anio}, ${hora}`);
    };

    updateFechaHora();
    const interval = setInterval(updateFechaHora, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleDocumentClick = (event) => {
      if (!topbarRef.current?.contains(event.target)) {
        setNotificationsOpen(false);
        setUserMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleDocumentClick);
    return () => document.removeEventListener("mousedown", handleDocumentClick);
  }, []);

  const displayName =
  user || localStorage.getItem("full_name") || localStorage.getItem("username") || "Administrador";
  const displayRole =
  roles?.[0]?.name || localStorage.getItem("role_name") || "Administrador";

  return (
    <div
      ref={topbarRef}
      className="tm-shell-panel relative z-[220] px-4 py-3 sm:px-4 sm:py-3.5 lg:px-5">
      
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <button
            type="button"
            onClick={onOpenSidebar}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/70 bg-white/90 text-slate-700 shadow-[0_12px_24px_rgba(15,23,42,0.08)] transition hover:translate-y-[-1px] lg:hidden"
            aria-label="Abrir men lateral">
            
            <BsList className="text-lg" />
          </button>

          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              {fechaHoraChile}
            </div>
            <div className="mt-2 flex flex-col gap-2 xl:flex-row xl:items-end xl:gap-5">
              <div className="min-w-0">
                <div className="truncate font-['Sora'] text-[22px] font-semibold tracking-tight text-slate-950 sm:text-[24px] xl:text-[26px]">
                  {moduleMeta.title}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 xl:min-w-[360px] xl:items-end">
          <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
            <a
              href="https://www.telemining.cl/empresa/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex rounded-[20px] border border-white/70 bg-white/86 px-3 py-2.5 shadow-[0_14px_26px_rgba(15,23,42,0.08)]">
              
              <img src={teleminiblack} alt="Logo claro" className="hidden w-28 sm:w-32 dark:block" />
              <img src={teleminin} alt="Logo oscuro" className="w-28 sm:w-32 dark:hidden" />
            </a>

            <div className="relative">
              <button
                type="button"
                onClick={() => setNotificationsOpen((open) => !open)}
                className="relative flex h-10 w-10 items-center justify-center rounded-[18px] border border-white/70 bg-white/90 text-slate-700 shadow-[0_14px_26px_rgba(15,23,42,0.08)] transition hover:translate-y-[-1px] sm:h-11 sm:w-11">
                
                <BsBellFill className="text-base sm:text-lg" />
                <span className="absolute right-2 top-2 inline-flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-slate-900">
                  2
                </span>
              </button>

              {notificationsOpen ?
              <div className="absolute right-0 z-[230] mt-3 w-80 rounded-[24px] border border-white/75 bg-white/95 p-4 shadow-[0_24px_40px_rgba(15,23,42,0.14)] backdrop-blur">
                  <div className="text-sm font-semibold text-slate-900">
                    Notificaciones operacionales
                  </div>
                  <div className="mt-3 space-y-2 text-sm text-slate-600">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                      No hay incidencias nuevas por revisar.
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                      Sistema listo para seguimiento de tracking y cmaras.
                    </div>
                  </div>
                </div> :
              null}
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setUserMenuOpen((open) => !open)}
                className="flex min-w-0 items-center gap-2 rounded-[20px] border border-white/70 bg-white/90 px-2.5 py-2 text-left shadow-[0_14px_26px_rgba(15,23,42,0.08)] transition hover:translate-y-[-1px] sm:gap-3 sm:px-3">
                
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#4f46e5_0%,#2563eb_100%)] text-white shadow-[0_10px_22px_rgba(79,70,229,0.26)] sm:h-10 sm:w-10">
                  <BsPersonCircle className="text-lg sm:text-xl" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold text-slate-900 sm:text-sm">
                    {displayName}
                  </div>
                  <div className="truncate text-[11px] text-slate-500">{displayRole}</div>
                </div>
                <BsChevronDown className="shrink-0 text-slate-400" />
              </button>

              {userMenuOpen ?
              <div className="absolute right-0 z-[230] mt-3 w-56 rounded-[24px] border border-white/75 bg-white/95 p-2 shadow-[0_24px_40px_rgba(15,23,42,0.14)] backdrop-blur">
                  <a
                  className="block rounded-2xl px-4 py-3 text-sm font-medium text-rose-600 transition hover:bg-rose-50"
                  href="/logout">
                  
                    Cerrar sesión
                  </a>
                </div> :
              null}
            </div>
          </div>
        </div>
      </div>
    </div>);

};

export default Topbar;
