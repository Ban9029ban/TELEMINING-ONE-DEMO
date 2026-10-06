import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  ResponsiveContainer,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  Legend,
  Bar,
} from "recharts";
import { useSearchParams } from "react-router-dom";

import { API_URL } from "../../api-config";
import ConnectedVehiclesChart from "../../components/ConnectedVehiclesChart";
import PeoplePerLevelChart from "../../components/PeoplePerLevelChart";
import URStatusTable from "../../components/URStatusTable";
import VehiclePerLevelChart from "../../components/VehiclePerLevelChart";
import CameraAlertsChart from "../../components/grafics/CameraAlertsChart";
import CameraAlertFamiliesChart from "../../components/grafics/CameraAlertFamiliesChart";
import CameraAnalyticsCoverageChart from "../../components/grafics/CameraAnalyticsCoverageChart";
import CameraAvailabilityChart from "../../components/grafics/CameraAvailabilityChart";
import CameraModelCoverageChart from "../../components/grafics/CameraModelCoverageChart";
import CamerasInterpretationPanel from "../../components/grafics/CamerasInterpretationPanel";
import ClimateAnomaliesChart from "../../components/grafics/ClimateAnomaliesChart";
import ClimateBurnEventsSimChart from "../../components/grafics/ClimateBurnEventsSimChart";
import CrewProductiveTimeSimChart from "../../components/grafics/CrewProductiveTimeSimChart";
import TrackingInterpretationPanel from "../../components/grafics/TrackingInterpretationPanel";
import TransferTimesChart from "../../components/grafics/TransferTimesCharts";
import TruckLapsSimChart from "../../components/grafics/TruckLapsSimChart";
import URStayChart from "../../components/grafics/URStayChart";
import ProductivityMultiSelect from "../../components/productivity/ProductivityMultiSelect";
import { loadProductionModulePayload } from "../../services/productionModule";
import {
  FINDING_CATALOG,
  getModelCoveragePreset,
} from "../Cameras/analyticsCatalog";
import {
  buildHoursRowsFromTasks,
  buildHoursVarianceRows,
  buildOptions,
  buildPeoplePerLevelFromStayRows,
  buildPersonRoleMap,
  buildVehicleCategoryCounts,
  buildVehicleCategoryMap,
  buildVehiclesPerLevelFromStayRows,
  filterProductionTasks,
  filterStayRows,
  filterTransferRows,
} from "./productivityHelpers";
import {
  captureElementAsPng,
  downloadCsv,
  downloadDataUrl,
  slugifyFilename,
} from "../../utils/exportHelpers";

const TAB_ITEMS = [
  { id: "tracking", label: "Tracking" },
  { id: "access", label: "Acceso" },
  { id: "cameras", label: "Cámaras" },
  { id: "ambient", label: "Agentes ambientales" },
  { id: "noc", label: "NOC" },
  { id: "tactico", label: "Táctico" },
];

const TAB_SET = new Set(TAB_ITEMS.map((tab) => tab.id));
const DEFAULT_TAB = "tracking";
const NIVEL_OPTIONS = [
  { value: "", label: "Todos los niveles" },
  { value: "NP", label: "NP" },
  { value: "UCL", label: "UCL" },
  { value: "NTI", label: "NTI" },
];
const NIVEL_MULTI_OPTIONS = NIVEL_OPTIONS.filter((option) => option.value);
const NIVEL_NUMERIC_MAP = { NP: 1, UCL: 2, NTI: 3 };

function toDateInput(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function buildDefaultRange(days = 30) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - days);
  return { startDate: toDateInput(start), endDate: toDateInput(end) };
}

const ENVIRONMENTAL_PRESETS = {
  CO2: {
    label: "Gases (CO2)",
    unit: "ppm",
    defaultMin: "",
    defaultMax: "1200",
    anomaliesTitle: "Alertas de gases fuera de umbral",
    anomaliesSubtitle: "Lecturas de CO2 que superan el rango operativo esperado.",
    eventsTitle: "Eventos sostenidos de gases",
    eventsSubtitle: "Segmentos consecutivos sobre umbral para priorizar ventilacion y respuesta.",
    exportKey: "ambient_alertas_gases",
    eventsExportKey: "ambient_eventos_gases",
  },
  TEMP: {
    label: "Temperatura",
    unit: "C",
    defaultMin: "18",
    defaultMax: "27",
    anomaliesTitle: "Alertas de temperatura fuera de umbral",
    anomaliesSubtitle: "Lecturas que salen del rango termico esperado para la operacion.",
    eventsTitle: "Eventos sostenidos de temperatura",
    eventsSubtitle: "Segmentos consecutivos sobre umbral para detectar condiciones termicas persistentes.",
    exportKey: "ambient_alertas_temperatura",
    eventsExportKey: "ambient_eventos_temperatura",
  },
  WIND: {
    label: "Caudal de viento",
    unit: "m/s",
    defaultMin: "",
    defaultMax: "12",
    anomaliesTitle: "Alertas de viento fuera de umbral",
    anomaliesSubtitle: "Lecturas de viento que salen del rango de referencia configurado.",
    eventsTitle: "Eventos sostenidos de viento",
    eventsSubtitle: "Segmentos consecutivos con viento sobre umbral para seguimiento operacional.",
    exportKey: "ambient_alertas_viento",
    eventsExportKey: "ambient_eventos_viento",
  },
};

function getAuthHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function normalizeLevelMap(raw) {
  const result = {};

  if (!raw) return result;
  if (Array.isArray(raw)) {
    raw.forEach((item) => {
      if (!item) return;
      const nivel = item.nivel || item.level || item.NIVEL || item.Nivel || "SIN NIVEL";
      const value =
        typeof item.total === "number"
          ? item.total
          : typeof item.count === "number"
          ? item.count
          : typeof item.cantidad === "number"
          ? item.cantidad
          : typeof item.value === "number"
          ? item.value
          : 0;
      result[nivel] = (result[nivel] || 0) + (Number.isFinite(value) ? value : 0);
    });
    return result;
  }

  Object.entries(raw || {}).forEach(([nivel, value]) => {
    if (typeof value === "number") {
      result[nivel] = value;
      return;
    }
    if (value && typeof value === "object") {
      const nestedValue =
        typeof value.total === "number"
          ? value.total
          : typeof value.count === "number"
          ? value.count
          : typeof value.cantidad === "number"
          ? value.cantidad
          : typeof value.value === "number"
          ? value.value
          : Object.values(value).reduce(
              (sum, item) => sum + (typeof item === "number" && Number.isFinite(item) ? item : 0),
              0
            );
      result[nivel] = nestedValue;
    }
  });

  return result;
}

function buildPeopleRows(peoplePerLevel) {
  const defaults = ["NP", "UCL", "NTI", "OFICINA TELEMINING"];
  const levels = Array.from(new Set([...defaults, ...Object.keys(peoplePerLevel || {})]));
  return levels.map((nivel) => ({
    nivel,
    personas: Number(peoplePerLevel?.[nivel] || 0),
  }));
}

function buildVehicleRows(vehiclesPerLevel) {
  return Object.entries(vehiclesPerLevel || {}).flatMap(([nivel, tipos]) =>
    Object.entries(tipos || {}).map(([tipoVehiculo, cantidad]) => ({
      nivel,
      tipo_vehiculo: tipoVehiculo,
      cantidad: Number(cantidad || 0),
    }))
  );
}

function buildConnectedVehicleRows(vehicleStatus) {
  return Object.entries(vehicleStatus || {}).map(([estado, cantidad]) => ({
    estado,
    cantidad: Number(cantidad || 0),
  }));
}

function buildTrackingRelationRows(peopleData, vehiclesData) {
  const peopleMap = normalizeLevelMap(peopleData);
  const vehiclesMap = normalizeLevelMap(vehiclesData);
  const levels = Array.from(new Set([...Object.keys(peopleMap), ...Object.keys(vehiclesMap)]));
  return levels.map((nivel) => ({
    nivel,
    personas: Number(peopleMap[nivel] || 0),
    vehiculos: Number(vehiclesMap[nivel] || 0),
  }));
}

