import React, { useEffect, useMemo, useState } from "react";
import { BsCameraVideoFill, BsGeoAltFill, BsMapFill } from "react-icons/bs";

import MapShowCamaras from "../../components/MapShow_camaras";
import { API_URL } from "../../api-config";
import {
  FieldShell,
  PageShell,
  SectionCard,
  StatusBadge } from
"../../components/SystemTheme";

const MAPS = [
{ label: "NTI Andes Norte", code: "NTI_andes_norte" },
{ label: "Diamante - NP", code: "NP_dia" },
{ label: "Diamante NTI", code: "NTI_dia" }];


const CAMERA_KINDS = ["camera", "gate", "fan"];
const DASHBOARD_API = `${API_URL}/cameras/dashboard`;
const EMPTY_DASHBOARD = {
  summary: {
    active_persons: 0,
    active_vehicles: 0,
    active_findings: 0,
    cumulative_findings: 0,
    updated_at: null
  },
  findings_grid: [],
  latest_findings: []
};

function matchesSearch(values, search) {
  if (!search) return true;
  return values.
  filter(Boolean).
  join(" ").
  toLowerCase().
  includes(search);
}

function formatTimeLabel(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function formatUpdatedLabel(value) {
  if (!value) return "Sin sincronizacion reciente";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin sincronizacion reciente";
  return `Actualizado ${date.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  })}`;
}

function buildCameraLink(videoId) {
  return `/cameras/ver?cam=${videoId}`;
}

function buildUniqueValues(rows, selector) {
  return Array.from(
    new Set(
      (Array.isArray(rows) ? rows : [])
        .map((row) => selector(row))
        .filter((value) => value !== null && value !== undefined && String(value).trim() !== "")
        .map((value) => String(value).trim())
    )
  ).sort((left, right) => left.localeCompare(right, "es"));
}

export default function CamerasMap() {
  const [selectedMap, setSelectedMap] = useState("NP_dia");
  const [dashboardData, setDashboardData] = useState(EMPTY_DASHBOARD);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState(null);

  const activeMapLabel = MAPS.find((mapItem) => mapItem.code === selectedMap)?.label || selectedMap;

  useEffect(() => {
    let cancelled = false;
    let timerId = null;

    const loadDashboard = async (silent = false) => {
      if (!silent) {
        setDashboardLoading(true);
      }

      try {
        const response = await fetch(`${DASHBOARD_API}/${selectedMap}`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        if (cancelled) return;

        setDashboardData({
          summary: {
            ...EMPTY_DASHBOARD.summary,
            ...(data?.summary || {})
          },
          findings_grid: Array.isArray(data?.findings_grid) ? data.findings_grid : [],
          latest_findings: Array.isArray(data?.latest_findings) ? data.latest_findings : []
        });
        setDashboardError(null);
      } catch (error) {
        if (cancelled) return;
        setDashboardError("No se pudo cargar la analítica de cámaras para este plano.");
      } finally {
        if (!cancelled && !silent) {
          setDashboardLoading(false);
        }
      }
    };

    loadDashboard(false);
    timerId = window.setInterval(() => loadDashboard(true), 8000);

    return () => {
      cancelled = true;
      if (timerId) {
        window.clearInterval(timerId);
      }
    };
  }, [selectedMap]);

  return (
    <PageShell
      eyebrow="Cartografía CCTV"
      title="Mapa de cámaras"
      description="Una capa visual más clara para operar cámaras dentro del plano: selección de mapa, estado del dispositivo y acceso rápido al módulo de videoanalítica."
      actions={<StatusBadge tone="amber">Visualización CCTV</StatusBadge>}
      stats={[
      {
        label: "Mapa activo",
        value: activeMapLabel,
        meta: "Plano operacional seleccionado",
        tone: "blue",
        icon: <BsMapFill />
      },
      {
        label: "Filtro",
        value: "Dispositivos NOC",
        meta: "Cámaras, portones y ventiladores",
        tone: "amber",
        icon: <BsCameraVideoFill />
      }]
      }>
      
      <SectionCard
        title="Plano y leyenda"
        subtitle="Selecciona el plano que quieres inspeccionar y revisa el estado de las cámaras directamente sobre el mapa.">
        
        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="rounded-[24px] border border-slate-200 bg-slate-50/90 p-4">
              <FieldShell label="Mapa">
                <select
                  className="tm-control"
                  value={selectedMap}
                  onChange={(e) => setSelectedMap(e.target.value)}>
                  
                  {MAPS.map((mapItem) =>
                  <option key={mapItem.code} value={mapItem.code}>
                      {mapItem.label}
                    </option>
                  )}
                </select>
              </FieldShell>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-slate-50/90 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Leyenda de estado
              </div>
              <div className="mt-4 space-y-3">
                <LegendItem
                  iconClass="bg-[linear-gradient(135deg,#f97316_0%,#fb7185_100%)]"
                  label="Dispositivo On"
                  text="Dispositivo online con keep alive activo." />
                
                <LegendItem
                  iconClass="bg-[linear-gradient(135deg,#94a3b8_0%,#64748b_100%)]"
                  label="Dispositivo Off"
                  text="Sin datos o con estado de desconexión visible en la capa actual." />
                
                <LegendItem
                  iconClass="bg-[linear-gradient(135deg,#4f46e5_0%,#2563eb_100%)]"
                  label="Cámara enfocada"
                  text="Elemento resaltado para seguimiento o navegación puntual." />
                
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white/92 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
            <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Exploracion cartografica CCTV
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  Usa zoom, paneo y popup contextual para abrir la cámara correcta más rápido.
                </div>
              </div>

              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                <BsGeoAltFill className="text-sky-600" />
                {activeMapLabel}
              </div>
            </div>

            <MapShowCamaras selectedMap={selectedMap} filterKinds={CAMERA_KINDS} />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Hallazgos y resumen en vivo"
        subtitle="Vista operativa alimentada desde base de datos para revisar cámaras con hallazgos recientes y abrir la fuente correcta.">
        
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_360px]">
          <LiveFindingsGrid
            rows={dashboardData.findings_grid}
            loading={dashboardLoading}
            error={dashboardError} />
          

          <div className="space-y-4">
            <AnalyticsSummaryCard summary={dashboardData.summary} />
            <LatestFindingsCard
              rows={dashboardData.latest_findings}
              loading={dashboardLoading}
              error={dashboardError} />
            
          </div>
        </div>
      </SectionCard>
    </PageShell>);

}

function LiveFindingsGrid({ rows, loading, error }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [cameraFilter, setCameraFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [coverageFilter, setCoverageFilter] = useState("all");
  const [zoneFilter, setZoneFilter] = useState("all");
  const normalizedSearch = searchTerm.trim().toLowerCase();

  const cameraOptions = useMemo(
    () => buildUniqueValues(rows, (row) => row.camera_name || `Cámara ${row.video_id}`),
    [rows]
  );
  const groupOptions = useMemo(() => buildUniqueValues(rows, (row) => row.finding_group), [rows]);
  const coverageOptions = useMemo(() => buildUniqueValues(rows, (row) => row.coverage), [rows]);
  const zoneOptions = useMemo(() => buildUniqueValues(rows, (row) => row.zone), [rows]);

  const filteredRows = useMemo(
    () =>
    rows.filter((row) => {
      const cameraName = row.camera_name || `Cámara ${row.video_id}`;
      const matchesText = matchesSearch(
        [
        cameraName,
        row.finding_code,
        row.finding_group,
        row.finding_label,
        row.zone,
        row.evidence,
        row.coverage],

        normalizedSearch
      );
      const matchesCamera = cameraFilter === "all" || cameraName === cameraFilter;
      const matchesGroup = groupFilter === "all" || row.finding_group === groupFilter;
      const matchesCoverage = coverageFilter === "all" || row.coverage === coverageFilter;
      const matchesZone = zoneFilter === "all" || (row.zone || "") === zoneFilter;
      return matchesText && matchesCamera && matchesGroup && matchesCoverage && matchesZone;
    }),
    [rows, normalizedSearch, cameraFilter, groupFilter, coverageFilter, zoneFilter]
  );

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white/92 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Hallazgos CCTV
            </div>
            <div className="mt-2 text-xl font-semibold text-slate-900">
              Grilla de hallazgos en tiempo real
            </div>
            <div className="mt-1 text-sm text-slate-500">
              Lee eventos persistidos en base y abre la cámara exacta asociada al hallazgo.
            </div>
          </div>

          <div className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
            CCTV operativo sobre base simulada y eventos persistidos
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-5">
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Buscar cámara, código, grupo, hallazgo o evidencia..."
            className="w-full rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:bg-white xl:col-span-2" />
          

          <select
            value={cameraFilter}
            onChange={(event) => setCameraFilter(event.target.value)}
            className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:bg-white">
            
            <option value="all">Todas las cámaras</option>
            {cameraOptions.map((option) =>
            <option key={option} value={option}>
                {option}
              </option>
            )}
          </select>

          <select
            value={groupFilter}
            onChange={(event) => setGroupFilter(event.target.value)}
            className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:bg-white">
            
            <option value="all">Todos los grupos</option>
            {groupOptions.map((option) =>
            <option key={option} value={option}>
                {option}
              </option>
            )}
          </select>

          <select
            value={coverageFilter}
            onChange={(event) => setCoverageFilter(event.target.value)}
            className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:bg-white">
            
            <option value="all">Toda cobertura</option>
            {coverageOptions.map((option) =>
            <option key={option} value={option}>
                {option}
              </option>
            )}
          </select>

          <select
            value={zoneFilter}
            onChange={(event) => setZoneFilter(event.target.value)}
            className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:bg-white">
            
            <option value="all">Todas las zonas</option>
            {zoneOptions.map((option) =>
            <option key={option} value={option}>
                {option}
              </option>
            )}
          </select>
        </div>

        <div className="text-xs text-slate-500">
          {filteredRows.length} hallazgos visibles de {rows.length} registrados en este plano.
        </div>
      </div>

      <div className="mt-4 max-h-[440px] overflow-auto rounded-[20px] border border-slate-200">
        <table className="min-w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] uppercase tracking-[0.14em] text-slate-500">
            <tr>
              <th className="px-4 py-3">Hora</th>
              <th className="px-4 py-3">Cámara</th>
              <th className="px-4 py-3">Cod.</th>
              <th className="px-4 py-3">Grupo</th>
              <th className="px-4 py-3">Hallazgo</th>
              <th className="px-4 py-3">Zona</th>
              <th className="px-4 py-3">Evidencia</th>
              <th className="px-4 py-3 text-right">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
            {loading && rows.length === 0 ?
            <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">
                  Cargando hallazgos de cámaras...
                </td>
              </tr> :
            error && rows.length === 0 ?
            <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-rose-600">
                  {error}
                </td>
              </tr> :
            filteredRows.length === 0 ?
            <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">
                  {normalizedSearch ?
                "No hay coincidencias para el filtro aplicado." :
                "Aún no hay hallazgos persistidos para este plano."}
                </td>
              </tr> :

            filteredRows.map((row) =>
            <tr key={`${row.id}-${row.video_id}`}>
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-800">
                    {formatTimeLabel(row.detected_at)}
                  </td>
                  <td className="px-4 py-3">
                    <a
                  href={buildCameraLink(row.video_id)}
                  className="font-semibold text-sky-700 underline-offset-2 hover:text-sky-900 hover:underline">
                  
                      {row.camera_name || `Cámara ${row.video_id}`}
                    </a>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-900">
                    #{row.finding_code}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">{row.finding_group}</td>
                  <td className="min-w-[260px] px-4 py-3">{row.finding_label}</td>
                  <td className="whitespace-nowrap px-4 py-3">{row.zone || "-"}</td>
                  <td className="min-w-[220px] px-4 py-3 text-slate-500">
                    <div className="flex flex-col gap-2">
                      <span>{row.evidence || "-"}</span>
                      {row.evidence_video_url ?
                  <a
                    href={row.evidence_video_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex w-fit items-center rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 transition hover:border-violet-300 hover:bg-violet-100">
                    
                          Ver video corto
                        </a> :
                  null}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <a
                  href={buildCameraLink(row.video_id)}
                  className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 transition hover:border-sky-300 hover:bg-sky-100">

                      Ver cámara
                    </a>
                  </td>
                </tr>
            )
            }
          </tbody>
        </table>
      </div>
    </div>);

}

function AnalyticsSummaryCard({ summary }) {
  const cards = [
  {
    label: "Personas activas",
    value: summary?.active_persons || 0,
    tone: "border-emerald-300"
  },
  {
    label: "Vehículos activos",
    value: summary?.active_vehicles || 0,
    tone: "border-amber-300"
  },
  {
    label: "Hallazgos activos",
    value: summary?.active_findings || 0,
    tone: "border-rose-300"
  },
  {
    label: "Hallazgos acumulados",
    value: summary?.cumulative_findings || 0,
    tone: "border-violet-300"
  }];


  return (
    <div className="rounded-[28px] border border-slate-200 bg-white/92 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
      <div className="flex items-center justify-between">
        <div className="text-xl font-semibold text-slate-900">Resumen analítico</div>
        <div className="text-xs text-slate-500">{formatUpdatedLabel(summary?.updated_at)}</div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
        {cards.map((card) =>
        <div
          key={card.label}
          className={`rounded-[20px] border ${card.tone} bg-slate-50/80 px-4 py-4`}>
          
            <div className="text-3xl font-semibold text-slate-900">{card.value}</div>
            <div className="mt-2 text-sm text-slate-500">{card.label}</div>
          </div>
        )}
      </div>
    </div>);

}

function LatestFindingsCard({ rows, loading, error }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [cameraFilter, setCameraFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [zoneFilter, setZoneFilter] = useState("all");
  const normalizedSearch = searchTerm.trim().toLowerCase();

  const cameraOptions = useMemo(
    () => buildUniqueValues(rows, (row) => row.camera_name || `Cámara ${row.video_id}`),
    [rows]
  );
  const groupOptions = useMemo(() => buildUniqueValues(rows, (row) => row.finding_group), [rows]);
  const zoneOptions = useMemo(() => buildUniqueValues(rows, (row) => row.zone), [rows]);

  const filteredRows = useMemo(
    () =>
    rows.filter((row) => {
      const cameraName = row.camera_name || `Cámara ${row.video_id}`;
      const matchesText = matchesSearch(
        [row.finding_code, row.finding_label, row.zone, cameraName, row.finding_group],
        normalizedSearch
      );
      const matchesCamera = cameraFilter === "all" || cameraName === cameraFilter;
      const matchesGroup = groupFilter === "all" || row.finding_group === groupFilter;
      const matchesZone = zoneFilter === "all" || (row.zone || "") === zoneFilter;
      return matchesText && matchesCamera && matchesGroup && matchesZone;
    }),
    [rows, normalizedSearch, cameraFilter, groupFilter, zoneFilter]
  );

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white/92 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
      <div className="text-xl font-semibold text-slate-900">Últimos hallazgos</div>

      <div className="mt-4 grid gap-3">
        <input
          type="text"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Buscar por código, hallazgo, cámara o zona..."
          className="w-full rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:bg-white" />
        

        <div className="grid gap-3 sm:grid-cols-3">
          <select
            value={cameraFilter}
            onChange={(event) => setCameraFilter(event.target.value)}
            className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:bg-white">
            
            <option value="all">Todas las cámaras</option>
            {cameraOptions.map((option) =>
            <option key={option} value={option}>
                {option}
              </option>
            )}
          </select>

          <select
            value={groupFilter}
            onChange={(event) => setGroupFilter(event.target.value)}
            className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:bg-white">
            
            <option value="all">Todos los grupos</option>
            {groupOptions.map((option) =>
            <option key={option} value={option}>
                {option}
              </option>
            )}
          </select>

          <select
            value={zoneFilter}
            onChange={(event) => setZoneFilter(event.target.value)}
            className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:bg-white">
            
            <option value="all">Todas las zonas</option>
            {zoneOptions.map((option) =>
            <option key={option} value={option}>
                {option}
              </option>
            )}
          </select>
        </div>

        <div className="text-xs text-slate-500">
          {filteredRows.length} hallazgos visibles de {rows.length} recientes.
        </div>
      </div>

      <div className="mt-4 overflow-auto rounded-[20px] border border-slate-200">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-[0.14em] text-slate-500">
            <tr>
              <th className="px-4 py-3">Hora</th>
              <th className="px-4 py-3">Cod.</th>
              <th className="px-4 py-3">Hallazgo</th>
              <th className="px-4 py-3">Zona</th>
              <th className="px-4 py-3">Cámara</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
            {loading && rows.length === 0 ?
            <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                  Cargando últimos hallazgos...
                </td>
              </tr> :
            error && rows.length === 0 ?
            <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-rose-600">
                  {error}
                </td>
              </tr> :
            filteredRows.length === 0 ?
            <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                  {normalizedSearch ?
                "No hay coincidencias para el filtro aplicado." :
                "Aún no hay hallazgos registrados."}
                </td>
              </tr> :

            filteredRows.map((row) =>
            <tr key={`latest-${row.id}`}>
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-800">
                    {formatTimeLabel(row.detected_at)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-900">
                    #{row.finding_code}
                  </td>
                  <td className="px-4 py-3">{row.finding_label}</td>
                  <td className="whitespace-nowrap px-4 py-3">{row.zone || "-"}</td>
                  <td className="px-4 py-3">
                    <a
                  href={buildCameraLink(row.video_id)}
                  className="font-semibold text-sky-700 underline-offset-2 hover:text-sky-900 hover:underline">
                  
                      {row.camera_name || `Cámara ${row.video_id}`}
                    </a>
                  </td>
                </tr>
            )
            }
          </tbody>
        </table>
      </div>
    </div>);

}

function LegendItem({ iconClass, label, text }) {
  return (
    <div className="rounded-[20px] border border-slate-200 bg-white/92 px-4 py-3 shadow-sm">
      <div className="flex items-start gap-3">
        <div className={`mt-1 h-9 w-9 rounded-2xl ${iconClass}`} />
        <div>
          <div className="text-sm font-semibold text-slate-800">{label}</div>
          <div className="mt-1 text-xs leading-5 text-slate-500">{text}</div>
        </div>
      </div>
    </div>);

}