function buildCameraInterpretationRows(availability, alerts) {
  let online = 0;
  let offline = 0;
  let mantencion = 0;

  (availability || []).forEach((row) => {
    online += Number(row?.online || 0);
    offline += Number(row?.offline || 0);
    mantencion += Number(row?.mantenimiento || 0);
  });

  const totalAlerts = (alerts || []).reduce((sum, row) => sum + Number(row?.cantidad || 0), 0);
  return [
    { estado: "Online", cantidad: online },
    { estado: "Offline", cantidad: offline },
    { estado: "Mantencion", cantidad: mantencion },
    { estado: "Alertas", cantidad: totalAlerts },
  ];
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildCameraModelCoverageRows(models, videos) {
  const compatibleSources = Array.isArray(videos) ? videos.length : 0;

  return (models || [])
    .map((model) => {
      const preset = getModelCoveragePreset(model.code);
      return {
        modelo: model.name || model.code,
        modelo_corto: (model.name || model.code || "Modelo").slice(0, 20),
        codigo: model.code,
        foco: preset.focus,
        analiticas_en_vivo: preset.liveAnalyses,
        analiticas_pendientes: preset.pendingAnalyses,
        fuentes_compatibles: compatibleSources,
      };
    })
    .sort(
      (left, right) =>
        right.analiticas_en_vivo - left.analiticas_en_vivo ||
        right.analiticas_pendientes - left.analiticas_pendientes ||
        left.modelo.localeCompare(right.modelo)
    );
}

function resolveAlertCatalogMeta(tipo) {
  const normalizedType = normalizeText(tipo);
  if (!normalizedType) return null;

  return (
    FINDING_CATALOG.find((item) => normalizeText(item.label) === normalizedType) ||
    FINDING_CATALOG.find((item) => normalizedType.includes(normalizeText(item.label))) ||
    FINDING_CATALOG.find((item) => normalizeText(item.label).includes(normalizedType)) ||
    null
  );
}

function buildCameraAlertFamilyRows(alerts) {
  const grouped = new Map();

  (alerts || []).forEach((row) => {
    const amount = Number(row?.cantidad || 0);
    const meta = resolveAlertCatalogMeta(row?.tipo);
    const family = meta?.group || "Otras";
    const current = grouped.get(family) || {
      familia: family,
      total: 0,
      alto_riesgo: 0,
      medio_bajo: 0,
    };

    current.total += amount;
    if (meta?.severity === "high") current.alto_riesgo += amount;
    else current.medio_bajo += amount;

    grouped.set(family, current);
  });

  return Array.from(grouped.values()).sort(
    (left, right) => right.total - left.total || left.familia.localeCompare(right.familia)
  );
}

function buildCameraFindingGroupRows(summaryRows) {
  const grouped = new Map();

  (summaryRows || []).forEach((row) => {
    const key = row?.grupo || "General";
    const current = grouped.get(key) || {
      group: key,
      activos: 0,
      acumulados: 0,
    };

    current.activos += Number(row?.activos || 0);
    current.acumulados += Number(row?.acumulados || 0);
    grouped.set(key, current);
  });

  return Array.from(grouped.values()).sort(
    (left, right) => right.acumulados - left.acumulados || right.activos - left.activos
  );
}

function Panel({ title, subtitle, children, exportKey, csvRows = [] }) {
  const contentRef = useRef(null);
  const hasExports = Boolean(exportKey);
  const hasCsv = Array.isArray(csvRows) && csvRows.length > 0;

  const handleDownloadPng = async () => {
    const image = await captureElementAsPng(contentRef.current);
    if (!image) return;
    downloadDataUrl(`${slugifyFilename(exportKey || title)}.png`, image);
  };

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
      {(title || subtitle || hasExports) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            {title && <h3 className="text-lg font-semibold text-slate-900">{title}</h3>}
            {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          </div>
          {hasExports ? (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleDownloadPng}
                className="rounded-xl bg-indigo-500 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-600"
              >
                Exportar PNG
              </button>
              <button
                type="button"
                disabled={!hasCsv}
                onClick={() => downloadCsv(`${slugifyFilename(exportKey || title)}.csv`, csvRows)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Exportar CSV
              </button>
            </div>
          ) : null}
        </div>
      )}
      <div ref={contentRef}>{children}</div>
    </section>
  );
}

function ModuleTabs({ activeTab, onTabChange }) {
  return (
    <div className="mt-5 flex flex-wrap gap-2">
      {TAB_ITEMS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onTabChange(tab.id)}
          className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
            tab.id === activeTab
              ? "border-indigo-500 bg-indigo-500 text-white"
              : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function ProductivityShell({ activeTab, onTabChange, title, description, children }) {
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-slate-200 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.06)] overflow-hidden">
        <div className="grid gap-4 px-5 py-5 lg:grid-cols-[1.3fr_auto] lg:items-start">
          <div className="space-y-3">
            <div className="text-sm text-slate-500">{clock.toLocaleString("es-CL")}</div>
            <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
              LOCAL
            </span>
          </div>

          <div className="justify-self-end text-right text-sm text-slate-500">
            <div>Productividad TM One</div>
            <div>Módulos operacionales y analíticos disponibles</div>
          </div>
        </div>

        <div className="mx-5 mb-4 rounded-2xl bg-slate-700 px-4 py-3 text-sm text-white flex items-center justify-between gap-3">
          <span className="font-semibold">Ambiente: local</span>
          <span className="rounded-full bg-indigo-400/20 px-4 py-1 font-semibold text-indigo-100">
            Navegación por módulo
          </span>
          <span className="font-semibold">Semáforos: LIVE</span>
        </div>

        <div className="px-5 pb-5">
          <h2 className="text-[30px] font-semibold tracking-tight text-slate-900">{title}</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">{description}</p>
          <ModuleTabs activeTab={activeTab} onTabChange={onTabChange} />
        </div>
      </div>

      {children}
    </div>
  );
}

function FilterBar({ children }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-6">{children}</div>
    </div>
  );
}

function LabeledInput({ label, children }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </label>
      {children}
    </div>
  );
}

function SelectField({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={onChange}
      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function DateField({ label, value, onChange }) {
  return (
    <LabeledInput label={label}>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
      />
    </LabeledInput>
  );
}

function MultiSelectFilterField({ label, values, onChange, options, placeholder }) {
  return (
    <LabeledInput label={label}>
      <ProductivityMultiSelect
        value={values}
        onChange={onChange}
        options={options}
        placeholder={placeholder}
      />
    </LabeledInput>
  );
}

function countActiveFilterValues(filters, keys) {
  return keys.reduce((total, key) => {
    const value = filters?.[key];
    if (Array.isArray(value)) return total + value.length;
    return total + (value ? 1 : 0);
  }, 0);
}

function FilterActions({ loading, activeCount, onApply, onClear, idleMessage, loadingMessage }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={onApply}
        className="rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-600"
      >
        {loading ? "Actualizando..." : "Filtrar"}
      </button>
      <button
        type="button"
        onClick={onClear}
        className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        Limpiar filtros
      </button>
      <span className="text-sm text-slate-500">
        {loading ? loadingMessage : `${idleMessage}${activeCount ? ` · ${activeCount} filtro(s) activos` : ""}`}
      </span>
    </div>
  );
}

function HoursComparisonChart({
  rows,
  plannedColor = "#6ba142",
  targetColor = "#a3c97a",
  realColor = "#3b82f6",
}) {
  if (!rows.length) {
    return <div className="py-12 text-center text-sm text-slate-500">Sin datos para los filtros activos.</div>;
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" stroke="#dbe4f0" />
          <XAxis dataKey="label" />
          <YAxis />
          <RechartsTooltip
            formatter={(value, name) => [`${Number(value || 0).toFixed(1)} h`, name]}
          />
          <Legend />
          <Bar dataKey="plannedHours" name="TP" fill={plannedColor} radius={[8, 8, 0, 0]} />
          <Bar dataKey="targetHours" name="Meta TP" fill={targetColor} radius={[8, 8, 0, 0]} />
          <Bar dataKey="realHours" name="TR" fill={realColor} radius={[8, 8, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function HoursSummaryTable({ title, rows, labelHeader }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200/80 px-4 py-3 text-sm font-semibold text-slate-900">
        {title}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm text-slate-700">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            <tr>
              <th className="px-4 py-3">{labelHeader}</th>
              <th className="px-4 py-3">TP</th>
              <th className="px-4 py-3">TR</th>
              <th className="px-4 py-3">Meta TP</th>
              <th className="px-4 py-3">Delta</th>
              <th className="px-4 py-3">Tareas plan</th>
              <th className="px-4 py-3">Tareas real</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={`${labelHeader}-${row.label}`} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-semibold text-slate-900">{row.label}</td>
                  <td className="px-4 py-3">{row.plannedHours.toFixed(1)} h</td>
                  <td className="px-4 py-3">{row.realHours.toFixed(1)} h</td>
                  <td className="px-4 py-3">{row.targetHours.toFixed(1)} h</td>
                  <td className={`px-4 py-3 font-semibold ${row.varianceHours >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {row.varianceHours >= 0 ? "+" : ""}
                    {row.varianceHours.toFixed(1)} h
                  </td>
                  <td className="px-4 py-3">{row.plannedTasks}</td>
                  <td className="px-4 py-3">{row.realTasks}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  Sin filas para los filtros seleccionados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TrackingDashboard({ porticos, persons, vehicles }) {
  const range = buildDefaultRange(14);
  const defaultFilters = {
    startDate: range.startDate,
    endDate: range.endDate,
    levels: [],
    stayPorticoIds: [],
    fromPorticoIds: [],
    toPorticoIds: [],
    personIds: [],
    cargos: [],
    vehicleTypes: [],
  };

  const [filters, setFilters] = useState(defaultFilters);
  const [loading, setLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [staySourceRows, setStaySourceRows] = useState([]);
  const [transferSourceRows, setTransferSourceRows] = useState([]);
  const [zenitStatus, setZenitStatus] = useState({});

  const personRoleById = useMemo(() => buildPersonRoleMap(persons), [persons]);
  const vehicleCategoryById = useMemo(() => buildVehicleCategoryMap(vehicles), [vehicles]);
  const porticoLevelById = useMemo(
    () =>
      Object.fromEntries(
        (porticos || []).map((portico) => [String(portico.id), String(portico.nivel || "")])
      ),
    [porticos]
  );
  const filterContext = useMemo(
    () => ({ personRoleById, vehicleCategoryById, porticoLevelById }),
    [personRoleById, porticoLevelById, vehicleCategoryById]
  );

  const porticoOptions = useMemo(
    () =>
      buildOptions(
        porticos,
        (portico) => portico.id,
        (portico) => [portico.name, portico.nivel].filter(Boolean).join(" · ")
      ),
    [porticos]
  );

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [stayRes, transferRes, zenitRes] = await Promise.all([
          axios.get("/api/control/transfers/new-permanencias", {
            params: {
              start_date: filters.startDate,
              end_date: filters.endDate,
            },
          }),
          axios.get("/api/control/transfers/new-traslados", {
            params: {
              start_date: filters.startDate,
              end_date: filters.endDate,
            },
          }),
          axios.get(`${API_URL}/control/graphics/zenit-status`, {
            headers: getAuthHeaders(),
          }),
        ]);

        setStaySourceRows(Array.isArray(stayRes.data) ? stayRes.data : []);
        setTransferSourceRows(Array.isArray(transferRes.data) ? transferRes.data : []);
        setZenitStatus(zenitRes.data || {});
      } catch (error) {
        console.error("No se pudo cargar productividad Tracking:", error);
        setStaySourceRows([]);
        setTransferSourceRows([]);
        setZenitStatus({});
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [filters.endDate, filters.startDate, refreshTick]);

  const movementPersonIds = useMemo(() => {
    const ids = new Set();
    [...staySourceRows, ...transferSourceRows].forEach((row) => {
      if (String(row?.entity_type || "") === "person" && row?.entity_id != null) {
        ids.add(String(row.entity_id));
      }
    });
    return ids;
  }, [staySourceRows, transferSourceRows]);

  const movementVehicleIds = useMemo(() => {
    const ids = new Set();
    [...staySourceRows, ...transferSourceRows].forEach((row) => {
      if (String(row?.entity_type || "") === "vehicle" && row?.entity_id != null) {
        ids.add(String(row.entity_id));
      }
    });
    return ids;
  }, [staySourceRows, transferSourceRows]);

  const personOptions = useMemo(
    () =>
      buildOptions(
        (persons || []).filter((person) => movementPersonIds.has(String(person.id))),
        (person) => person.id,
        (person) => person.full_name
      ),
    [movementPersonIds, persons]
  );

  const cargoOptions = useMemo(
    () =>
      buildOptions(
        (persons || []).filter(
          (person) => movementPersonIds.has(String(person.id)) && String(person.role || "").trim()
        ),
        (person) => person.role,
        (person) => person.role
      ),
    [movementPersonIds, persons]
  );

  const vehicleTypeOptions = useMemo(
    () =>
      buildOptions(
        (vehicles || []).filter((vehicle) => movementVehicleIds.has(String(vehicle.id))),
        (vehicle) => vehicleCategoryById[String(vehicle.id)] || "Sin categoría",
        (vehicle) => vehicleCategoryById[String(vehicle.id)] || "Sin categoría"
      ),
    [movementVehicleIds, vehicleCategoryById, vehicles]
  );

  const filteredStayRows = useMemo(
    () => filterStayRows(staySourceRows, filters, filterContext),
    [filterContext, filters, staySourceRows]
  );
  const filteredTransferRows = useMemo(
    () => filterTransferRows(transferSourceRows, filters, filterContext),
    [filterContext, filters, transferSourceRows]
  );

  const peoplePerLevel = useMemo(
    () => buildPeoplePerLevelFromStayRows(filteredStayRows),
    [filteredStayRows]
  );
  const vehiclesPerLevel = useMemo(
    () => buildVehiclesPerLevelFromStayRows(filteredStayRows, vehicleCategoryById),
    [filteredStayRows, vehicleCategoryById]
  );
  const vehicleCategoryCounts = useMemo(
    () => buildVehicleCategoryCounts(filteredStayRows, vehicleCategoryById),
    [filteredStayRows, vehicleCategoryById]
  );

  const activeCount = countActiveFilterValues(filters, [
    "levels",
    "stayPorticoIds",
    "fromPorticoIds",
    "toPorticoIds",
    "personIds",
    "cargos",
    "vehicleTypes",
  ]);

  return (
    <div className="space-y-5">
      <FilterBar>
        <DateField
          label="Desde"
          value={filters.startDate}
          onChange={(value) => setFilters((current) => ({ ...current, startDate: value }))}
        />
        <DateField
          label="Hasta"
          value={filters.endDate}
          onChange={(value) => setFilters((current) => ({ ...current, endDate: value }))}
        />
        <MultiSelectFilterField
          label="Nivel"
          values={filters.levels}
          onChange={(values) => setFilters((current) => ({ ...current, levels: values }))}
          options={NIVEL_MULTI_OPTIONS}
          placeholder="Todos los niveles"
        />
        <MultiSelectFilterField
          label="Pórtico permanencia"
          values={filters.stayPorticoIds}
          onChange={(values) => setFilters((current) => ({ ...current, stayPorticoIds: values }))}
          options={porticoOptions}
          placeholder="Todos los pórticos"
        />
        <MultiSelectFilterField
          label="Pórtico origen"
          values={filters.fromPorticoIds}
          onChange={(values) => setFilters((current) => ({ ...current, fromPorticoIds: values }))}
          options={porticoOptions}
          placeholder="Todos"
        />
        <MultiSelectFilterField
          label="Pórtico destino"
          values={filters.toPorticoIds}
          onChange={(values) => setFilters((current) => ({ ...current, toPorticoIds: values }))}
          options={porticoOptions}
          placeholder="Todos"
        />
        <MultiSelectFilterField
          label="Persona"
          values={filters.personIds}
          onChange={(values) => setFilters((current) => ({ ...current, personIds: values }))}
          options={personOptions}
          placeholder="Todas las personas"
        />
        <MultiSelectFilterField
          label="Cargo"
          values={filters.cargos}
          onChange={(values) => setFilters((current) => ({ ...current, cargos: values }))}
          options={cargoOptions}
          placeholder="Todos los cargos"
        />
        <MultiSelectFilterField
          label="Tipo / estado vehiculo"
          values={filters.vehicleTypes}
          onChange={(values) => setFilters((current) => ({ ...current, vehicleTypes: values }))}
          options={vehicleTypeOptions}
          placeholder="Todas las categorías"
        />
      </FilterBar>

      <FilterActions
        loading={loading}
        activeCount={activeCount}
        onApply={() => setRefreshTick((current) => current + 1)}
        onClear={() => {
          const nextRange = buildDefaultRange(14);
          setFilters({
            ...defaultFilters,
            startDate: nextRange.startDate,
            endDate: nextRange.endDate,
          });
          setRefreshTick((current) => current + 1);
        }}
        idleMessage="Se filtra automaticamente al seleccionar opciones."
        loadingMessage="Actualizando lectura de tracking..."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="Personas por nivel"
          subtitle="Dotacion distinta que genero permanencias dentro del rango filtrado."
          exportKey="tracking_personas_por_nivel"
          csvRows={buildPeopleRows(peoplePerLevel)}
        >
          <PeoplePerLevelChart peoplePerLevel={peoplePerLevel} />
        </Panel>

        <Panel
          title="Vehiculos por nivel"
          subtitle="Distribución de vehículos observados por nivel y categoría operacional."
          exportKey="tracking_vehiculos_por_nivel"
          csvRows={buildVehicleRows(vehiclesPerLevel)}
        >
          <VehiclePerLevelChart vehiclesPerLevel={vehiclesPerLevel} />
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <Panel
          title="Vehículos observados por categoría"
          subtitle="Conteo único de vehículos con permanencias en la ventana seleccionada."
          exportKey="tracking_vehiculos_por_categoria"
          csvRows={buildConnectedVehicleRows(vehicleCategoryCounts)}
        >
          <ConnectedVehiclesChart
            vehicleStatus={vehicleCategoryCounts}
            title="Vehiculos observados"
            hideInternalTitle
          />
        </Panel>

        <Panel
          title="Resumen NOC"
          subtitle="Contexto general de sistema combinado con la relación filtrada entre personas y vehículos."
          exportKey="tracking_relacion_personas_vehiculos"
          csvRows={buildTrackingRelationRows(peoplePerLevel, vehiclesPerLevel)}
        >
          <div className="grid gap-3 md:grid-cols-3">
            {Object.entries(zenitStatus || {}).map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  {String(label).replace("?", "i")}
                </div>
                <div className="mt-2 text-3xl font-semibold text-slate-900">{value}</div>
              </div>
            ))}
          </div>
          <TrackingInterpretationPanel peopleData={peoplePerLevel} vehiclesData={vehiclesPerLevel} />
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="Traslados"
          subtitle="Eventos de traslado entre pórticos según origen, destino y tipo de entidad filtrada."
          exportKey="tracking_traslados"
          csvRows={filteredTransferRows}
        >
          <TransferTimesChart rows={filteredTransferRows} embedded />
        </Panel>

        <Panel
          title="Permanencias"
          subtitle="Duración observada por entidad en el rango activo, afinada por pórtico, persona, cargo y categoría vehicular."
          exportKey="tracking_permanencias"
          csvRows={filteredStayRows}
        >
          <URStayChart rows={filteredStayRows} embedded />
        </Panel>
      </div>
    </div>
  );
}

function AccessDashboard({ porticos, persons, vehicles }) {
  const range = buildDefaultRange(7);
  const defaultFilters = {
    startDate: range.startDate,
    endDate: range.endDate,
    levels: [],
    stayPorticoIds: [],
    fromPorticoIds: [],
    toPorticoIds: [],
    personIds: [],
    cargos: [],
    vehicleTypes: [],
  };

  const [filters, setFilters] = useState(defaultFilters);
  const [loading, setLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [staySourceRows, setStaySourceRows] = useState([]);
  const [transferSourceRows, setTransferSourceRows] = useState([]);
  const [lapsRows, setLapsRows] = useState([]);

  const personRoleById = useMemo(() => buildPersonRoleMap(persons), [persons]);
  const vehicleCategoryById = useMemo(() => buildVehicleCategoryMap(vehicles), [vehicles]);
  const porticoLevelById = useMemo(
    () =>
      Object.fromEntries(
        (porticos || []).map((portico) => [String(portico.id), String(portico.nivel || "")])
      ),
    [porticos]
  );
  const filterContext = useMemo(
    () => ({ personRoleById, vehicleCategoryById, porticoLevelById }),
    [personRoleById, porticoLevelById, vehicleCategoryById]
  );

  const porticoOptions = useMemo(
    () =>
      buildOptions(
        porticos,
        (portico) => portico.id,
        (portico) => [portico.name, portico.nivel].filter(Boolean).join(" · ")
      ),
    [porticos]
  );

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [stayRes, transferRes] = await Promise.all([
          axios.get("/api/control/transfers/new-permanencias", {
            params: {
              start_date: filters.startDate,
              end_date: filters.endDate,
            },
          }),
          axios.get("/api/control/transfers/new-traslados", {
            params: {
              start_date: filters.startDate,
              end_date: filters.endDate,
            },
          }),
        ]);

        setStaySourceRows(Array.isArray(stayRes.data) ? stayRes.data : []);
        setTransferSourceRows(Array.isArray(transferRes.data) ? transferRes.data : []);
      } catch (error) {
        console.error("No se pudo cargar productividad Acceso:", error);
        setStaySourceRows([]);
        setTransferSourceRows([]);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [filters.endDate, filters.startDate, refreshTick]);

  const movementPersonIds = useMemo(() => {
    const ids = new Set();
    [...staySourceRows, ...transferSourceRows].forEach((row) => {
      if (String(row?.entity_type || "") === "person" && row?.entity_id != null) {
        ids.add(String(row.entity_id));
      }
    });
    return ids;
  }, [staySourceRows, transferSourceRows]);

  const movementVehicleIds = useMemo(() => {
    const ids = new Set();
    [...staySourceRows, ...transferSourceRows].forEach((row) => {
      if (String(row?.entity_type || "") === "vehicle" && row?.entity_id != null) {
        ids.add(String(row.entity_id));
      }
    });
    return ids;
  }, [staySourceRows, transferSourceRows]);

  const personOptions = useMemo(
    () =>
      buildOptions(
        (persons || []).filter((person) => movementPersonIds.has(String(person.id))),
        (person) => person.id,
        (person) => person.full_name
      ),
    [movementPersonIds, persons]
  );

  const cargoOptions = useMemo(
    () =>
      buildOptions(
        (persons || []).filter(
          (person) => movementPersonIds.has(String(person.id)) && String(person.role || "").trim()
        ),
        (person) => person.role,
        (person) => person.role
      ),
    [movementPersonIds, persons]
  );

  const vehicleTypeOptions = useMemo(
    () =>
      buildOptions(
        (vehicles || []).filter((vehicle) => movementVehicleIds.has(String(vehicle.id))),
        (vehicle) => vehicleCategoryById[String(vehicle.id)] || "Sin categoría",
        (vehicle) => vehicleCategoryById[String(vehicle.id)] || "Sin categoría"
      ),
    [movementVehicleIds, vehicleCategoryById, vehicles]
  );

  const filteredStayRows = useMemo(
    () => filterStayRows(staySourceRows, filters, filterContext),
    [filterContext, filters, staySourceRows]
  );
  const filteredTransferRows = useMemo(
    () => filterTransferRows(transferSourceRows, filters, filterContext),
    [filterContext, filters, transferSourceRows]
  );

  const activeCount = countActiveFilterValues(filters, [
    "levels",
    "stayPorticoIds",
    "fromPorticoIds",
    "toPorticoIds",
    "personIds",
    "cargos",
    "vehicleTypes",
  ]);

  return (
    <div className="space-y-5">
      <FilterBar>
        <DateField
          label="Desde"
          value={filters.startDate}
          onChange={(value) => setFilters((current) => ({ ...current, startDate: value }))}
        />
        <DateField
          label="Hasta"
          value={filters.endDate}
          onChange={(value) => setFilters((current) => ({ ...current, endDate: value }))}
        />
        <MultiSelectFilterField
          label="Nivel"
          values={filters.levels}
          onChange={(values) => setFilters((current) => ({ ...current, levels: values }))}
          options={NIVEL_MULTI_OPTIONS}
          placeholder="Todos los niveles"
        />
        <MultiSelectFilterField
          label="Pórtico permanencia"
          values={filters.stayPorticoIds}
          onChange={(values) => setFilters((current) => ({ ...current, stayPorticoIds: values }))}
          options={porticoOptions}
          placeholder="Todos los pórticos"
        />
        <MultiSelectFilterField
          label="Pórtico origen"
          values={filters.fromPorticoIds}
          onChange={(values) => setFilters((current) => ({ ...current, fromPorticoIds: values }))}
          options={porticoOptions}
          placeholder="Todos"
        />
        <MultiSelectFilterField
          label="Pórtico destino"
          values={filters.toPorticoIds}
          onChange={(values) => setFilters((current) => ({ ...current, toPorticoIds: values }))}
          options={porticoOptions}
          placeholder="Todos"
        />
        <MultiSelectFilterField
          label="Persona"
          values={filters.personIds}
          onChange={(values) => setFilters((current) => ({ ...current, personIds: values }))}
          options={personOptions}
          placeholder="Todas las personas"
        />
        <MultiSelectFilterField
          label="Cargo"
          values={filters.cargos}
          onChange={(values) => setFilters((current) => ({ ...current, cargos: values }))}
          options={cargoOptions}
          placeholder="Todos los cargos"
        />
        <MultiSelectFilterField
          label="Tipo / estado vehiculo"
          values={filters.vehicleTypes}
          onChange={(values) => setFilters((current) => ({ ...current, vehicleTypes: values }))}
          options={vehicleTypeOptions}
          placeholder="Todas las categorías"
        />
      </FilterBar>

      <FilterActions
        loading={loading}
        activeCount={activeCount}
        onApply={() => setRefreshTick((current) => current + 1)}
        onClear={() => {
          const nextRange = buildDefaultRange(7);
          setFilters({
            ...defaultFilters,
            startDate: nextRange.startDate,
            endDate: nextRange.endDate,
          });
          setRefreshTick((current) => current + 1);
        }}
        idleMessage="Los selectores multiple aplican la lectura apenas cambian."
        loadingMessage="Actualizando productividad de acceso..."
      />

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel
          title="Traslados entre pórticos"
          subtitle="Duración de movimientos detectados según origen, destino, persona, cargo y categoría vehicular."
          exportKey="access_traslados"
          csvRows={filteredTransferRows}
        >
          <TransferTimesChart rows={filteredTransferRows} embedded />
        </Panel>

        <Panel
          title="Permanencias por pórtico"
          subtitle="Tiempo observado dentro de cada pórtico, afinado por nivel y filtros operacionales."
          exportKey="access_permanencias"
          csvRows={filteredStayRows}
        >
          <URStayChart rows={filteredStayRows} embedded />
        </Panel>
      </div>

      <Panel
        title="Vueltas por vehiculo"
        subtitle="Conteo real de lecturas por vehículo en los pórticos filtrados. Usa nivel y tipo/estado vehicular."
        exportKey="access_vueltas_por_vehiculo"
        csvRows={lapsRows}
      >
        <TruckLapsSimChart
          startDate={filters.startDate}
          endDate={filters.endDate}
          niveles={filters.levels}
          fromPorticoIds={filters.fromPorticoIds}
          toPorticoIds={filters.toPorticoIds}
          vehicleCategories={filters.vehicleTypes}
          vehicleCategoryById={vehicleCategoryById}
          embedded
          onExportDataChange={setLapsRows}
        />
      </Panel>
    </div>
  );
}

function CamerasDashboard() {
  const range = buildDefaultRange(14);
  const defaultFilters = {
    startDate: range.startDate,
    endDate: range.endDate,
    levels: [],
    families: [],
    alertTypes: [],
    findingGroups: [],
  };

  const [filters, setFilters] = useState(defaultFilters);
  const [loading, setLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [availability, setAvailability] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [findingSummary, setFindingSummary] = useState([]);
  const [cameraModels, setCameraModels] = useState([]);
  const [cameraSources, setCameraSources] = useState([]);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const headers = getAuthHeaders();
        const levelValues = filters.levels.length ? filters.levels : [null];

        const requests = await Promise.all(
          levelValues.map(async (level) => {
            const params = {
              start_date: filters.startDate,
              end_date: filters.endDate,
              nivel: level ? NIVEL_NUMERIC_MAP[level] : undefined,
            };

            const [availabilityRes, alertsRes, summaryRes] = await Promise.all([
              axios.get(`${API_URL}/control/graphics/tactical/camera-availability`, { headers, params }),
              axios.get(`${API_URL}/control/graphics/tactical/camera-alerts`, { headers, params }),
              axios.get(`${API_URL}/control/graphics/tactical/camera-finding-summary`, { headers, params }),
            ]);

            return {
              availability: Array.isArray(availabilityRes.data) ? availabilityRes.data : [],
              alerts: Array.isArray(alertsRes.data) ? alertsRes.data : [],
              summary: Array.isArray(summaryRes.data) ? summaryRes.data : [],
            };
          })
        );

        const configRes = await axios.get(`${API_URL}/cameras/config`, { headers });

        const availabilityMap = new Map();
        const alertsMap = new Map();
        const summaryMap = new Map();

        requests.forEach((payload) => {
          (payload.availability || []).forEach((row) => {
            const key = row.nivel || "SIN NIVEL";
            const current = availabilityMap.get(key) || {
              nivel: key,
              online: 0,
              offline: 0,
              mantenimiento: 0,
            };
            current.online += Number(row.online || 0);
            current.offline += Number(row.offline || 0);
            current.mantenimiento += Number(row.mantenimiento || 0);
            availabilityMap.set(key, current);
          });

          (payload.alerts || []).forEach((row) => {
            const key = row.tipo || "Sin tipo";
            const current = alertsMap.get(key) || { tipo: key, cantidad: 0 };
            current.cantidad += Number(row.cantidad || 0);
            alertsMap.set(key, current);
          });

          (payload.summary || []).forEach((row) => {
            const key = `${row.code || ""}-${row.grupo || ""}-${row.hallazgo || ""}`;
            const current = summaryMap.get(key) || {
              ...row,
              activos: 0,
              acumulados: 0,
            };
            current.activos += Number(row.activos || 0);
            current.acumulados += Number(row.acumulados || 0);
            summaryMap.set(key, current);
          });
        });

        setAvailability(Array.from(availabilityMap.values()));
        setAlerts(Array.from(alertsMap.values()));
        setFindingSummary(Array.from(summaryMap.values()));
        setCameraModels(Array.isArray(configRes.data?.models) ? configRes.data.models : []);
        setCameraSources(Array.isArray(configRes.data?.videos) ? configRes.data.videos : []);
      } catch (error) {
        console.error("No se pudo cargar productividad Cámaras:", error);
        setAvailability([]);
        setAlerts([]);
        setFindingSummary([]);
        setCameraModels([]);
        setCameraSources([]);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [filters.endDate, filters.levels, filters.startDate, refreshTick]);

  const familyOptions = useMemo(
    () =>
      buildOptions(
        buildCameraAlertFamilyRows(alerts),
        (row) => row.familia,
        (row) => row.familia
      ),
    [alerts]
  );

  const alertTypeOptions = useMemo(
    () => buildOptions(alerts, (row) => row.tipo, (row) => row.tipo),
    [alerts]
  );

  const findingGroupOptions = useMemo(
    () => buildOptions(findingSummary, (row) => row.grupo, (row) => row.grupo),
    [findingSummary]
  );

  const filteredAlerts = useMemo(
    () =>
      (alerts || []).filter((row) => {
        const family = resolveAlertCatalogMeta(row?.tipo)?.group || "Otras";
        if (filters.families.length && !filters.families.includes(family)) return false;
        if (filters.alertTypes.length && !filters.alertTypes.includes(String(row?.tipo || ""))) return false;
        return true;
      }),
    [alerts, filters.alertTypes, filters.families]
  );

  const filteredFindingSummary = useMemo(
    () =>
      (findingSummary || []).filter((row) => {
        if (filters.findingGroups.length && !filters.findingGroups.includes(String(row?.grupo || ""))) {
          return false;
        }
        return true;
      }),
    [filters.findingGroups, findingSummary]
  );

  const modelCoverageRows = useMemo(
    () => buildCameraModelCoverageRows(cameraModels, cameraSources),
    [cameraModels, cameraSources]
  );
  const analyticsCoverageRows = useMemo(
    () => buildCameraFindingGroupRows(filteredFindingSummary),
    [filteredFindingSummary]
  );
  const alertFamilyRows = useMemo(
    () => buildCameraAlertFamilyRows(filteredAlerts),
    [filteredAlerts]
  );

  const activeCount = countActiveFilterValues(filters, [
    "levels",
    "families",
    "alertTypes",
    "findingGroups",
  ]);

  return (
    <div className="space-y-5">
      <FilterBar>
        <DateField
          label="Desde"
          value={filters.startDate}
          onChange={(value) => setFilters((current) => ({ ...current, startDate: value }))}
        />
        <DateField
          label="Hasta"
          value={filters.endDate}
          onChange={(value) => setFilters((current) => ({ ...current, endDate: value }))}
        />
        <MultiSelectFilterField
          label="Nivel"
          values={filters.levels}
          onChange={(values) => setFilters((current) => ({ ...current, levels: values }))}
          options={NIVEL_MULTI_OPTIONS}
          placeholder="Todos los niveles"
        />
        <MultiSelectFilterField
          label="Familia analítica"
          values={filters.families}
          onChange={(values) => setFilters((current) => ({ ...current, families: values }))}
          options={familyOptions}
          placeholder="Todas las familias"
        />
        <MultiSelectFilterField
          label="Tipo alerta"
          values={filters.alertTypes}
          onChange={(values) => setFilters((current) => ({ ...current, alertTypes: values }))}
          options={alertTypeOptions}
          placeholder="Todos los tipos"
        />
        <MultiSelectFilterField
          label="Grupo operativo"
          values={filters.findingGroups}
          onChange={(values) => setFilters((current) => ({ ...current, findingGroups: values }))}
          options={findingGroupOptions}
          placeholder="Todos los grupos"
        />
      </FilterBar>

      <FilterActions
        loading={loading}
        activeCount={activeCount}
        onApply={() => setRefreshTick((current) => current + 1)}
        onClear={() => {
          const nextRange = buildDefaultRange(14);
          setFilters({
            ...defaultFilters,
            startDate: nextRange.startDate,
            endDate: nextRange.endDate,
          });
          setRefreshTick((current) => current + 1);
        }}
        idleMessage="Las familias analíticas y grupos afinan la lectura de alertas y hallazgos."
        loadingMessage="Actualizando productividad de camaras..."
      />

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel
          title="Disponibilidad CCTV"
          subtitle="Estado de camaras online, offline y en mantencion por nivel."
          exportKey="cameras_disponibilidad"
          csvRows={availability}
        >
          <CameraAvailabilityChart data={availability} />
        </Panel>

        <Panel
          title="Alertas de analítica"
          subtitle="Conteo de alertas registradas en el rango activo, afinado por familia y tipo."
          exportKey="cameras_alertas"
          csvRows={filteredAlerts}
        >
          <CameraAlertsChart data={filteredAlerts} />
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel
          title="Cobertura IA por modelo"
          subtitle="Modelos configurados y cantidad de analíticas en vivo o pendientes que hoy cubren."
          exportKey="cameras_modelos_ia"
          csvRows={modelCoverageRows}
        >
          <CameraModelCoverageChart data={modelCoverageRows} />
        </Panel>

        <Panel
          title="Alertas por familia analítica"
          subtitle="Agrupacion de alertas segun familias EPP, peatonal, interaccion u otras."
          exportKey="cameras_alertas_por_familia"
          csvRows={alertFamilyRows}
        >
          <CameraAlertFamiliesChart data={alertFamilyRows} />
        </Panel>
      </div>

      <Panel
        title="Hallazgos por grupo operativo"
        subtitle="Lectura persistida de activos y acumulados por familia operacional segun snapshots de camaras."
        exportKey="cameras_catalogo_analiticas"
        csvRows={analyticsCoverageRows}
      >
        <CameraAnalyticsCoverageChart data={analyticsCoverageRows} />
      </Panel>

      <Panel
        title="Interpretacion operacional"
        subtitle="Cobertura global CCTV y volumen de alertas para priorizar acciones."
        exportKey="cameras_interpretacion"
        csvRows={buildCameraInterpretationRows(availability, filteredAlerts)}
      >
        <CamerasInterpretationPanel availability={availability} alerts={filteredAlerts} />
      </Panel>
    </div>
  );
}

function EnvironmentalDashboard({ porticos }) {
  const range = buildDefaultRange(7);
  const [startDate, setStartDate] = useState(range.startDate);
  const [endDate, setEndDate] = useState(range.endDate);
  const [nivel, setNivel] = useState("");
  const [porticoId, setPorticoId] = useState("");
  const [varCode, setVarCode] = useState("CO2");
  const [minValue, setMinValue] = useState(ENVIRONMENTAL_PRESETS.CO2.defaultMin);
  const [maxValue, setMaxValue] = useState(ENVIRONMENTAL_PRESETS.CO2.defaultMax);
  const [anomalyRows, setAnomalyRows] = useState([]);
  const [burnRows, setBurnRows] = useState([]);
  const preset = ENVIRONMENTAL_PRESETS[varCode] || ENVIRONMENTAL_PRESETS.CO2;

  useEffect(() => {
    setMinValue(preset.defaultMin);
    setMaxValue(preset.defaultMax);
  }, [preset.defaultMax, preset.defaultMin]);

  return (
    <div className="space-y-5">
      <FilterBar>
        <LabeledInput label="Desde">
          <input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
          />
        </LabeledInput>

        <LabeledInput label="Hasta">
          <input
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
          />
        </LabeledInput>

        <LabeledInput label="Nivel">
          <SelectField
            value={nivel}
            onChange={(event) => setNivel(event.target.value)}
            options={NIVEL_OPTIONS}
          />
        </LabeledInput>

        <LabeledInput label="Pórtico">
          <select
            value={porticoId}
            onChange={(event) => setPorticoId(event.target.value)}
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
          >
            <option value="">Todos los pórticos</option>
            {porticos.map((portico) => (
              <option key={portico.id} value={portico.id}>
                {portico.name}
              </option>
            ))}
          </select>
        </LabeledInput>

        <LabeledInput label="Variable">
          <select
            value={varCode}
            onChange={(event) => setVarCode(event.target.value)}
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
          >
            {Object.entries(ENVIRONMENTAL_PRESETS).map(([code, config]) => (
              <option key={code} value={code}>
                {config.label}
              </option>
            ))}
          </select>
        </LabeledInput>
      </FilterBar>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Umbral minimo" subtitle="Opcional para alertas fuera de rango.">
          <input
            type="number"
            value={minValue}
            onChange={(event) => setMinValue(event.target.value)}
            placeholder="Sin minimo"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
          />
        </Panel>

        <Panel title="Umbral maximo" subtitle={`Referencia superior para ${preset.label.toLowerCase()}.`}>
          <input
            type="number"
            value={maxValue}
            onChange={(event) => setMaxValue(event.target.value)}
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
          />
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel
          title={preset.anomaliesTitle}
          subtitle={preset.anomaliesSubtitle}
          exportKey={preset.exportKey}
          csvRows={anomalyRows}
        >
          <ClimateAnomaliesChart
            startDate={startDate}
            endDate={endDate}
            nivel={nivel}
            porticoId={porticoId}
            varCode={varCode}
            seriesLabel={preset.label}
            unit={preset.unit}
            minValue={minValue === "" ? null : Number(minValue)}
            maxValue={maxValue === "" ? null : Number(maxValue)}
            onExportDataChange={setAnomalyRows}
          />
        </Panel>

        <Panel
          title={preset.eventsTitle}
          subtitle={preset.eventsSubtitle}
          exportKey={preset.eventsExportKey}
          csvRows={burnRows}
        >
          <ClimateBurnEventsSimChart
            startDate={startDate}
            endDate={endDate}
            nivel={nivel}
            porticoId={porticoId}
            varCode={varCode}
            seriesLabel={preset.label}
            unit={preset.unit}
            threshold={maxValue === "" ? Number(preset.defaultMax || 0) : Number(maxValue)}
            onExportDataChange={setBurnRows}
          />
        </Panel>
      </div>
    </div>
  );
}

function NocDashboard() {
  const [loading, setLoading] = useState(false);
  const [vehicleStatus, setVehicleStatus] = useState({});
  const [zenitStatus, setZenitStatus] = useState({});

  const loadData = async () => {
    try {
      setLoading(true);
      const headers = getAuthHeaders();
      const [vehicleStatusRes, zenitRes] = await Promise.all([
        axios.get(`${API_URL}/control/graphics/vehicle-status`, { headers }),
        axios.get(`${API_URL}/control/graphics/zenit-status`, { headers }),
      ]);
      setVehicleStatus(vehicleStatusRes.data || {});
      setZenitStatus(zenitRes.data || {});
    } catch (error) {
      console.error("No se pudo cargar productividad NOC:", error);
      setVehicleStatus({});
      setZenitStatus({});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, 45000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between rounded-3xl border border-slate-200 bg-white px-5 py-4 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Centro de operacion</h3>
          <p className="text-sm text-slate-500">
            Vista resumida de salud de sistema, conectividad y estado de URs.
          </p>
        </div>
        <button
          type="button"
          onClick={loadData}
          className="rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-600"
        >
          {loading ? "Actualizando..." : "Actualizar"}
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {Object.entries(zenitStatus || {}).map(([label, value]) => (
          <div key={label} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              {String(label).replace("?", "i")}
            </div>
            <div className="mt-2 text-4xl font-semibold text-slate-900">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <Panel
          title="Conectividad de vehículos"
          subtitle="Lectura de ultima ventana para detectar flota sin datos."
          exportKey="noc_conectividad_vehiculos"
          csvRows={buildConnectedVehicleRows(vehicleStatus)}
        >
          <ConnectedVehiclesChart vehicleStatus={vehicleStatus || {}} />
        </Panel>

        <Panel title="Estado actual de URs" subtitle="Lectura operacional publicada por el módulo de visualización.">
          <URStatusTable />
        </Panel>
      </div>
    </div>
  );
}

function TacticalDashboard({ porticos, persons, vehicles, productionPayload }) {
  const range = buildDefaultRange(14);
  const defaultFilters = {
    startDate: range.startDate,
    endDate: range.endDate,
    levels: [],
    porticoIds: [],
    crews: [],
    equipments: [],
    personIds: [],
    cargos: [],
    vehicleTypes: [],
  };

  const [filters, setFilters] = useState(defaultFilters);
  const [loading, setLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [lapsRows, setLapsRows] = useState([]);

  const personRoleById = useMemo(() => buildPersonRoleMap(persons), [persons]);
  const vehicleCategoryById = useMemo(() => buildVehicleCategoryMap(vehicles), [vehicles]);
  const filterContext = useMemo(
    () => ({ personRoleById, vehicleCategoryById }),
    [personRoleById, vehicleCategoryById]
  );

  const porticoOptions = useMemo(
    () =>
      buildOptions(
        porticos,
        (portico) => portico.id,
        (portico) => [portico.name, portico.nivel].filter(Boolean).join(" · ")
      ),
    [porticos]
  );

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
      } catch (error) {
        console.error("No se pudo cargar productividad Tactico:", error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [filters.endDate, filters.startDate, refreshTick]);

  const productionTasks = useMemo(
    () => productionPayload?.schedule?.controlMineria || [],
    [productionPayload]
  );

  const crewOptions = useMemo(
    () =>
      buildOptions(
        productionTasks.flatMap((task) => [task?.crewPlanned, task?.crewReal].filter(Boolean)),
        (value) => value,
        (value) => value
      ),
    [productionTasks]
  );

  const equipmentOptions = useMemo(
    () =>
      buildOptions(
        productionTasks.flatMap((task) => [task?.equipmentPlanned, task?.equipmentReal].filter(Boolean)),
        (value) => value,
        (value) => value
      ),
    [productionTasks]
  );

  const taskPersonIds = useMemo(() => {
    const ids = new Set();
    productionTasks.forEach((task) => {
      (task?.linkedPeople || []).forEach((person) => {
        if (person?.id != null) ids.add(String(person.id));
      });
    });
    return ids;
  }, [productionTasks]);

  const taskVehicleIds = useMemo(() => {
    const ids = new Set();
    productionTasks.forEach((task) => {
      (task?.linkedVehicles || []).forEach((vehicle) => {
        if (vehicle?.id != null) ids.add(String(vehicle.id));
      });
    });
    return ids;
  }, [productionTasks]);

  const personOptions = useMemo(
    () =>
      buildOptions(
        (persons || []).filter((person) => taskPersonIds.has(String(person.id))),
        (person) => person.id,
        (person) => person.full_name
      ),
    [persons, taskPersonIds]
  );

  const cargoOptions = useMemo(() => {
    const seedCargos = productionPayload?.referenceData?.cnc?.cargosMineria || [];
    return buildOptions(
      [
        ...(persons || []).filter((person) => taskPersonIds.has(String(person.id))),
        ...seedCargos.map((role) => ({ role })),
        ...productionTasks.flatMap((task) => (task?.roles || []).map((role) => ({ role }))),
      ],
      (item) => item.role,
      (item) => item.role
    );
  }, [persons, productionPayload, productionTasks, taskPersonIds]);

  const vehicleTypeOptions = useMemo(
    () =>
      buildOptions(
        (vehicles || []).filter((vehicle) => taskVehicleIds.has(String(vehicle.id))),
        (vehicle) => vehicleCategoryById[String(vehicle.id)] || "Sin categoría",
        (vehicle) => vehicleCategoryById[String(vehicle.id)] || "Sin categoría"
      ),
    [taskVehicleIds, vehicleCategoryById, vehicles]
  );

  const filteredProductionTasks = useMemo(
    () => filterProductionTasks(productionTasks, filters, filterContext),
    [filterContext, filters, productionTasks]
  );

  const hoursRows = useMemo(
    () => buildHoursRowsFromTasks(filteredProductionTasks),
    [filteredProductionTasks]
  );
  const crewRows = useMemo(
    () => buildHoursVarianceRows(hoursRows.crew),
    [hoursRows.crew]
  );
  const equipmentRows = useMemo(
    () => buildHoursVarianceRows(hoursRows.equipment),
    [hoursRows.equipment]
  );

  const activeCount = countActiveFilterValues(filters, [
    "levels",
    "porticoIds",
    "crews",
    "equipments",
    "personIds",
    "cargos",
    "vehicleTypes",
  ]);

  return (
    <div className="space-y-5">
      <FilterBar>
        <DateField
          label="Desde"
          value={filters.startDate}
          onChange={(value) => setFilters((current) => ({ ...current, startDate: value }))}
        />
        <DateField
          label="Hasta"
          value={filters.endDate}
          onChange={(value) => setFilters((current) => ({ ...current, endDate: value }))}
        />
        <MultiSelectFilterField
          label="Nivel"
          values={filters.levels}
          onChange={(values) => setFilters((current) => ({ ...current, levels: values }))}
          options={NIVEL_MULTI_OPTIONS}
          placeholder="Todos los niveles"
        />
        <MultiSelectFilterField
          label="Pórtico"
          values={filters.porticoIds}
          onChange={(values) => setFilters((current) => ({ ...current, porticoIds: values }))}
          options={porticoOptions}
          placeholder="Todos los pórticos"
        />
        <MultiSelectFilterField
          label="Cuadrilla"
          values={filters.crews}
          onChange={(values) => setFilters((current) => ({ ...current, crews: values }))}
          options={crewOptions}
          placeholder="Todas las cuadrillas"
        />
        <MultiSelectFilterField
          label="Equipo"
          values={filters.equipments}
          onChange={(values) => setFilters((current) => ({ ...current, equipments: values }))}
          options={equipmentOptions}
          placeholder="Todos los equipos"
        />
        <MultiSelectFilterField
          label="Persona"
          values={filters.personIds}
          onChange={(values) => setFilters((current) => ({ ...current, personIds: values }))}
          options={personOptions}
          placeholder="Todas las personas"
        />
        <MultiSelectFilterField
          label="Cargo"
          values={filters.cargos}
          onChange={(values) => setFilters((current) => ({ ...current, cargos: values }))}
          options={cargoOptions}
          placeholder="Todos los cargos"
        />
        <MultiSelectFilterField
          label="Tipo / estado vehiculo"
          values={filters.vehicleTypes}
          onChange={(values) => setFilters((current) => ({ ...current, vehicleTypes: values }))}
          options={vehicleTypeOptions}
          placeholder="Todas las categorías"
        />
      </FilterBar>

      <FilterActions
        loading={loading}
        activeCount={activeCount}
        onApply={() => setRefreshTick((current) => current + 1)}
        onClear={() => {
          const nextRange = buildDefaultRange(14);
          setFilters({
            ...defaultFilters,
            startDate: nextRange.startDate,
            endDate: nextRange.endDate,
          });
          setRefreshTick((current) => current + 1);
        }}
        idleMessage="La vista táctica analiza horas de minería y uso de equipos del módulo de Producción."
        loadingMessage="Actualizando tablero táctico..."
      />

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel
          title="Tiempo productivo de cuadrillas"
          subtitle="Ahora usa directamente las tareas de Horas minería del módulo de Producción, con TP, TR y meta."
          exportKey="tactico_tiempo_productivo_cuadrillas"
          csvRows={crewRows}
        >
          <CrewProductiveTimeSimChart rows={crewRows} embedded />
        </Panel>

        <Panel
          title="Tiempo por equipo"
          subtitle="Comparativo equivalente al tablero de Horas minería para leer uso planificado vs real."
          exportKey="tactico_tiempo_productivo_equipos"
          csvRows={equipmentRows}
        >
          <HoursComparisonChart
            rows={equipmentRows}
            plannedColor="#f5822c"
            targetColor="#f7b16d"
            realColor="#fb923c"
          />
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <HoursSummaryTable title="Horas por cuadrilla" rows={crewRows} labelHeader="Cuadrilla" />
        <HoursSummaryTable title="Horas por equipo" rows={equipmentRows} labelHeader="Equipo" />
      </div>

      <Panel
        title="Vueltas tácticas por vehículo"
        subtitle="Lecturas acumuladas por equipo móvil en los pórticos filtrados. Usa nivel y categoría vehicular."
        exportKey="tactico_vueltas_por_vehiculo"
        csvRows={lapsRows}
      >
        <TruckLapsSimChart
          startDate={filters.startDate}
          endDate={filters.endDate}
          niveles={filters.levels}
          fromPorticoIds={filters.porticoIds}
          vehicleCategories={filters.vehicleTypes}
          vehicleCategoryById={vehicleCategoryById}
          embedded
          onExportDataChange={setLapsRows}
        />
      </Panel>
    </div>
  );
}

export default function ChartsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [porticos, setPorticos] = useState([]);
  const [persons, setPersons] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [productionPayload, setProductionPayload] = useState(null);
  const tabParam = searchParams.get("tab");
  const activeTab = tabParam && TAB_SET.has(tabParam) ? tabParam : DEFAULT_TAB;

  useEffect(() => {
    const loadContext = async () => {
      try {
        const headers = getAuthHeaders();
        const [porticosRes, personsRes, vehiclesRes, productionRes] = await Promise.all([
          axios.get(`${API_URL}/access/porticos`),
          axios.get(`${API_URL}/config/persons`, { headers }),
          axios.get(`${API_URL}/config/vehicles`, { headers }),
          loadProductionModulePayload(),
        ]);

        setPorticos(Array.isArray(porticosRes.data) ? porticosRes.data : []);
        setPersons(Array.isArray(personsRes.data) ? personsRes.data : []);
        setVehicles(Array.isArray(vehiclesRes.data) ? vehiclesRes.data : []);
        setProductionPayload(productionRes || null);
      } catch (error) {
        console.error("No se pudo cargar el contexto de Productividad:", error);
        setPorticos([]);
        setPersons([]);
        setVehicles([]);
        setProductionPayload(null);
      }
    };

    loadContext();
  }, []);

  const setActiveTab = (nextTab) => {
    const nextParams = new URLSearchParams(searchParams);
    if (nextTab === DEFAULT_TAB) nextParams.delete("tab");
    else nextParams.set("tab", nextTab);
    setSearchParams(nextParams, { replace: true });
  };

  if (activeTab === "tracking") {
    return (
      <ProductivityShell
        activeTab={activeTab}
        onTabChange={setActiveTab}
        title="Productividad Tracking"
        description="Analítica de dotación, vehículos y movimientos observados en interior mina."
      >
        <TrackingDashboard porticos={porticos} persons={persons} vehicles={vehicles} />
      </ProductivityShell>
    );
  }

  if (activeTab === "access") {
    return (
      <ProductivityShell
        activeTab={activeTab}
        onTabChange={setActiveTab}
        title="Productividad Acceso"
        description="Traslados, permanencias y vueltas por vehículo para leer la operación de pórticos."
      >
        <AccessDashboard porticos={porticos} persons={persons} vehicles={vehicles} />
      </ProductivityShell>
    );
  }

  if (activeTab === "cameras") {
    return (
      <ProductivityShell
        activeTab={activeTab}
        onTabChange={setActiveTab}
        title="Productividad Cámaras"
        description="Disponibilidad CCTV y alertas de analítica para soporte de seguridad y continuidad."
      >
        <CamerasDashboard />
      </ProductivityShell>
    );
  }

  if (activeTab === "ambient") {
    return (
      <ProductivityShell
        activeTab={activeTab}
        onTabChange={setActiveTab}
        title="Productividad Agentes Ambientales"
        description="Seguimiento de gases, temperatura, viento y eventos ambientales fuera de umbral en pórticos instrumentados."
      >
        <EnvironmentalDashboard porticos={porticos} />
      </ProductivityShell>
    );
  }

  if (activeTab === "noc") {
    return (
      <ProductivityShell
        activeTab={activeTab}
        onTabChange={setActiveTab}
        title="Productividad NOC"
        description="Estado resumido del sistema para monitoreo de continuidad, conectividad y URs."
      >
        <NocDashboard />
      </ProductivityShell>
    );
  }

  return (
    <ProductivityShell
      activeTab={activeTab}
      onTabChange={setActiveTab}
      title="Productividad Tactico"
      description="Apoyo táctico con actividad sísmica, cuadrillas y uso de equipos en el rango activo."
    >
      <TacticalDashboard
        porticos={porticos}
        persons={persons}
        vehicles={vehicles}
        productionPayload={productionPayload}
      />
    </ProductivityShell>
  );
}
