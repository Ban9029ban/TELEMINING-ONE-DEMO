import { DIAMANTE_MAP_IMAGE, DIAMANTE_MAP_ASPECT_RATIO } from "../../config/cameraMaps";
import { createPortal } from "react-dom";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FaBroadcastTower,
  FaBuilding,
  FaCarSide,
  FaDownload,
  FaDoorOpen,
  FaFan,
  FaIdBadge,
  FaLink,
  FaSearch,
  FaToolbox,
  FaUserTie,
  FaVideo,
} from "react-icons/fa";
import PorticoEditModal from "../../components/PorticoEditModal";
import UserPermissionsAdminPanel from "../../components/config/UserPermissionsAdminPanel";
import ProductionConfigPanel from "../../components/production/ProductionConfigPanel";
import UpdatesPanel from "../../components/config/UpdatesPanel";
import {
  ActionButton,
  EmptyState,
  FieldShell,
  PageShell,
  SectionCard,
  SegmentedTabs,
} from "../../components/SystemTheme";
import AccessDeniedModal from "../../components/AccessDeniedModal";
import useUserPermissions from "../../hooks/useUserPermissions";
import {
  DEFAULT_EXTERNAL_SOURCES,
  EXTERNAL_SOURCE_DEFINITIONS,
  normalizeExternalSources,
} from "../../services/externalSources";
import { hasAnyPermission, hasPermission } from "../../utils/accessControl";

const apiBase = "";
const CONFIG_TAB_ITEMS = [
  {
    key: "companies",
    label: "Empresas",
    icon: <FaBuilding className="text-sm" />,
    permissionKey: "configuracion:empresas",
  },
  {
    key: "persons",
    label: "Personas",
    icon: <FaUserTie className="text-sm" />,
    permissionKey: "configuracion:personas",
  },
  {
    key: "equipment",
    label: "Equipos",
    icon: <FaToolbox className="text-sm" />,
    permissionKey: "configuracion:equipos",
  },
  {
    key: "porticos",
    label: "Pórticos",
    icon: <FaBroadcastTower className="text-sm" />,
    permissionKey: "configuracion:porticos",
  },
  {
    key: "tags",
    label: "Tags",
    icon: <FaIdBadge className="text-sm" />,
    permissionKey: "configuracion:tags",
  },
  {
    key: "vehicles",
    label: "Vehículos",
    icon: <FaCarSide className="text-sm" />,
    permissionKey: "configuracion:vehiculos",
  },
  {
    key: "cameras",
    label: "NOC",
    icon: <FaVideo className="text-sm" />,
    permissionKey: "configuracion:camaras",
  },
  {
    key: "productionModule",
    label: "Producción",
    icon: <FaBroadcastTower className="text-sm" />,
    permissionKey: "configuracion:produccion",
  },
  {
    key: "usersPermissions",
    label: "Usuarios y permisos",
    icon: <FaUserTie className="text-sm" />,
    permissionKey: "configuracion:usuarios_permisos",
  },
  {
    key: "porticosListener",
    label: "Pórticos Alive",
    icon: <FaBroadcastTower className="text-sm text-emerald-500" />,
    permissionKey: "configuracion:porticos",
  },
  {
    key: "externalSources",
    label: "Fuentes externas",
    icon: <FaLink className="text-sm" />,
    permissionKey: "configuracion:fuentes_externas",
  },
  {
    key: "updates",
    label: "Actualizaciones",
    icon: <FaDownload className="text-sm" />,
    permissionKeys: [
      "configuracion:actualizaciones",
      "configuracion:configuracion",
      "configuracion:empresas",
      "configuracion:personas",
      "configuracion:equipos",
      "configuracion:porticos",
      "configuracion:tags",
      "configuracion:vehiculos",
      "configuracion:camaras",
      "configuracion:produccion",
      "configuracion:usuarios_permisos",
      "configuracion:fuentes_externas",
    ],
  },
];

const PORTICO_MODE_OPTIONS = [
  { value: "ACCESS", label: "Acceso (2 antenas)" },
  { value: "READ", label: "Lectura (1 antena)" },
];

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiJson(path, options = {}) {
  const res = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(options.headers || {}),
    },
  });
  const contentType = res.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await res.json().catch(() => null) : await res.text().catch(() => "");
  if (!res.ok) {
    const detail = typeof body === "object" && body ? body.detail || JSON.stringify(body) : String(body || "Error");
    throw new Error(detail);
  }
  return body;
}

function Modal({ open, title, children, onClose, maxWidthClass = "max-w-3xl" }) {
  if (!open) return null;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[10050] flex items-center justify-center bg-slate-950/45 px-4 py-8 backdrop-blur-sm">
      <div className={`w-full ${maxWidthClass} overflow-hidden rounded-[28px] border border-white/75 bg-white/95 shadow-[0_30px_70px_rgba(15,23,42,0.22)] backdrop-blur`}>
        <div className="flex items-center justify-between border-b border-slate-200/85 px-5 py-4">
          <h3 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h3>
          <button
            className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 text-[0px] text-transparent transition hover:bg-slate-50 after:text-sm after:font-semibold after:text-slate-500 after:content-['x'] hover:after:text-slate-800"
            type="button"
            aria-label="Cerrar diálogo"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="max-h-[78vh] overflow-auto p-5">{children}</div>
      </div>
    </div>, document.body
  );
}

function TextField({ label, value, onChange, placeholder, type = "text", step, min, max, disabled = false }) {
  return (
    <label className="block">
      <FieldShell label={label}>
        <input
          type={type}
          className="tm-control"
          value={value}
          placeholder={placeholder}
          step={step}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      </FieldShell>
    </label>
  );
}

function SelectField({ label, value, onChange, options, placeholder, disabled = false }) {
  return (
    <label className="block">
      <FieldShell label={label}>
        <select className="tm-control" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          <option value="">{placeholder || "Selecciona"}</option>
          {options.map((opt) => (
            <option key={String(opt.value)} value={String(opt.value)}>
              {opt.label}
            </option>
          ))}
        </select>
      </FieldShell>
    </label>
  );
}

function ToggleField({ label, checked, onChange, disabled = false }) {
  return (
    <label className={`flex items-center gap-3 rounded-[20px] border border-slate-200 bg-slate-50/90 px-4 py-3 ${disabled ? "opacity-70" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
      />
      <span className="text-sm font-medium text-slate-700">{label}</span>
    </label>
  );
}

function TableCard({ title, actions, children }) {
  return (
    <div className="tm-section-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/85 px-5 py-4">
        <h3 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h3>
        <div className="flex items-center gap-2">{actions}</div>
      </div>
      <div className="px-5 py-5">{children}</div>
    </div>
  );
}

function SmallBtn({ children, onClick, variant = "secondary", disabled = false }) {
  const cls =
    variant === "primary"
      ? "border-transparent bg-[linear-gradient(135deg,#4f46e5_0%,#2563eb_100%)] text-white shadow-[0_12px_24px_rgba(79,70,229,0.18)]"
      : variant === "danger"
      ? "border-transparent bg-[linear-gradient(135deg,#ef4444_0%,#dc2626_100%)] text-white shadow-[0_12px_22px_rgba(220,38,38,0.16)]"
      : "border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-2xl border px-3.5 py-2 text-sm font-semibold transition disabled:opacity-50 ${cls}`}
    >
      {children}
    </button>
  );
}

function normalizeFilterValue(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

const TABLE_SORT_DIRECTION_OPTIONS = [
  { value: "asc", label: "Ascendente" },
  { value: "desc", label: "Descendente" },
];

const CONFIG_TABLE_SEARCH_FIELD_OPTIONS = {
  companies: [
    { value: "all", label: "Todos los campos" },
    { value: "id", label: "ID" },
    { value: "name", label: "Nombre" },
    { value: "active", label: "Activa" },
  ],
  persons: [
    { value: "all", label: "Todos los campos" },
    { value: "id", label: "ID" },
    { value: "company_name", label: "Empresa" },
    { value: "rut", label: "RUT" },
    { value: "full_name", label: "Nombre" },
    { value: "role", label: "Rol" },
    { value: "tag_code", label: "Tag" },
    { value: "entry_type", label: "Ingreso" },
    { value: "active", label: "Activa" },
  ],
  equipment: [
    { value: "all", label: "Todos los campos" },
    { value: "id", label: "ID" },
    { value: "company_name", label: "Empresa" },
    { value: "name", label: "Nombre" },
    { value: "type", label: "Tipo" },
    { value: "active", label: "Activa" },
  ],
  porticos: [
    { value: "all", label: "Todos los campos" },
    { value: "id", label: "ID" },
    { value: "name", label: "Nombre" },
    { value: "specific_name", label: "Reader" },
    { value: "zone", label: "Zona" },
    { value: "nivel", label: "Nivel" },
    { value: "gateway_name", label: "Gateway" },
    { value: "map_code", label: "Mapa" },
    { value: "active", label: "Activa" },
  ],
  tags: [
    { value: "all", label: "Todos los campos" },
    { value: "id", label: "ID" },
    { value: "code", label: "Código" },
    { value: "description", label: "Descripción" },
    { value: "assigned_to", label: "Asignado a" },
    { value: "active", label: "Activa" },
  ],
  vehicles: [
    { value: "all", label: "Todos los campos" },
    { value: "id", label: "ID" },
    { value: "patente", label: "Patente" },
    { value: "company_name", label: "Empresa" },
    { value: "descripcion", label: "Descripción" },
    { value: "tag_code", label: "Tag" },
    { value: "status", label: "Activa" },
  ],
  cameras: [
    { value: "all", label: "Todos los campos" },
    { value: "id", label: "ID" },
    { value: "device_kind", label: "Dispositivo" },
    { value: "name", label: "Nombre" },
    { value: "source_type", label: "Tipo" },
    { value: "site", label: "Sitio" },
    { value: "nivel", label: "Nivel" },
    { value: "map_preferred", label: "Mapa NOC / preferido" },
    { value: "map_base", label: "Mapa base" },
    { value: "source", label: "Origen" },
    { value: "nok_name", label: "Nombre NOC" },
    { value: "nok_number", label: "Número NOC" },
    { value: "is_active", label: "Activa" },
  ],
};

const CONFIG_TABLE_SORT_FIELD_OPTIONS = {
  companies: [
    { value: "id", label: "ID" },
    { value: "name", label: "Nombre" },
    { value: "active", label: "Activa" },
  ],
  persons: [
    { value: "id", label: "ID" },
    { value: "company_name", label: "Empresa" },
    { value: "rut", label: "RUT" },
    { value: "full_name", label: "Nombre" },
    { value: "role", label: "Rol" },
    { value: "entry_type", label: "Ingreso" },
    { value: "active", label: "Activa" },
  ],
  equipment: [
    { value: "id", label: "ID" },
    { value: "company_name", label: "Empresa" },
    { value: "name", label: "Nombre" },
    { value: "type", label: "Tipo" },
    { value: "active", label: "Activa" },
  ],
  porticos: [
    { value: "id", label: "ID" },
    { value: "name", label: "Nombre" },
    { value: "zone", label: "Zona" },
    { value: "nivel", label: "Nivel" },
    { value: "gateway_name", label: "Gateway" },
    { value: "map_code", label: "Mapa" },
    { value: "active", label: "Activa" },
  ],
  tags: [
    { value: "id", label: "ID" },
    { value: "code", label: "Código" },
    { value: "description", label: "Descripción" },
    { value: "assigned_to", label: "Asignado a" },
    { value: "active", label: "Activa" },
  ],
  vehicles: [
    { value: "id", label: "ID" },
    { value: "patente", label: "Patente" },
    { value: "company_name", label: "Empresa" },
    { value: "descripcion", label: "Descripción" },
    { value: "tag_code", label: "Tag" },
    { value: "status", label: "Activa" },
  ],
  cameras: [
    { value: "id", label: "ID" },
    { value: "device_kind", label: "Dispositivo" },
    { value: "name", label: "Nombre" },
    { value: "source_type", label: "Tipo" },
    { value: "map_preferred", label: "Mapa NOC / preferido" },
    { value: "map_base", label: "Mapa base" },
    { value: "nok_number", label: "Número NOC" },
    { value: "nok_name", label: "Nombre NOC" },
    { value: "nok_enabled", label: "NOC visible" },
    { value: "is_active", label: "Activa" },
  ],
};

function buildDefaultTabSearchFieldState() {
  return {
    companies: "all",
    persons: "all",
    equipment: "all",
    porticos: "all",
    tags: "all",
    vehicles: "all",
    cameras: "all",
  };
}

function buildDefaultTabSortState() {
  return {
    companies: { field: "name", direction: "asc" },
    persons: { field: "full_name", direction: "asc" },
    equipment: { field: "name", direction: "asc" },
    porticos: { field: "name", direction: "asc" },
    tags: { field: "code", direction: "asc" },
    vehicles: { field: "patente", direction: "asc" },
    cameras: { field: "map_preferred", direction: "asc" },
  };
}

function resolveTableAccessorValue(item, accessor) {
  const rawValue = typeof accessor === "function" ? accessor(item) : item?.[accessor];
  if (Array.isArray(rawValue)) {
    return rawValue.filter((part) => part != null && part !== "").join(" ");
  }
  return rawValue;
}

function filterCollectionByField(items, query, accessors, fieldKey = "all") {
  const normalizedQuery = normalizeFilterValue(query);
  if (!normalizedQuery) return items;

  return items.filter((item) => {
    if (fieldKey !== "all" && accessors?.[fieldKey]) {
      return normalizeFilterValue(resolveTableAccessorValue(item, accessors[fieldKey])).includes(
        normalizedQuery,
      );
    }

    return Object.values(accessors || {}).some((accessor) =>
      normalizeFilterValue(resolveTableAccessorValue(item, accessor)).includes(normalizedQuery),
    );
  });
}

function compareTableValues(leftValue, rightValue) {
  if (leftValue == null && rightValue == null) return 0;
  if (leftValue == null) return 1;
  if (rightValue == null) return -1;

  if (typeof leftValue === "boolean" || typeof rightValue === "boolean") {
    return Number(Boolean(leftValue)) - Number(Boolean(rightValue));
  }

  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return leftValue - rightValue;
  }

  return String(leftValue).localeCompare(String(rightValue), "es-CL", {
    numeric: true,
    sensitivity: "base",
  });
}

function sortCollectionByField(items, sortField, direction, accessors) {
  const accessor = accessors?.[sortField];
  if (!accessor) return items;

  const directionFactor = direction === "desc" ? -1 : 1;
  return [...items].sort(
    (leftItem, rightItem) =>
      compareTableValues(
        resolveTableAccessorValue(leftItem, accessor),
        resolveTableAccessorValue(rightItem, accessor),
      ) * directionFactor,
  );
}

function applyInlineFieldFilters(items, filters, accessors) {
  const activeEntries = Object.entries(filters || {}).filter(
    ([, value]) => normalizeFilterValue(value) !== "",
  );

  if (!activeEntries.length) return items;

  return items.filter((item) =>
    activeEntries.every(([fieldKey, value]) => {
      const accessor = accessors?.[fieldKey];
      if (!accessor) return true;
      return normalizeFilterValue(resolveTableAccessorValue(item, accessor)).includes(
        normalizeFilterValue(value),
      );
    }),
  );
}

function buildDefaultInlineTableFilterState() {
  return {
    companies: { id: "", name: "", active: "" },
    persons: {
      id: "",
      company_name: "",
      rut: "",
      full_name: "",
      role: "",
      entry_type: "",
      tag_code: "",
      active: "",
    },
    equipment: { id: "", company_name: "", name: "", type: "", active: "" },
    porticos: {
      id: "",
      name: "",
      operating_mode: "",
      zone: "",
      nivel: "",
      gateway_name: "",
      map_code: "",
      active: "",
    },
    tags: { id: "", code: "", description: "", assigned_to: "", active: "" },
    vehicles: {
      id: "",
      patente: "",
      company_name: "",
      descripcion: "",
      tag_code: "",
      status: "",
    },
    cameras: {
      id: "",
      device_kind: "",
      name: "",
      source_type: "",
      source: "",
      map_preferred: "",
      nok_number: "",
      nok_name: "",
      nok_enabled: "",
      is_active: "",
    },
  };
}

const TABLE_BOOLEAN_FILTER_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "si", label: "Si" },
  { value: "no", label: "No" },
];

function TabSearchBar({
  label,
  value,
  onChange,
  onClear,
  placeholder,
  filteredCount,
  totalCount,
}) {
  return (
    <div className="mb-4 rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="w-full max-w-2xl">
          <FieldShell
            label={label}
            hint={`Mostrando ${filteredCount} de ${totalCount} registros.`}
          >
            <div className="relative">
              <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400" />
              <input
                type="text"
                className="tm-control pl-10"
                value={value}
                placeholder={placeholder}
                onChange={(event) => onChange(event.target.value)}
              />
            </div>
          </FieldShell>
        </div>

        {value ? <SmallBtn onClick={onClear}>Limpiar filtro</SmallBtn> : null}
      </div>
    </div>
  );
}

function TableHeaderCell({
  label,
  sortState,
  sortField,
  onToggleSort,
  filterValue,
  onFilterChange,
  placeholder = "Filtrar...",
  filterOptions = null,
  className = "p-2",
}) {
  const isActiveSort = sortState?.field === sortField;
  const indicator = isActiveSort
    ? sortState?.direction === "desc"
      ? "↓"
      : "↑"
    : "↕";
  const sortIndicator = isActiveSort
    ? sortState?.direction === "desc"
      ? "\u2193"
      : "\u2191"
    : "\u2195";

  return (
    <th className={className}>
      <div className="flex min-w-[110px] flex-col gap-2">
        <button
          type="button"
          onClick={onToggleSort}
          className="flex items-center gap-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600 transition hover:text-slate-900"
        >
          <span>{label}</span>
          <span className={isActiveSort ? "text-indigo-600" : "text-slate-300"}>{sortIndicator}</span>
        </button>

        {filterOptions ? (
          <select
            className="tm-control h-8 px-2 text-xs"
            value={filterValue}
            onChange={(event) => onFilterChange(event.target.value)}
          >
            {filterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            className="tm-control h-8 px-2 text-xs"
            value={filterValue}
            placeholder={placeholder}
            onChange={(event) => onFilterChange(event.target.value)}
          />
        )}
      </div>
    </th>
  );
}

const PERSON_ENTRY_TYPE_OPTIONS = [
  { value: "permanente", label: "Permanente" },
  { value: "contratista", label: "Contratista" },
  { value: "pase_visita", label: "Pase de visita" },
];

const PERSON_EXPIRY_FIELDS = [
  { key: "driver_license_exp", label: "Licencia de conducir" },
  { key: "medical_exams_exp", label: "Examenes medicos" },
  { key: "entry_exp", label: "Ingreso" },
  { key: "site_induction_exp", label: "Induccion faena" },
  { key: "height_work_cert_exp", label: "Trabajo en altura" },
  { key: "contract_end", label: "Fin de contrato" },
];

const PERSON_EXPIRY_FILTER_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "30", label: "30 dias" },
  { value: "20", label: "20 dias" },
  { value: "15", label: "15 dias" },
  { value: "10", label: "10 dias" },
  { value: "expired", label: "Vencidos" },
];

const PERSON_EXPIRY_FIELD_OPTIONS = [
  { value: "all", label: "Todos los vencimientos" },
  ...PERSON_EXPIRY_FIELDS.map((item) => ({ value: item.key, label: item.label })),
];

const CAMERA_SOURCE_TYPE_OPTIONS = [
  { value: "video_file", label: "Video local" },
  { value: "mp4_url", label: "MP4 por URL" },
  { value: "hls", label: "HLS" },
  { value: "http", label: "HTTP / MJPEG" },
  { value: "rtsp", label: "RTSP" },
];

const NOC_DEVICE_KIND_OPTIONS = [
  { value: "camera", label: "Cámara" },
  { value: "gate", label: "Portón" },
  { value: "fan", label: "Ventilador" },
];

const NOC_DEVICE_KIND_LABELS = {
  camera: "Cámara",
  gate: "Portón",
  fan: "Ventilador",
};

const CAMERA_MAP_OPTIONS = [
  { value: "NP_dia", label: "Diamante - NP", image: DIAMANTE_MAP_IMAGE },
  { value: "NTI_nok", label: "Diamante NTI", image: "/maps/NTI_nok.png" },
  { value: "UCL_dia", label: "Diamante UCL", image: "/maps/UCL_dia.png" },
];
const CAMERA_MAP_LABELS = Object.fromEntries(
  CAMERA_MAP_OPTIONS.map((option) => [option.value, option.label]),
);
const CAMERA_MAP_IMAGE_URLS = Object.fromEntries(
  CAMERA_MAP_OPTIONS.map((option) => [option.value, option.image]),
);
const DEFAULT_CAMERA_MAP_ASPECT_RATIO = 1600 / 503;
const CAMERA_MAP_ASPECT_RATIOS = {
  NP_dia: DIAMANTE_MAP_ASPECT_RATIO,
  NTI_nok: 1300 / 503,
  NTI_dia: 1600 / 503,
  UCL_dia: 1600 / 992,
  NTI_andes_norte: 2000 / 1294,
};
const DEFAULT_CAMERA_MONITORING_SETTINGS = {
  key: "camera_monitoring_interval_seconds",
  category: "camera_monitoring",
  refresh_interval_seconds: 30,
  min_seconds: 30,
  max_seconds: 3600,
  description:
    "Intervalo en segundos para el monitoreo IP/TCP de dispositivos NOC (cámaras, portones y ventiladores) y el auto-refresh del frontend.",
  updated_at: null,
};

function normalizeCameraMonitoringSettings(data) {
  const merged = {
    ...DEFAULT_CAMERA_MONITORING_SETTINGS,
    ...(data || {}),
  };

  const refreshInterval = Number(merged.refresh_interval_seconds);
  merged.refresh_interval_seconds = Number.isFinite(refreshInterval)
    ? refreshInterval
    : DEFAULT_CAMERA_MONITORING_SETTINGS.refresh_interval_seconds;

  const minSeconds = Number(merged.min_seconds);
  merged.min_seconds = Number.isFinite(minSeconds)
    ? minSeconds
    : DEFAULT_CAMERA_MONITORING_SETTINGS.min_seconds;

  const maxSeconds = Number(merged.max_seconds);
  merged.max_seconds = Number.isFinite(maxSeconds)
    ? maxSeconds
    : DEFAULT_CAMERA_MONITORING_SETTINGS.max_seconds;

  return merged;
}

const EMPTY_CAMERA_FORM = {
  id: null,
  device_kind: "camera",
  name: "",
  source: "",
  source_type: "video_file",
  camera_ip: "",
  camera_port: "",
  camera_path: "",
  camera_user: "",
  camera_password: "",
  site: "",
  nivel: "",
  map_code: "NP_dia",
  base_map_code: "",
  x_pct: "",
  y_pct: "",
  base_x_pct: "",
  base_y_pct: "",
  position_mode: "base",
  nok_map_code: "",
  nok_x_pct: "",
  nok_y_pct: "",
  nok_alt_map_number: "",
  nok_alt_display_name: "",
  nok_enabled: false,
  nok_map_number: "",
  base_nok_map_number: "",
  nok_display_name: "",
  base_nok_display_name: "",
  notes: "",
  is_active: true,
  resolved_source: "",
  playback_url: "",
};

function getCameraMapLabel(mapCode) {
  const normalizedCode = String(mapCode || "").trim();
  return CAMERA_MAP_LABELS[normalizedCode] || normalizedCode || "-";
}

function getNocDeviceKindLabel(value) {
  return NOC_DEVICE_KIND_LABELS[String(value || "").trim()] || "Cámara";
}

function getCameraBaseMapCode(camera) {
  return String(camera?.map_code || "").trim();
}

function getCameraNokAltMapCode(camera) {
  return String(camera?.nok_map_code || "").trim();
}

function hasCameraNokAltMap(camera) {
  const baseMapCode = getCameraBaseMapCode(camera);
  const nokAltMapCode = getCameraNokAltMapCode(camera);
  return Boolean(nokAltMapCode && nokAltMapCode !== baseMapCode);
}

function getCameraPreferredMapCode(camera) {
  return getCameraNokAltMapCode(camera) || getCameraBaseMapCode(camera);
}

function getCameraPreferredCoordinates(camera) {
  if (hasCameraNokAltMap(camera)) {
    return {
      x: camera?.nok_x_pct,
      y: camera?.nok_y_pct,
      scope: "NOC",
    };
  }

  return {
    x: camera?.x_pct,
    y: camera?.y_pct,
    scope: "Base",
  };
}

function getCameraPreferredNokNumber(camera) {
  if (hasCameraNokAltMap(camera) && camera?.nok_alt_map_number != null) {
    return camera.nok_alt_map_number;
  }
  return camera?.nok_map_number;
}

function getCameraPreferredNokDisplayName(camera) {
  if (hasCameraNokAltMap(camera)) {
    return camera?.nok_alt_display_name || camera?.nok_display_name || camera?.name || "";
  }
  return camera?.nok_display_name || camera?.name || "";
}

const CONFIG_TABLE_SEARCH_ACCESSORS = {
  companies: {
    id: (item) => item.id,
    name: (item) => item.name,
    active: (item) => (item.active ? "activa si" : "inactiva no"),
  },
  persons: {
    id: (item) => item.id,
    company_name: (item) => item.company_name,
    rut: (item) => item.rut,
    full_name: (item) => item.full_name,
    role: (item) => item.role,
    tag_code: (item) => item.tag_code,
    entry_type: (item) => formatEntryType(item.entry_type),
    active: (item) => (item.active ? "activa si" : "inactiva no"),
    expiry_labels: (item) => getPersonExpiryEntries(item).map((entry) => entry.label),
  },
  equipment: {
    id: (item) => item.id,
    company_name: (item) => item.company_name,
    name: (item) => item.name,
    type: (item) => item.type,
    active: (item) => (item.active ? "activa si" : "inactiva no"),
  },
  porticos: {
    id: (item) => item.id,
    name: (item) => item.name,
    specific_name: (item) => item.specific_name,
    zone: (item) => item.zone,
    nivel: (item) => item.nivel,
    gateway_name: (item) => item.gateway_name,
    map_code: (item) => item.map_code,
    active: (item) => (item.active ? "activa si" : "inactiva no"),
  },
  tags: {
    id: (item) => item.id,
    code: (item) => item.code,
    description: (item) => item.description,
    assigned_to: (item) => item.assigned_to,
    active: (item) => (item.active ? "activa si" : "inactiva no"),
  },
  vehicles: {
    id: (item) => item.id,
    patente: (item) => item.patente,
    company_name: (item) => item.company_name,
    descripcion: (item) => item.descripcion,
    tag_code: (item) => item.tag_code,
    status: (item) => (item.status ? "activo si" : "inactivo no"),
  },
  cameras: {
    id: (item) => item.id,
    device_kind: (item) => item.device_kind_label || getNocDeviceKindLabel(item.device_kind),
    name: (item) => item.name,
    source_type: (item) => item.source_type_label || item.source_type,
    site: (item) => item.site,
    nivel: (item) => item.nivel,
    map_preferred: (item) => getCameraMapLabel(getCameraPreferredMapCode(item)),
    map_base: (item) => getCameraMapLabel(getCameraBaseMapCode(item)),
    source: (item) => item.resolved_source || item.source || item.playback_url,
    nok_name: (item) => getCameraPreferredNokDisplayName(item),
    nok_number: (item) => getCameraPreferredNokNumber(item),
    is_active: (item) => (item.is_active ? "activa si" : "inactiva no"),
  },
};

const CONFIG_TABLE_SORT_ACCESSORS = {
  companies: {
    id: (item) => Number(item.id || 0),
    name: (item) => item.name,
    active: (item) => Boolean(item.active),
  },
  persons: {
    id: (item) => Number(item.id || 0),
    company_name: (item) => item.company_name,
    rut: (item) => item.rut,
    full_name: (item) => item.full_name,
    role: (item) => item.role,
    entry_type: (item) => formatEntryType(item.entry_type),
    active: (item) => Boolean(item.active),
  },
  equipment: {
    id: (item) => Number(item.id || 0),
    company_name: (item) => item.company_name,
    name: (item) => item.name,
    type: (item) => item.type,
    active: (item) => Boolean(item.active),
  },
  porticos: {
    id: (item) => Number(item.id || 0),
    name: (item) => item.name,
    operating_mode: (item) => formatPorticoMode(item.operating_mode),
    zone: (item) => item.zone,
    nivel: (item) => item.nivel,
    gateway_name: (item) => item.gateway_name,
    map_code: (item) => item.map_code,
    active: (item) => Boolean(item.active),
  },
  tags: {
    id: (item) => String(item.id || ""),
    code: (item) => item.code,
    description: (item) => item.description,
    assigned_to: (item) => item.assigned_to,
    active: (item) => Boolean(item.active),
  },
  vehicles: {
    id: (item) => Number(item.id || 0),
    patente: (item) => item.patente,
    company_name: (item) => item.company_name,
    descripcion: (item) => item.descripcion,
    tag_code: (item) => item.tag_code,
    status: (item) => Boolean(item.status),
  },
  cameras: {
    id: (item) => Number(item.id || 0),
    device_kind: (item) => item.device_kind_label || getNocDeviceKindLabel(item.device_kind),
    name: (item) => item.name,
    source_type: (item) => item.source_type_label || item.source_type,
    source: (item) => item.resolved_source || item.source || item.playback_url,
    map_preferred: (item) => getCameraMapLabel(getCameraPreferredMapCode(item)),
    map_base: (item) => getCameraMapLabel(getCameraBaseMapCode(item)),
    nok_number: (item) => Number(getCameraPreferredNokNumber(item) || 0),
    nok_name: (item) => getCameraPreferredNokDisplayName(item),
    nok_enabled: (item) => Boolean(item.nok_enabled),
    is_active: (item) => Boolean(item.is_active),
  },
};

function normalizeCameraSourceForm(item) {
  if (!item) return { ...EMPTY_CAMERA_FORM };
  const hasNokAlternatePlacement = Boolean(
    item.nok_map_code &&
      (item.nok_x_pct != null ||
        item.nok_y_pct != null ||
        item.nok_alt_map_number != null ||
        String(item.nok_alt_display_name || "").trim()),
  );
  const effectiveMapCode = hasNokAlternatePlacement
    ? item.nok_map_code
    : item.map_code || item.nok_map_code || EMPTY_CAMERA_FORM.map_code;
  const effectiveXPct = hasNokAlternatePlacement
    ? item.nok_x_pct ?? ""
    : item.x_pct ?? item.nok_x_pct ?? "";
  const effectiveYPct = hasNokAlternatePlacement
    ? item.nok_y_pct ?? ""
    : item.y_pct ?? item.nok_y_pct ?? "";
  return {
    ...EMPTY_CAMERA_FORM,
    ...item,
    map_code: effectiveMapCode,
    base_map_code: item.map_code || "",
    camera_port: item.camera_port ?? "",
    camera_user: item.camera_user ?? "",
    camera_password: item.camera_password ?? "",
    x_pct: effectiveXPct,
    y_pct: effectiveYPct,
    base_x_pct: item.x_pct ?? "",
    base_y_pct: item.y_pct ?? "",
    position_mode: hasNokAlternatePlacement ? "nok_alt" : "base",
    nok_map_code: item.nok_map_code || "",
    nok_x_pct: item.nok_x_pct ?? "",
    nok_y_pct: item.nok_y_pct ?? "",
    nok_alt_map_number: item.nok_alt_map_number ?? "",
    nok_alt_display_name: item.nok_alt_display_name ?? "",
    nok_map_number: hasNokAlternatePlacement
      ? item.nok_alt_map_number ?? ""
      : item.nok_map_number ?? "",
    base_nok_map_number: item.nok_map_number ?? "",
    nok_display_name: hasNokAlternatePlacement
      ? item.nok_alt_display_name || item.nok_display_name || ""
      : item.nok_display_name ?? "",
    base_nok_display_name: item.nok_display_name ?? "",
  };
}

function buildCameraSourcePreview(item) {
  if (!item) return "";

  const sourceType = String(item.source_type || "video_file");
  const source = String(item.source || "").trim();
  if (source) {
    return source.replace(/^(rtsp|https?):\/\/([^:@/]+):([^@/]+)@/i, "$1://$2:***@");
  }

  const host = String(item.camera_ip || "").trim();
  const rawPath = String(item.camera_path || "").trim().replace(/^\/+/, "");
  const port = String(item.camera_port || "").trim();
  const portChunk = port ? `:${port}` : "";
  const user = String(item.camera_user || "").trim();
  const pass = String(item.camera_password || "").trim();
  const authChunk = user ? `${user}${pass ? ":***" : ""}@` : "";

  if (sourceType === "video_file") {
    if (!rawPath) return "";
    return rawPath.startsWith("/videos/") ? rawPath : `/videos/${rawPath}`;
  }

  if (!host) return "";
  if (sourceType === "rtsp") {
    return `rtsp://${authChunk}${host}${portChunk}${rawPath ? `/${rawPath}` : ""}`;
  }

  if (sourceType === "http") {
    return `http://${authChunk}${host}${portChunk}${rawPath ? `/${rawPath}` : ""}`;
  }

  if (sourceType === "hls" || sourceType === "mp4_url") {
    const scheme = port === "443" ? "https" : "http";
    return `${scheme}://${authChunk}${host}${portChunk}${rawPath ? `/${rawPath}` : ""}`;
  }

  return source;
}

function clampCameraCoordinate(value) {
  return Math.max(0, Math.min(1, value));
}

function parseCameraCoordinate(value) {
  if (value === "" || value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return clampCameraCoordinate(numeric);
}

function formatCameraCoordinate(value) {
  const numeric = parseCameraCoordinate(value);
  return numeric == null ? "" : numeric.toFixed(3);
}

function CameraPositionEditor({ item, disabled = false, onFieldChange }) {
  const surfaceRef = useRef(null);
  const [dragPointerId, setDragPointerId] = useState(null);

  const mapCode = String(item?.map_code || "");
  const mapLabel = CAMERA_MAP_LABELS[mapCode] || mapCode || "Sin mapa";
  const mapImageUrl = CAMERA_MAP_IMAGE_URLS[mapCode] || `/maps/${mapCode}.jpeg`;
  const mapAspectRatio = CAMERA_MAP_ASPECT_RATIOS[mapCode] || DEFAULT_CAMERA_MAP_ASPECT_RATIO;
  const xCoord = parseCameraCoordinate(item?.x_pct);
  const yCoord = parseCameraCoordinate(item?.y_pct);
  const hasCoordinates = xCoord != null && yCoord != null;
  const markerX = xCoord ?? 0.5;
  const markerY = yCoord ?? 0.5;
  const markerKind = String(item?.device_kind || "camera").trim();
  const markerShapeClass =
    markerKind === "gate"
      ? "rounded-[4px]"
      : markerKind === "fan"
      ? "rounded-none"
      : "rounded-full";
  const markerShapeStyle =
    markerKind === "fan"
      ? { clipPath: "polygon(50% 2%, 96% 94%, 4% 94%)" }
      : undefined;

  const updateCoordinatesFromClient = useCallback(
    (clientX, clientY) => {
      const surfaceNode = surfaceRef.current;
      if (!surfaceNode) return;
      const rect = surfaceNode.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const nextX = clampCameraCoordinate((clientX - rect.left) / rect.width);
      const nextY = clampCameraCoordinate((clientY - rect.top) / rect.height);
      onFieldChange?.("x_pct", nextX.toFixed(3));
      onFieldChange?.("y_pct", nextY.toFixed(3));
    },
    [onFieldChange],
  );

  const startDrag = useCallback(
    (event) => {
      if (disabled || !mapCode) return;
      event.preventDefault();
      setDragPointerId(event.pointerId);
      if (surfaceRef.current?.setPointerCapture) {
        try {
          surfaceRef.current.setPointerCapture(event.pointerId);
        } catch (_error) {
          // noop
        }
      }
      updateCoordinatesFromClient(event.clientX, event.clientY);
    },
    [disabled, mapCode, updateCoordinatesFromClient],
  );

  const moveDrag = useCallback(
    (event) => {
      if (disabled || dragPointerId !== event.pointerId) return;
      event.preventDefault();
      updateCoordinatesFromClient(event.clientX, event.clientY);
    },
    [disabled, dragPointerId, updateCoordinatesFromClient],
  );

  const finishDrag = useCallback(
    (event) => {
      if (dragPointerId !== event.pointerId) return;
      if (surfaceRef.current?.releasePointerCapture) {
        try {
          surfaceRef.current.releasePointerCapture(event.pointerId);
        } catch (_error) {
          // noop
        }
      }
      setDragPointerId(null);
    },
    [dragPointerId],
  );

  return (
    <div className="rounded-[24px] border border-slate-200 bg-slate-50/90 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Posición en plano
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-900">{mapLabel}</div>
          <div className="mt-1 text-xs text-slate-500">
            Haz click o arrastra sobre el plano para dejar el waypoint en el punto exacto.
          </div>
        </div>
        <div className="rounded-[16px] border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 shadow-sm">
          {hasCoordinates
            ? `X ${formatCameraCoordinate(item?.x_pct)} / Y ${formatCameraCoordinate(item?.y_pct)}`
            : "Sin coordenadas guardadas"}
        </div>
      </div>

      {!mapCode ? (
        <div className="mt-4 rounded-[22px] border border-dashed border-slate-300 bg-white/80 px-4 py-6">
          <EmptyState
            title="Selecciona un mapa"
            description="Primero elige el plano de la cámara para poder ubicar el waypoint."
          />
        </div>
      ) : (
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_290px]">
          <div
            ref={surfaceRef}
            className={`relative overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.6)] ${
              disabled ? "cursor-default" : dragPointerId != null ? "cursor-grabbing" : "cursor-crosshair"
            }`}
            style={{ aspectRatio: mapAspectRatio, touchAction: "none" }}
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
          >
            <img
              src={mapImageUrl}
              alt={mapLabel}
              className="absolute inset-0 h-full w-full select-none object-cover"
              draggable="false"
            />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.14)_0%,rgba(255,255,255,0.02)_100%)]" />
            <div
              className="pointer-events-none absolute"
              style={{
                left: `${markerX * 100}%`,
                top: `${markerY * 100}%`,
                transform: "translate(-50%, -50%)",
              }}
            >
              <div className="flex flex-col items-center">
                <div
                  className={`flex h-7 w-7 items-center justify-center border-2 border-white bg-rose-500 shadow-[0_14px_26px_rgba(239,68,68,0.34)] ${markerShapeClass}`}
                  style={markerShapeStyle}
                >
                  {markerKind === "gate" ? (
                    <FaDoorOpen className="text-[11px] text-white" />
                  ) : markerKind === "fan" ? (
                    <FaFan className="text-[11px] text-white" />
                  ) : (
                    <FaVideo className="text-[11px] text-white" />
                  )}
                </div>
                <div className="mt-1 rounded-full bg-slate-950/88 px-2 py-0.5 text-[10px] font-semibold text-white shadow-[0_10px_18px_rgba(15,23,42,0.28)]">
                  {item?.id ? `#${item.id}` : "Nueva"}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <TextField
              label="Coordenada X"
              value={item?.x_pct ?? ""}
              onChange={(value) => onFieldChange?.("x_pct", value)}
              type="number"
              step="0.001"
              min="0"
              max="1"
              placeholder="0.245"
              disabled={disabled}
            />
            <TextField
              label="Coordenada Y"
              value={item?.y_pct ?? ""}
              onChange={(value) => onFieldChange?.("y_pct", value)}
              type="number"
              step="0.001"
              min="0"
              max="1"
              placeholder="0.612"
              disabled={disabled}
            />
            <div className="grid grid-cols-2 gap-2">
              <SmallBtn
                onClick={() => {
                  onFieldChange?.("x_pct", "0.500");
                  onFieldChange?.("y_pct", "0.500");
                }}
                disabled={disabled}
              >
                Centrar
              </SmallBtn>
              <SmallBtn
                onClick={() => {
                  onFieldChange?.("x_pct", "");
                  onFieldChange?.("y_pct", "");
                }}
                disabled={disabled}
              >
                Limpiar
              </SmallBtn>
            </div>
            <div className="rounded-[18px] border border-slate-200 bg-white px-3 py-3 text-xs text-slate-600">
              El waypoint se mueve en tiempo real al cambiar X/Y, y al guardar queda persistido en
              la BD para este mapa.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("es-CL", { timeZone: "America/Santiago" });
}

function formatSecondsAgo(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return "-";
  if (seconds < 60) return `hace ${seconds}s`;
  if (seconds < 3600) return `hace ${Math.floor(seconds / 60)}m`;
  return `hace ${Math.floor(seconds / 3600)}h`;
}

function formatRfidRssi(value) {
  return Number.isFinite(Number(value)) ? `${Number(value)} dBm` : "-";
}

function getListenerBaseUrl() {
  const runtimeEnv = typeof window !== "undefined" && window.__ENV ? window.__ENV : {};
  const configured = String(runtimeEnv.LISTENER_URL || "").trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  if (typeof window === "undefined") {
    return "http://localhost:8090";
  }

  return `${window.location.protocol}//${window.location.hostname}:8090`;
}

function normalizeRfidCode(value) {
  return String(value ?? "")
    .replace(/[^0-9A-Za-z]/g, "")
    .toUpperCase()
    .trim();
}

function computeSecondsSince(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.max(0, Math.round((Date.now() - parsed.getTime()) / 1000));
}

function mapListenerSummaryToRows(items, knownTags = []) {
  const tagByCode = new Map(
    (knownTags || []).map((tag) => [normalizeRfidCode(tag.code), tag]),
  );

  return (items || []).map((item, index) => {
    const knownTag = tagByCode.get(normalizeRfidCode(item.epc));
    if (!knownTag) {
      return null;
    }

    return {
      tag_id: knownTag.id || `listener-${item.epc || index}`,
      tag_code: item.epc || "-",
      assigned_to: knownTag.assigned_to || null,
      entity_type: knownTag.entity_type || "tag registrado",
      reader_code: item.reader_code || item.reader_host || "-",
      antenna_port: item.antenna_port,
      antenna_name: item.antenna_name,
      portico_name: null,
      strongest_rssi: item.strongest_rssi,
      latest_rssi: item.latest_rssi,
      sample_count: item.read_count || 0,
      proximity_hint: item.proximity_hint || "Sin RSSI",
      last_seen_at: item.last_seen_at,
      seconds_since_last_seen: computeSecondsSince(item.last_seen_at),
    };
  }).filter(Boolean);
}

async function fetchListenerRfidSummary(knownTags = []) {
  if (!Array.isArray(knownTags) || !knownTags.length) {
    return [];
  }

  const baseUrl = getListenerBaseUrl();
  const response = await fetch(`${baseUrl}/rfid-summary?limit=24`);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");

  if (!response.ok) {
    const detail =
      typeof body === "object" && body
        ? body.detail || JSON.stringify(body)
        : String(body || `Listener ${response.status}`);
    throw new Error(detail);
  }

  return mapListenerSummaryToRows(Array.isArray(body?.items) ? body.items : [], knownTags);
}

function rfidProximityClasses(hint) {
  if (hint === "Muy cerca") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (hint === "Cerca") return "border-sky-200 bg-sky-50 text-sky-700";
  if (hint === "Media") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function formatPorticoMode(value) {
  return String(value || "").toUpperCase() === "ACCESS" ? "Acceso" : "Lectura";
}

function formatEntryType(value) {
  if (value === "permanente") return "Permanente";
  if (value === "contratista") return "Contratista";
  if (value === "pase_visita") return "Pase de visita";
  return "-";
}

function parseDateOnly(value) {
  if (!value) return null;
  const safeValue = String(value).slice(0, 10);
  const parsed = new Date(`${safeValue}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getDateDiffFromToday(value) {
  const parsed = parseDateOnly(value);
  if (!parsed) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
  return Math.round((parsed.getTime() - today.getTime()) / 86400000);
}

function getPersonExpiryEntries(record) {
  return PERSON_EXPIRY_FIELDS.map((field) => {
    const dateValue = record?.[field.key];
    const diffDays = getDateDiffFromToday(dateValue);
    if (diffDays == null) return null;

    return {
      ...field,
      dateValue: String(dateValue).slice(0, 10),
      diffDays,
    };
  }).filter(Boolean);
}

function getPersonExpiryAlerts(record, warnDays = 15, fieldKey = "all") {
  return getPersonExpiryEntries(record)
    .filter((entry) => fieldKey === "all" || entry.key === fieldKey)
    .filter((entry) => entry.diffDays < 0 || entry.diffDays <= warnDays)
    .sort((left, right) => left.diffDays - right.diffDays)
    .map((entry) => {
      if (entry.diffDays < 0) {
        return {
          ...entry,
          severity: "expired",
          badge: `${entry.label}: vencido`,
          message: `${entry.label} vencido hace ${Math.abs(entry.diffDays)} dias (${entry.dateValue}).`,
        };
      }

      if (entry.diffDays === 0) {
        return {
          ...entry,
          severity: "warning",
          badge: `${entry.label}: hoy`,
          message: `${entry.label} vence hoy (${entry.dateValue}).`,
        };
      }

      return {
        ...entry,
        severity: "warning",
        badge: `${entry.label}: ${entry.diffDays}d`,
        message: `${entry.label} por vencer en ${entry.diffDays} dias (${entry.dateValue}).`,
      };
    });
}

function matchesPersonExpiryFilter(record, windowValue, fieldKey = "all") {
  const entries = getPersonExpiryEntries(record).filter(
    (entry) => fieldKey === "all" || entry.key === fieldKey,
  );

  if (windowValue === "all" && fieldKey === "all") {
    return true;
  }

  if (!entries.length) {
    return false;
  }

  if (windowValue === "all") {
    return true;
  }

  if (windowValue === "expired") {
    return entries.some((entry) => entry.diffDays < 0);
  }

  const limit = Number(windowValue);
  if (Number.isNaN(limit)) return true;

  return entries.some((entry) => entry.diffDays >= 0 && entry.diffDays <= limit);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No se pudo leer la foto seleccionada."));
    reader.readAsDataURL(file);
  });
}

function PersonPhotoAvatar({
  src,
  alt,
  sizeClass = "h-11 w-11",
  emojiClass = "text-lg",
  roundedClass = "rounded-[18px]",
}) {
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setBroken(false);
  }, [src]);

  if (src && !broken) {
    return (
      <img
        src={src}
        alt={alt}
        className={`${sizeClass} ${roundedClass} border border-slate-200 object-cover shadow-sm`}
        onError={() => setBroken(true)}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} ${roundedClass} flex items-center justify-center border border-slate-200 bg-slate-100 text-slate-700 shadow-sm`}
    >
      <span role="img" aria-label="persona minera" className={emojiClass}>
        ðŸ‘·
      </span>
    </div>
  );
}

function ExpiryBadge({ alert }) {
  const toneClasses =
    alert.severity === "expired"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : "border-amber-200 bg-amber-50 text-amber-700";

  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${toneClasses}`}
      title={alert.message}
    >
      {alert.badge}
    </span>
  );
}

export default function Config() {
  const { permissions, roles } = useUserPermissions({ syncOnMount: false });
  const [activeTab, setActiveTab] = useState("");
  const [blockedResource, setBlockedResource] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionNotice, setActionNotice] = useState("");

  const [companies, setCompanies] = useState([]);
  const [persons, setPersons] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [porticos, setPorticos] = useState([]);
  const [tags, setTags] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [rfidProximityRows, setRfidProximityRows] = useState([]);
  const [rfidProximityLoading, setRfidProximityLoading] = useState(false);
  const [rfidProximityError, setRfidProximityError] = useState("");
  const [cameras, setCameras] = useState([]);
  const [externalSources, setExternalSources] = useState(() =>
    normalizeExternalSources(DEFAULT_EXTERNAL_SOURCES),
  );
  const [externalSourcesSaving, setExternalSourcesSaving] = useState(false);
  const [cameraMonitoringSettings, setCameraMonitoringSettings] = useState(() =>
    normalizeCameraMonitoringSettings(DEFAULT_CAMERA_MONITORING_SETTINGS),
  );
  const [cameraMonitoringIntervalInput, setCameraMonitoringIntervalInput] = useState(
    String(DEFAULT_CAMERA_MONITORING_SETTINGS.refresh_interval_seconds),
  );
  const [cameraMonitoringSaving, setCameraMonitoringSaving] = useState(false);
  const [cameraEditor, setCameraEditor] = useState(() => ({
    open: false,
    mode: "create",
    item: { ...EMPTY_CAMERA_FORM },
  }));
  const [cameraSaving, setCameraSaving] = useState(false);
  const [cameraFormError, setCameraFormError] = useState("");
  const [cameraProbe, setCameraProbe] = useState({ loading: false, ok: null, detail: "" });

  const [porticoEdit, setPorticoEdit] = useState(null);

  const [modal, setModal] = useState({ open: false, type: "", mode: "create", item: null });
  const [confirmDel, setConfirmDel] = useState({ open: false, type: "", item: null });
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [tabSearch, setTabSearch] = useState({
    companies: "",
    persons: "",
    equipment: "",
    porticos: "",
    tags: "",
    vehicles: "",
    cameras: "",
  });
  const [tableColumnFilters, setTableColumnFilters] = useState(() =>
    buildDefaultInlineTableFilterState(),
  );
  const [tabSearchField, setTabSearchField] = useState(() => buildDefaultTabSearchFieldState());
  const [tabSort, setTabSort] = useState(() => buildDefaultTabSortState());
  const [showPersonExpiryFilters, setShowPersonExpiryFilters] = useState(false);
  const [personExpiryWindow, setPersonExpiryWindow] = useState("all");
  const [personExpiryField, setPersonExpiryField] = useState("all");

  const companyOptions = useMemo(
    () => companies.map((c) => ({ value: c.id, label: `${c.name} (#${c.id})` })),
    [companies],
  );

  const updateTableColumnFilter = useCallback((tableKey, fieldKey, value) => {
    setTableColumnFilters((current) => ({
      ...current,
      [tableKey]: {
        ...current[tableKey],
        [fieldKey]: value,
      },
    }));
  }, []);

  const toggleTableSort = useCallback((tableKey, fieldKey) => {
    setTabSort((current) => {
      const currentTableSort = current[tableKey] || { field: fieldKey, direction: "asc" };
      const nextDirection =
        currentTableSort.field === fieldKey && currentTableSort.direction === "asc"
          ? "desc"
          : "asc";

      return {
        ...current,
        [tableKey]: {
          field: fieldKey,
          direction: nextDirection,
        },
      };
    });
  }, []);

  const tagOptions = useMemo(
    () =>
      tags
        .filter((t) => t.active)
        .map((t) => ({ value: t.id, label: `${t.code}${t.assigned_to ? ` (asignado: ${t.assigned_to})` : ""}` })),
    [tags],
  );

  const filteredCompanies = useMemo(
    () =>
      sortCollectionByField(
        applyInlineFieldFilters(
          filterCollectionByField(
            companies,
            tabSearch.companies,
            CONFIG_TABLE_SEARCH_ACCESSORS.companies,
            tabSearchField.companies,
          ),
          tableColumnFilters.companies,
          CONFIG_TABLE_SEARCH_ACCESSORS.companies,
        ),
        tabSort.companies.field,
        tabSort.companies.direction,
        CONFIG_TABLE_SORT_ACCESSORS.companies,
      ),
    [
      companies,
      tabSearch.companies,
      tableColumnFilters.companies,
      tabSearchField.companies,
      tabSort.companies.direction,
      tabSort.companies.field,
    ],
  );

  const searchedPersons = useMemo(
    () =>
      filterCollectionByField(
        persons,
        tabSearch.persons,
        {
          ...CONFIG_TABLE_SEARCH_ACCESSORS.persons,
          driver_license: (item) => item.driver_license,
          medical_exams: (item) => item.medical_exams,
          site_induction: (item) => item.site_induction,
          height_work_cert: (item) => item.height_work_cert,
          blood_type: (item) => item.blood_type,
          ppe_size: (item) => item.ppe_size,
        },
        tabSearchField.persons,
      ),
    [persons, tabSearch.persons, tabSearchField.persons],
  );

  const filteredPersons = useMemo(() => {
    const filteredByExpiry =
      personExpiryWindow === "all" && personExpiryField === "all"
        ? searchedPersons
        : searchedPersons.filter((item) =>
            matchesPersonExpiryFilter(item, personExpiryWindow, personExpiryField),
          );

    return sortCollectionByField(
      applyInlineFieldFilters(
        filteredByExpiry,
        tableColumnFilters.persons,
        CONFIG_TABLE_SEARCH_ACCESSORS.persons,
      ),
      tabSort.persons.field,
      tabSort.persons.direction,
      CONFIG_TABLE_SORT_ACCESSORS.persons,
    );
  }, [
    personExpiryField,
    personExpiryWindow,
    searchedPersons,
    tableColumnFilters.persons,
    tabSort.persons.direction,
    tabSort.persons.field,
  ]);

  const filteredEquipment = useMemo(
    () =>
      sortCollectionByField(
        applyInlineFieldFilters(
          filterCollectionByField(
            equipment,
            tabSearch.equipment,
            CONFIG_TABLE_SEARCH_ACCESSORS.equipment,
            tabSearchField.equipment,
          ),
          tableColumnFilters.equipment,
          CONFIG_TABLE_SEARCH_ACCESSORS.equipment,
        ),
        tabSort.equipment.field,
        tabSort.equipment.direction,
        CONFIG_TABLE_SORT_ACCESSORS.equipment,
      ),
    [
      equipment,
      tabSearch.equipment,
      tableColumnFilters.equipment,
      tabSearchField.equipment,
      tabSort.equipment.direction,
      tabSort.equipment.field,
    ],
  );

  const filteredPorticos = useMemo(
    () =>
      sortCollectionByField(
        applyInlineFieldFilters(
          filterCollectionByField(
            porticos,
            tabSearch.porticos,
            {
              ...CONFIG_TABLE_SEARCH_ACCESSORS.porticos,
              gateway_id: (item) => item.gateway_id,
              operating_mode: (item) => item.operating_mode,
              antenna_in_port: (item) => item.antenna_in_port,
              antenna_out_port: (item) => item.antenna_out_port,
              x_pct: (item) => item.x_pct,
              y_pct: (item) => item.y_pct,
            },
            tabSearchField.porticos,
          ),
          tableColumnFilters.porticos,
          {
            ...CONFIG_TABLE_SEARCH_ACCESSORS.porticos,
            operating_mode: (item) => formatPorticoMode(item.operating_mode),
          },
        ),
        tabSort.porticos.field,
        tabSort.porticos.direction,
        CONFIG_TABLE_SORT_ACCESSORS.porticos,
      ),
    [
      porticos,
      tabSearch.porticos,
      tableColumnFilters.porticos,
      tabSearchField.porticos,
      tabSort.porticos.direction,
      tabSort.porticos.field,
    ],
  );

  const filteredTags = useMemo(
    () =>
      sortCollectionByField(
        applyInlineFieldFilters(
          filterCollectionByField(
            tags,
            tabSearch.tags,
            CONFIG_TABLE_SEARCH_ACCESSORS.tags,
            tabSearchField.tags,
          ),
          tableColumnFilters.tags,
          CONFIG_TABLE_SEARCH_ACCESSORS.tags,
        ),
        tabSort.tags.field,
        tabSort.tags.direction,
        CONFIG_TABLE_SORT_ACCESSORS.tags,
      ),
    [
      tags,
      tabSearch.tags,
      tableColumnFilters.tags,
      tabSearchField.tags,
      tabSort.tags.direction,
      tabSort.tags.field,
    ],
  );

  const filteredVehicles = useMemo(
    () =>
      sortCollectionByField(
        applyInlineFieldFilters(
          filterCollectionByField(
            vehicles,
            tabSearch.vehicles,
            CONFIG_TABLE_SEARCH_ACCESSORS.vehicles,
            tabSearchField.vehicles,
          ),
          tableColumnFilters.vehicles,
          CONFIG_TABLE_SEARCH_ACCESSORS.vehicles,
        ),
        tabSort.vehicles.field,
        tabSort.vehicles.direction,
        CONFIG_TABLE_SORT_ACCESSORS.vehicles,
      ),
    [
      vehicles,
      tabSearch.vehicles,
      tableColumnFilters.vehicles,
      tabSearchField.vehicles,
      tabSort.vehicles.direction,
      tabSort.vehicles.field,
    ],
  );

  const filteredCameras = useMemo(
    () =>
      sortCollectionByField(
        applyInlineFieldFilters(
          filterCollectionByField(
            cameras,
            tabSearch.cameras,
            {
              ...CONFIG_TABLE_SEARCH_ACCESSORS.cameras,
              camera_ip: (item) => item.camera_ip,
              camera_path: (item) => item.camera_path,
              playback_url: (item) => item.playback_url,
              nok_enabled: (item) => (item.nok_enabled ? "nok si" : "nok no"),
            },
            tabSearchField.cameras,
          ),
          tableColumnFilters.cameras,
          CONFIG_TABLE_SEARCH_ACCESSORS.cameras,
        ),
        tabSort.cameras.field,
        tabSort.cameras.direction,
        CONFIG_TABLE_SORT_ACCESSORS.cameras,
      ),
    [
      cameras,
      tabSearch.cameras,
      tableColumnFilters.cameras,
      tabSearchField.cameras,
      tabSort.cameras.direction,
      tabSort.cameras.field,
    ],
  );

  const personExpirySummary = useMemo(
    () => ({
      expired: persons.filter((item) => matchesPersonExpiryFilter(item, "expired", "all")).length,
      within15: persons.filter((item) => matchesPersonExpiryFilter(item, "15", "all")).length,
      within30: persons.filter((item) => matchesPersonExpiryFilter(item, "30", "all")).length,
    }),
    [persons],
  );

  const externalSourceView = useMemo(
    () => normalizeExternalSources(externalSources),
    [externalSources],
  );

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const [c, p, e, po, t, v, cameraSources, external, cameraMonitoring] = await Promise.all([
        apiJson("/api/config/companies"),
        apiJson("/api/config/persons"),
        apiJson("/api/config/equipment"),
        apiJson("/api/config/porticos"),
        apiJson("/api/config/tags"),
        apiJson("/api/config/vehicles"),
        apiJson("/api/cameras/sources"),
        apiJson("/api/config/external-sources"),
        apiJson("/api/config/camera-monitoring"),
      ]);
      setCompanies(c || []);
      setPersons(p || []);
      setEquipment(e || []);
      setPorticos(po || []);
      setTags(t || []);
      setVehicles(v || []);
      setCameras(cameraSources || []);
      setExternalSources(normalizeExternalSources(external || {}));
      const normalizedMonitoring = normalizeCameraMonitoringSettings(cameraMonitoring || {});
      setCameraMonitoringSettings(normalizedMonitoring);
      setCameraMonitoringIntervalInput(String(normalizedMonitoring.refresh_interval_seconds));
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  const loadRfidProximity = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setRfidProximityLoading(true);
    }

    try {
      const data = await apiJson("/api/access/rfid-proximity?window_seconds=60&limit=24");
      const backendRows = Array.isArray(data?.items) ? data.items : [];
      if (backendRows.length) {
        setRfidProximityRows(backendRows);
        setRfidProximityError("");
        return;
      }

      const listenerRows = await fetchListenerRfidSummary(tags);
      setRfidProximityRows(listenerRows);
      setRfidProximityError("");
    } catch (e) {
      try {
        const listenerRows = await fetchListenerRfidSummary(tags);
        setRfidProximityRows(listenerRows);
        setRfidProximityError("");
      } catch (listenerError) {
        setRfidProximityRows([]);
        setRfidProximityError(String(listenerError.message || e.message || listenerError || e));
      }
    } finally {
      if (!silent) {
        setRfidProximityLoading(false);
      }
    }
  }, [tags]);

  async function saveExternalSources() {
    setExternalSourcesSaving(true);
    setError("");
    try {
      const saved = await apiJson("/api/config/external-sources", {
        method: "PUT",
        body: JSON.stringify({
          control_vial_url: externalSources.control_vial_url,
        }),
      });
      setExternalSources(normalizeExternalSources(saved || {}));
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setExternalSourcesSaving(false);
    }
  }

  async function saveCameraMonitoringSettings() {
    setCameraMonitoringSaving(true);
    setError("");
    try {
      const saved = await apiJson("/api/config/camera-monitoring", {
        method: "PUT",
        body: JSON.stringify({
          refresh_interval_seconds: Number(cameraMonitoringIntervalInput),
        }),
      });
      const normalizedMonitoring = normalizeCameraMonitoringSettings(saved || {});
      setCameraMonitoringSettings(normalizedMonitoring);
      setCameraMonitoringIntervalInput(String(normalizedMonitoring.refresh_interval_seconds));
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setCameraMonitoringSaving(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  const tabs = CONFIG_TAB_ITEMS;
  const allowedTabs = useMemo(
    () =>
      CONFIG_TAB_ITEMS.filter((tab) =>
        tab.permissionKeys
          ? hasAnyPermission(tab.permissionKeys, { permissions, roles })
          : hasPermission(tab.permissionKey, { permissions, roles }),
      ),
    [permissions, roles],
  );

  useEffect(() => {
    const fallbackTab = allowedTabs[0]?.key || "";
    if (!fallbackTab) {
      if (activeTab) {
        setActiveTab("");
      }
      return;
    }

    if (!allowedTabs.some((tab) => tab.key === activeTab)) {
      setActiveTab(fallbackTab);
    }
  }, [activeTab, allowedTabs]);

  function openCreate(type) {
    setModal({ open: true, type, mode: "create", item: null });
  }

  function openEdit(type, item) {
    setModal({ open: true, type, mode: "edit", item });
  }

  function openDelete(type, item) {
    setError("");
    setActionNotice("");
    setDeleteError("");
    setConfirmDel({ open: true, type, item });
  }

  function openCameraCreate() {
    setCameraFormError("");
    setCameraProbe({ loading: false, ok: null, detail: "" });
    setCameraEditor({ open: true, mode: "create", item: { ...EMPTY_CAMERA_FORM } });
  }

  function openCameraEdit(item) {
    setCameraFormError("");
    setCameraProbe({ loading: false, ok: null, detail: "" });
    setCameraEditor({ open: true, mode: "edit", item: normalizeCameraSourceForm(item) });
  }

  function openCameraView(item) {
    setCameraFormError("");
    setCameraProbe({ loading: false, ok: null, detail: "" });
    setCameraEditor({ open: true, mode: "view", item: normalizeCameraSourceForm(item) });
  }

  function closeCameraEditor() {
    setCameraFormError("");
    setCameraProbe({ loading: false, ok: null, detail: "" });
    setCameraEditor({ open: false, mode: "create", item: { ...EMPTY_CAMERA_FORM } });
  }

  function updateCameraEditorField(field, value) {
    setCameraEditor((current) => ({
      ...current,
      item: (() => {
        const nextItem = {
          ...current.item,
          [field]: value,
        };

        if (
          field === "device_kind" &&
          value !== "camera" &&
          String(nextItem.source_type || "").trim() === "video_file"
        ) {
          nextItem.source_type = "http";
        }

        return nextItem;
      })(),
    }));
  }

  async function saveCameraEditor() {
    setCameraSaving(true);
    setCameraFormError("");
    try {
      const draft = cameraEditor.item || EMPTY_CAMERA_FORM;
      const editingNokAlternate = draft.position_mode === "nok_alt";
      const rawSource = String(draft.source || "").trim();
      const safeSource = rawSource.includes("***@") ? "" : rawSource;
      const currentXPct = draft.x_pct === "" || draft.x_pct == null ? null : Number(draft.x_pct);
      const currentYPct = draft.y_pct === "" || draft.y_pct == null ? null : Number(draft.y_pct);
      const baseXPct = draft.base_x_pct === "" || draft.base_x_pct == null ? null : Number(draft.base_x_pct);
      const baseYPct = draft.base_y_pct === "" || draft.base_y_pct == null ? null : Number(draft.base_y_pct);
      const currentNokNumber =
        draft.nok_map_number === "" || draft.nok_map_number == null
          ? null
          : Number(draft.nok_map_number);
      const baseNokNumber =
        draft.base_nok_map_number === "" || draft.base_nok_map_number == null
          ? null
          : Number(draft.base_nok_map_number);
      const currentDisplayName = String(draft.nok_display_name || "").trim() || null;
      const baseDisplayName = String(draft.base_nok_display_name || "").trim() || null;
      const payload = {
        name: String(draft.name || "").trim(),
        device_kind: draft.device_kind || "camera",
        source: safeSource || null,
        source_type: draft.source_type || "video_file",
        camera_ip: String(draft.camera_ip || "").trim() || null,
        camera_port: draft.camera_port === "" || draft.camera_port == null ? null : Number(draft.camera_port),
        camera_path: String(draft.camera_path || "").trim() || null,
        camera_user: String(draft.camera_user || "").trim() || null,
        camera_password: String(draft.camera_password || "").trim() || null,
        site: String(draft.site || "").trim() || null,
        nivel: String(draft.nivel || "").trim() || null,
        map_code: editingNokAlternate ? draft.base_map_code || null : draft.map_code || null,
        x_pct: editingNokAlternate ? baseXPct : currentXPct,
        y_pct: editingNokAlternate ? baseYPct : currentYPct,
        nok_map_code: editingNokAlternate ? draft.map_code || null : draft.nok_map_code || null,
        nok_x_pct: editingNokAlternate
          ? currentXPct
          : draft.nok_x_pct === "" || draft.nok_x_pct == null
            ? null
            : Number(draft.nok_x_pct),
        nok_y_pct: editingNokAlternate
          ? currentYPct
          : draft.nok_y_pct === "" || draft.nok_y_pct == null
            ? null
            : Number(draft.nok_y_pct),
        nok_alt_map_number: editingNokAlternate
          ? currentNokNumber
          : draft.nok_alt_map_number === "" || draft.nok_alt_map_number == null
            ? null
            : Number(draft.nok_alt_map_number),
        nok_alt_display_name: editingNokAlternate
          ? currentDisplayName
          : String(draft.nok_alt_display_name || "").trim() || null,
        nok_enabled: Boolean(draft.nok_enabled),
        nok_map_number: editingNokAlternate ? baseNokNumber : currentNokNumber,
        nok_display_name: editingNokAlternate ? baseDisplayName : currentDisplayName,
        notes: String(draft.notes || "").trim() || null,
        is_active: Boolean(draft.is_active),
      };

      const path =
        cameraEditor.mode === "edit" && draft.id
          ? `/api/cameras/sources/${draft.id}`
          : "/api/cameras/sources";
      const method = cameraEditor.mode === "edit" && draft.id ? "PUT" : "POST";

      await apiJson(path, {
        method,
        body: JSON.stringify(payload),
      });
      await loadAll();
      closeCameraEditor();
    } catch (e) {
      setCameraFormError(String(e.message || e));
    } finally {
      setCameraSaving(false);
    }
  }

  async function probeCameraSource(cameraId) {
    if (!cameraId) return;
    setCameraProbe({ loading: true, ok: null, detail: "" });
    try {
      const result = await apiJson(`/api/cameras/sources/${cameraId}/probe`, {
        method: "POST",
      });
      setCameraProbe({
        loading: false,
        ok: Boolean(result?.ok),
        detail: result?.detail || (result?.ok ? "Fuente valida" : "No se pudo validar la fuente"),
      });
    } catch (e) {
      setCameraProbe({
        loading: false,
        ok: false,
        detail: String(e.message || e),
      });
    }
  }

  async function doDelete(type, item) {
    const id = item?.id;
    if (id == null || id === "") throw new Error("El registro no tiene identificador.");
    const map = {
      companies: `/api/config/companies/${id}`,
      persons: `/api/config/persons/${id}`,
      equipment: `/api/config/equipment/${id}`,
      vehicles: `/api/config/vehicles/${id}`,
      tags: `/api/config/tags/${id}`,
      porticos: `/api/config/porticos/${id}`,
      cameras: `/api/cameras/sources/${id}`,
    };
    if (!map[type]) throw new Error("Tipo de registro no válido.");
    await apiJson(map[type], { method: "DELETE" });
    await loadAll();
    setActionNotice("Registro eliminado correctamente.");
  }

  const legacyTabs = [
    { key: "companies", label: "Empresas", icon: <FaBuilding className="text-sm" /> },
    { key: "persons", label: "Personas", icon: <FaUserTie className="text-sm" /> },
    { key: "equipment", label: "Equipos", icon: <FaToolbox className="text-sm" /> },
    { key: "porticos", label: "Pórticos" },
    { key: "tags", label: "Tags" },
    { key: "vehicles", label: "Vehículos" },
    { key: "cameras", label: "Cámaras", icon: <FaVideo className="text-sm" /> },
    { key: "productionModule", label: "Producción", icon: <FaBroadcastTower className="text-sm" /> },
    { key: "usersPermissions", label: "Usuarios y permisos", icon: <FaUserTie className="text-sm" /> },
    { key: "externalSources", label: "Fuentes externas", icon: <FaLink className="text-sm" /> },
    { key: "updates", label: "Actualizaciones", icon: <FaDownload className="text-sm" /> },
  ];

  if (!legacyTabs.length) {
    // Conservamos este bloque solo para evitar una conversion agresiva del archivo legacy.
  }

  const getTabLabel = (key, fallback) => {
    if (key === "porticos") return "Pórticos";
    if (key === "vehicles") return "Vehículos";
    if (key === "cameras") return "Cámaras";
    if (key === "porticos") return "Pórticos";
    if (key === "vehicles") return "Vehículos";
    if (key === "cameras") return "Cámaras";
    if (key === "productionModule") return "Producción";
    if (key === "usersPermissions") return "Usuarios y permisos";
    if (key === "externalSources") return "Fuentes externas";
    if (key === "updates") return "Actualizaciones";
    if (key === "porticosListener") return "Configuración pórticos";
    return fallback;
  };
  const activeTabAllowed = allowedTabs.some((tab) => tab.key === activeTab);
  const handleProtectedTabChange = (nextTab) => {
    const tab = tabs.find((item) => item.key === nextTab);
    if (!tab) return;
    const hasTabAccess = tab.permissionKeys
      ? hasAnyPermission(tab.permissionKeys, { permissions, roles })
      : hasPermission(tab.permissionKey, { permissions, roles });
    if (!hasTabAccess) {
      setBlockedResource(getTabLabel(tab.key, tab.label));
      return;
    }
    setActiveTab(nextTab);
  };

  useEffect(() => {
    if (!activeTabAllowed || activeTab !== "tags") {
      return undefined;
    }

    let cancelled = false;

    const run = async (silent = false) => {
      await loadRfidProximity({ silent });
      if (cancelled) {
        return;
      }
    };

    run(false);
    const interval = setInterval(() => {
      run(true);
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeTab, activeTabAllowed, loadRfidProximity]);

  return (
    <PageShell
      eyebrow="Centro de configuración"
      title="Configuración operativa"
      description="Administra empresas, personas, vehículos, tags y pórticos desde un panel unificado con el nuevo lenguaje visual del sistema."
      stats={[
        {
          icon: <FaBuilding />,
          label: "Empresas",
          value: companies.length,
          meta: "Base organizacional",
          tone: "blue",
        },
        {
          icon: <FaUserTie />,
          label: "Personas activas",
          value: persons.filter((item) => item.active).length,
          meta: `${persons.length} registradas`,
          tone: "green",
        },
        {
          icon: <FaBroadcastTower />,
          label: "Pórticos",
          value: porticos.length,
          meta: `${porticos.filter((item) => item.active).length} operativos`,
          tone: "indigo",
        },
        {
          icon: <FaIdBadge />,
          label: "Tags activos",
          value: tags.filter((item) => item.active).length,
          meta: `${vehicles.length} vehículos y ${equipment.length} equipos`,
          tone: "amber",
        },
      ]}
    >
      <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <SegmentedTabs
          items={tabs.map((tab) => ({
            value: tab.key,
            label: getTabLabel(tab.key, tab.label),
            icon: tab.icon,
          }))}
          value={activeTab}
          onChange={handleProtectedTabChange}
        />

        <div className="rounded-[24px] border border-white/70 bg-white/85 px-4 py-3 shadow-[0_16px_30px_rgba(15,23,42,0.06)]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Vista activa
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-900">
            {tabs.find((tab) => tab.key === activeTab)?.label || "Configuración"}
          </div>
        </div>
      </div>

      {actionNotice && <div role="status" className="text-sm text-emerald-700">{actionNotice}</div>}
      {error ? (
        <div className="rounded-[24px] border border-rose-200 bg-rose-50/90 px-4 py-3 text-sm text-rose-700 shadow-sm">
          {error}
        </div>
      ) : null}

      {loading ? <div className="text-sm text-gray-600">Cargando configuración...</div> : null}

      {!loading && !activeTabAllowed ? (
        <SectionCard
          title="Submódulos de configuración"
          subtitle="El perfil actual no tiene una pestaña operativa habilitada dentro de Configuración."
          actions={
            <ActionButton
              variant="secondary"
              onClick={() => setBlockedResource("Configuración / Submódulos")}
            >
              Ver restricción
            </ActionButton>
          }
        >
          <div className="text-sm text-slate-500">
            Solicita al administrador acceso a empresas, personas, pórticos, usuarios y permisos
            o fuentes externas según tu necesidad.
          </div>
        </SectionCard>
      ) : null}

      {/* EMPRESAS */}
      {activeTabAllowed && activeTab === "companies" ? (
        <TableCard
          title="Empresas"
          actions={<SmallBtn variant="primary" onClick={() => openCreate("companies")}>Nueva</SmallBtn>}
        >
          {filteredCompanies.length ? (
            <div className="overflow-auto">
              <table className="tm-data-table min-w-full">
                <thead>
                  <tr className="text-left">
                    <TableHeaderCell
                      label="ID"
                      sortState={tabSort.companies}
                      sortField="id"
                      onToggleSort={() => toggleTableSort("companies", "id")}
                      filterValue={tableColumnFilters.companies.id}
                      onFilterChange={(value) => updateTableColumnFilter("companies", "id", value)}
                      placeholder="ID"
                    />
                    <TableHeaderCell
                      label="Nombre"
                      sortState={tabSort.companies}
                      sortField="name"
                      onToggleSort={() => toggleTableSort("companies", "name")}
                      filterValue={tableColumnFilters.companies.name}
                      onFilterChange={(value) => updateTableColumnFilter("companies", "name", value)}
                      placeholder="Nombre"
                    />
                    <TableHeaderCell
                      label="Activa"
                      sortState={tabSort.companies}
                      sortField="active"
                      onToggleSort={() => toggleTableSort("companies", "active")}
                      filterValue={tableColumnFilters.companies.active}
                      onFilterChange={(value) => updateTableColumnFilter("companies", "active", value)}
                      filterOptions={TABLE_BOOLEAN_FILTER_OPTIONS}
                    />
                    <th className="p-2">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCompanies.map((c) => (
                    <tr key={c.id} className="border-b">
                      <td className="p-2">{c.id}</td>
                      <td className="p-2">{c.name}</td>
                      <td className="p-2">{c.active ? "Sí" : "No"}</td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-2">
                          <SmallBtn onClick={() => openEdit("companies", c)}>Editar</SmallBtn>
                          <SmallBtn variant="danger" onClick={() => openDelete("companies", c)}>
                            Eliminar
                          </SmallBtn>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="Sin empresas para ese filtro"
              description="Prueba con otro nombre, estado o identificador."
            />
          )}
        </TableCard>
      ) : null}

      {/* PERSONAS */}
      {activeTabAllowed && activeTab === "persons" ? (
        <TableCard
          title="Personas"
          actions={<SmallBtn variant="primary" onClick={() => openCreate("persons")}>Nueva</SmallBtn>}
        >
          <div className="mb-4 flex flex-wrap gap-2">
            <SmallBtn onClick={() => setShowPersonExpiryFilters((current) => !current)}>
              {showPersonExpiryFilters ? "Ocultar filtro de vencimientos" : "Filtrar por vencimientos"}
            </SmallBtn>
            {(personExpiryWindow !== "all" || personExpiryField !== "all") ? (
              <SmallBtn
                onClick={() => {
                  setPersonExpiryWindow("all");
                  setPersonExpiryField("all");
                }}
              >
                Limpiar vencimientos
              </SmallBtn>
            ) : null}
          </div>

          {(personExpirySummary.expired || personExpirySummary.within15) ? (
            <div className="mb-4 rounded-[22px] border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-800">
              {personExpirySummary.expired} personas con documentos vencidos y{" "}
              {personExpirySummary.within15} personas con vencimientos dentro de 15 dias.
            </div>
          ) : null}

          {showPersonExpiryFilters ? (
            <div className="mb-4 rounded-[22px] border border-slate-200 bg-slate-50/90 px-4 py-4">
              <div className="grid gap-3 md:grid-cols-2">
                <SelectField
                  label="Ventana de vencimiento"
                  value={personExpiryWindow}
                  onChange={setPersonExpiryWindow}
                  options={PERSON_EXPIRY_FILTER_OPTIONS}
                  placeholder="Selecciona una ventana"
                />
                <SelectField
                  label="Campo a revisar"
                  value={personExpiryField}
                  onChange={setPersonExpiryField}
                  options={PERSON_EXPIRY_FIELD_OPTIONS}
                  placeholder="Selecciona un campo"
                />
              </div>

              <div className="mt-3 text-sm text-slate-600">
                Mostrando {filteredPersons.length} personas del total de {persons.length}. Con 30 dias,
                el sistema detecta {personExpirySummary.within30} personas con proximos vencimientos.
              </div>
            </div>
          ) : null}

          {filteredPersons.length ? (
            <div className="overflow-auto">
              <table className="tm-data-table min-w-full">
                <thead>
                  <tr className="text-left">
                    <TableHeaderCell
                      label="ID"
                      sortState={tabSort.persons}
                      sortField="id"
                      onToggleSort={() => toggleTableSort("persons", "id")}
                      filterValue={tableColumnFilters.persons.id}
                      onFilterChange={(value) => updateTableColumnFilter("persons", "id", value)}
                      placeholder="ID"
                    />
                    <TableHeaderCell
                      label="Empresa"
                      sortState={tabSort.persons}
                      sortField="company_name"
                      onToggleSort={() => toggleTableSort("persons", "company_name")}
                      filterValue={tableColumnFilters.persons.company_name}
                      onFilterChange={(value) =>
                        updateTableColumnFilter("persons", "company_name", value)
                      }
                      placeholder="Empresa"
                    />
                    <TableHeaderCell
                      label="RUT"
                      sortState={tabSort.persons}
                      sortField="rut"
                      onToggleSort={() => toggleTableSort("persons", "rut")}
                      filterValue={tableColumnFilters.persons.rut}
                      onFilterChange={(value) => updateTableColumnFilter("persons", "rut", value)}
                      placeholder="RUT"
                    />
                    <TableHeaderCell
                      label="Nombre"
                      sortState={tabSort.persons}
                      sortField="full_name"
                      onToggleSort={() => toggleTableSort("persons", "full_name")}
                      filterValue={tableColumnFilters.persons.full_name}
                      onFilterChange={(value) =>
                        updateTableColumnFilter("persons", "full_name", value)
                      }
                      placeholder="Nombre"
                    />
                    <TableHeaderCell
                      label="Rol"
                      sortState={tabSort.persons}
                      sortField="role"
                      onToggleSort={() => toggleTableSort("persons", "role")}
                      filterValue={tableColumnFilters.persons.role}
                      onFilterChange={(value) => updateTableColumnFilter("persons", "role", value)}
                      placeholder="Rol"
                    />
                    <TableHeaderCell
                      label="Ingreso"
                      sortState={tabSort.persons}
                      sortField="entry_type"
                      onToggleSort={() => toggleTableSort("persons", "entry_type")}
                      filterValue={tableColumnFilters.persons.entry_type}
                      onFilterChange={(value) =>
                        updateTableColumnFilter("persons", "entry_type", value)
                      }
                      filterOptions={[{ value: "", label: "Todos" }, ...PERSON_ENTRY_TYPE_OPTIONS]}
                    />
                    <TableHeaderCell
                      label="Tag"
                      sortState={tabSort.persons}
                      sortField="tag_code"
                      onToggleSort={() => toggleTableSort("persons", "tag_code")}
                      filterValue={tableColumnFilters.persons.tag_code}
                      onFilterChange={(value) =>
                        updateTableColumnFilter("persons", "tag_code", value)
                      }
                      placeholder="Tag"
                    />
                    <th className="p-2">Vencimientos</th>
                    <TableHeaderCell
                      label="Activa"
                      sortState={tabSort.persons}
                      sortField="active"
                      onToggleSort={() => toggleTableSort("persons", "active")}
                      filterValue={tableColumnFilters.persons.active}
                      onFilterChange={(value) => updateTableColumnFilter("persons", "active", value)}
                      filterOptions={TABLE_BOOLEAN_FILTER_OPTIONS}
                    />
                    <th className="p-2">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPersons.map((p) => (
                    <tr key={p.id} className="border-b">
                      <td className="p-2">{p.id}</td>
                      <td className="p-2">{p.company_name || "-"}</td>
                      <td className="p-2">{p.rut || "-"}</td>
                      <td className="p-2">
                        <div className="flex min-w-[220px] items-center gap-3">
                          <PersonPhotoAvatar src={p.photo_url} alt={p.full_name} />
                          <div>
                            <div className="font-semibold text-slate-900">{p.full_name}</div>
                            <div className="text-xs text-slate-500">
                              {p.blood_type ? `Grupo ${p.blood_type}` : "Sin foto cargada"}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="p-2">{p.role || "-"}</td>
                      <td className="p-2">
                        <div className="min-w-[140px]">
                          <div className="font-medium text-slate-800">{formatEntryType(p.entry_type)}</div>
                          <div className="text-xs text-slate-500">
                            {p.entry_exp ? `Vence ${String(p.entry_exp).slice(0, 10)}` : "Sin fecha"}
                          </div>
                        </div>
                      </td>
                      <td className="p-2">{p.tag_code || "-"}</td>
                      <td className="p-2">
                        <div className="flex min-w-[250px] flex-wrap gap-2">
                          {getPersonExpiryAlerts(p, 30).length ? (
                            getPersonExpiryAlerts(p, 30).map((alert) => (
                              <ExpiryBadge key={`${p.id}-${alert.key}`} alert={alert} />
                            ))
                          ) : (
                            <span className="text-xs text-emerald-600">Al dia</span>
                          )}
                        </div>
                      </td>
                      <td className="p-2">{p.active ? "Sí" : "No"}</td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-2">
                          <SmallBtn onClick={() => openEdit("persons", p)}>Editar</SmallBtn>
                          <SmallBtn variant="danger" onClick={() => openDelete("persons", p)}>
                            Eliminar
                          </SmallBtn>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="Sin personas para ese filtro"
              description="Prueba con otro nombre, RUT, empresa, rol, tag o filtro de vencimientos."
            />
          )}
        </TableCard>
      ) : null}

      {/* EQUIPOS */}
      {activeTabAllowed && activeTab === "equipment" ? (
        <TableCard
          title="Equipos"
          actions={<SmallBtn variant="primary" onClick={() => openCreate("equipment")}>Nuevo</SmallBtn>}
        >
          {filteredEquipment.length ? (
            <div className="overflow-auto">
              <table className="tm-data-table min-w-full">
                <thead>
                  <tr className="text-left">
                    <TableHeaderCell
                      label="ID"
                      sortState={tabSort.equipment}
                      sortField="id"
                      onToggleSort={() => toggleTableSort("equipment", "id")}
                      filterValue={tableColumnFilters.equipment.id}
                      onFilterChange={(value) => updateTableColumnFilter("equipment", "id", value)}
                      placeholder="ID"
                    />
                    <TableHeaderCell
                      label="Empresa"
                      sortState={tabSort.equipment}
                      sortField="company_name"
                      onToggleSort={() => toggleTableSort("equipment", "company_name")}
                      filterValue={tableColumnFilters.equipment.company_name}
                      onFilterChange={(value) =>
                        updateTableColumnFilter("equipment", "company_name", value)
                      }
                      placeholder="Empresa"
                    />
                    <TableHeaderCell
                      label="Nombre"
                      sortState={tabSort.equipment}
                      sortField="name"
                      onToggleSort={() => toggleTableSort("equipment", "name")}
                      filterValue={tableColumnFilters.equipment.name}
                      onFilterChange={(value) => updateTableColumnFilter("equipment", "name", value)}
                      placeholder="Nombre"
                    />
                    <TableHeaderCell
                      label="Tipo"
                      sortState={tabSort.equipment}
                      sortField="type"
                      onToggleSort={() => toggleTableSort("equipment", "type")}
                      filterValue={tableColumnFilters.equipment.type}
                      onFilterChange={(value) => updateTableColumnFilter("equipment", "type", value)}
                      placeholder="Tipo"
                    />
                    <TableHeaderCell
                      label="Activa"
                      sortState={tabSort.equipment}
                      sortField="active"
                      onToggleSort={() => toggleTableSort("equipment", "active")}
                      filterValue={tableColumnFilters.equipment.active}
                      onFilterChange={(value) =>
                        updateTableColumnFilter("equipment", "active", value)
                      }
                      filterOptions={TABLE_BOOLEAN_FILTER_OPTIONS}
                    />
                    <th className="p-2">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEquipment.map((e) => (
                    <tr key={e.id} className="border-b">
                      <td className="p-2">{e.id}</td>
                      <td className="p-2">{e.company_name || "-"}</td>
                      <td className="p-2">{e.name}</td>
                      <td className="p-2">{e.type || "-"}</td>
                      <td className="p-2">{e.active ? "Sí" : "No"}</td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-2">
                          <SmallBtn onClick={() => openEdit("equipment", e)}>Editar</SmallBtn>
                          <SmallBtn variant="danger" onClick={() => openDelete("equipment", e)}>
                            Eliminar
                          </SmallBtn>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="Sin equipos para ese filtro"
              description="Prueba con otro nombre, tipo, empresa o identificador."
            />
          )}
        </TableCard>
      ) : null}

            {/* PORTICOS */}
      {activeTabAllowed && activeTab === "porticos" ? (
        <TableCard title="Pórticos" actions={<SmallBtn variant="primary" onClick={() => openCreate("porticos")}>Nuevo</SmallBtn>}>
          {filteredPorticos.length ? (
            <div className="overflow-auto">
              <table className="tm-data-table min-w-full">
                <thead>
                  <tr className="text-left">
                    <TableHeaderCell
                      label="ID"
                      sortState={tabSort.porticos}
                      sortField="id"
                      onToggleSort={() => toggleTableSort("porticos", "id")}
                      filterValue={tableColumnFilters.porticos.id}
                      onFilterChange={(value) => updateTableColumnFilter("porticos", "id", value)}
                      placeholder="ID"
                    />
                    <TableHeaderCell
                      label="Nombre"
                      sortState={tabSort.porticos}
                      sortField="name"
                      onToggleSort={() => toggleTableSort("porticos", "name")}
                      filterValue={tableColumnFilters.porticos.name}
                      onFilterChange={(value) => updateTableColumnFilter("porticos", "name", value)}
                      placeholder="Nombre"
                    />
                    <TableHeaderCell
                      label="Tipo"
                      sortState={tabSort.porticos}
                      sortField="operating_mode"
                      onToggleSort={() => toggleTableSort("porticos", "operating_mode")}
                      filterValue={tableColumnFilters.porticos.operating_mode}
                      onFilterChange={(value) => updateTableColumnFilter("porticos", "operating_mode", value)}
                      filterOptions={[{ value: "", label: "Todos" }, ...PORTICO_MODE_OPTIONS]}
                    />
                    <th className="p-2">Antenas</th>
                    <TableHeaderCell
                      label="Zona"
                      sortState={tabSort.porticos}
                      sortField="zone"
                      onToggleSort={() => toggleTableSort("porticos", "zone")}
                      filterValue={tableColumnFilters.porticos.zone}
                      onFilterChange={(value) => updateTableColumnFilter("porticos", "zone", value)}
                      placeholder="Zona"
                    />
                    <TableHeaderCell
                      label="Nivel"
                      sortState={tabSort.porticos}
                      sortField="nivel"
                      onToggleSort={() => toggleTableSort("porticos", "nivel")}
                      filterValue={tableColumnFilters.porticos.nivel}
                      onFilterChange={(value) => updateTableColumnFilter("porticos", "nivel", value)}
                      placeholder="Nivel"
                    />
                    <TableHeaderCell
                      label="Reader"
                      sortState={tabSort.porticos}
                      sortField="gateway_name"
                      onToggleSort={() => toggleTableSort("porticos", "gateway_name")}
                      filterValue={tableColumnFilters.porticos.gateway_name}
                      onFilterChange={(value) => updateTableColumnFilter("porticos", "gateway_name", value)}
                      placeholder="Reader"
                    />
                    <TableHeaderCell
                      label="Mapa"
                      sortState={tabSort.porticos}
                      sortField="map_code"
                      onToggleSort={() => toggleTableSort("porticos", "map_code")}
                      filterValue={tableColumnFilters.porticos.map_code}
                      onFilterChange={(value) => updateTableColumnFilter("porticos", "map_code", value)}
                      placeholder="Mapa"
                    />
                    <th className="p-2">Posición</th>
                    <TableHeaderCell
                      label="Activa"
                      sortState={tabSort.porticos}
                      sortField="active"
                      onToggleSort={() => toggleTableSort("porticos", "active")}
                      filterValue={tableColumnFilters.porticos.active}
                      onFilterChange={(value) => updateTableColumnFilter("porticos", "active", value)}
                      filterOptions={TABLE_BOOLEAN_FILTER_OPTIONS}
                    />
                    <th className="p-2">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPorticos.map((p) => (
                    <tr key={p.id} className="border-b">
                      <td className="p-2">{p.id}</td>
                      <td className="p-2">{p.name}</td>
                      <td className="p-2">{formatPorticoMode(p.operating_mode)}</td>
                      <td className="p-2">
                        {String((p.operating_mode || "").toUpperCase()) === "ACCESS"
                          ? `${p.antenna_in_port ?? 1} / ${p.antenna_out_port ?? 2}`
                          : `Antena ${p.antenna_in_port ?? 1}`}
                      </td>
                      <td className="p-2">{p.zone || "-"}</td>
                      <td className="p-2">{p.nivel ?? "-"}</td>
                      <td className="p-2">
                        <div className="font-medium text-slate-800">{p.gateway_name || "-"}</div>
                        <div className="text-xs text-slate-500">{p.specific_name || "-"}</div>
                      </td>
                      <td className="p-2">{p.map_code || "-"}</td>
                      <td className="p-2">{p.x_pct != null && p.y_pct != null ? `${p.x_pct}, ${p.y_pct}` : "-"}</td>
                      <td className="p-2">{p.active ? "Si" : "No"}</td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-2">
                          <SmallBtn onClick={() => setPorticoEdit(p)}>Editar</SmallBtn>
                          <SmallBtn onClick={() => openEdit("porticos", p)}>Editar datos</SmallBtn>
                          <SmallBtn variant="danger" onClick={() => openDelete("porticos", p)}>
                            Eliminar
                          </SmallBtn>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="Sin pórticos para ese filtro"
              description="Prueba con otra zona, nombre, gateway, mapa o nivel."
            />
          )}
        </TableCard>
      ) : null}

            {/* TAGS */}
      {activeTabAllowed && activeTab === "tags" ? (
        <TableCard title="Tags (RFID)" actions={<SmallBtn variant="primary" onClick={() => openCreate("tags")}>Nuevo</SmallBtn>}>
          <div className="mb-5 rounded-[24px] border border-slate-200 bg-slate-50/80 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">Lecturas RFID recientes</div>
                <div className="mt-1 text-sm text-slate-600">
                  Ranking operativo del reader por intensidad de señal. Un RSSI más alto
                  y menos negativo suele significar que ese tag está más cerca de la antena.
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                  Ventana 60s
                </span>
                <SmallBtn onClick={() => loadRfidProximity()}>Refrescar</SmallBtn>
              </div>
            </div>

            {rfidProximityError ? (
              <div className="mt-4 rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {rfidProximityError}
              </div>
            ) : null}

            {rfidProximityRows.length ? (
              <div className="mt-4 overflow-auto">
                <table className="tm-data-table min-w-full">
                  <thead>
                    <tr className="text-left">
                      <th className="p-2">Tag / EPC</th>
                      <th className="p-2">Asignado a</th>
                      <th className="p-2">Reader / Antena</th>
                      <th className="p-2">Señal</th>
                      <th className="p-2">Cercanía estimada</th>
                      <th className="p-2">Última lectura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rfidProximityRows.map((row) => (
                      <tr key={`${row.tag_id}-${row.last_seen_at || ""}`} className="border-b">
                        <td className="p-2">
                          <div className="font-mono text-sm font-semibold text-slate-900">{row.tag_code}</div>
                          <div className="text-xs text-slate-500">
                            {row.sample_count} lecturas en ventana
                          </div>
                        </td>
                        <td className="p-2">
                          <div className="font-medium text-slate-800">{row.assigned_to || "Sin asignación"}</div>
                          <div className="text-xs text-slate-500">
                            {row.entity_type || "tag libre"}
                          </div>
                        </td>
                        <td className="p-2">
                          <div className="font-medium text-slate-800">{row.reader_code || "-"}</div>
                          <div className="text-xs text-slate-500">
                            {row.antenna_port != null
                              ? `Antena ${row.antenna_port}${row.portico_name ? ` · ${row.portico_name}` : ""}`
                              : (row.portico_name || row.antenna_name || "-")}
                          </div>
                        </td>
                        <td className="p-2">
                          <div className="font-semibold text-slate-900">
                            {formatRfidRssi(row.strongest_rssi)}
                          </div>
                          <div className="text-xs text-slate-500">
                            actual {formatRfidRssi(row.latest_rssi)}
                          </div>
                        </td>
                        <td className="p-2">
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${rfidProximityClasses(row.proximity_hint)}`}>
                            {row.proximity_hint}
                          </span>
                        </td>
                        <td className="p-2">
                          <div className="font-medium text-slate-800">{formatSecondsAgo(row.seconds_since_last_seen)}</div>
                          <div className="text-xs text-slate-500">{formatDateTime(row.last_seen_at)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-4">
                <EmptyState
                  title={rfidProximityLoading ? "Buscando lecturas RFID..." : "Sin lecturas RFID recientes"}
                  description="Cuando el reader esté leyendo tags, aquí verás los EPC más cercanos estimados por señal."
                />
              </div>
            )}
          </div>

          {filteredTags.length ? (
            <div className="overflow-auto">
              <table className="tm-data-table min-w-full">
                <thead>
                  <tr className="text-left">
                    <TableHeaderCell
                      label="ID"
                      sortState={tabSort.tags}
                      sortField="id"
                      onToggleSort={() => toggleTableSort("tags", "id")}
                      filterValue={tableColumnFilters.tags.id}
                      onFilterChange={(value) => updateTableColumnFilter("tags", "id", value)}
                      placeholder="ID"
                    />
                    <TableHeaderCell
                      label="Código"
                      sortState={tabSort.tags}
                      sortField="code"
                      onToggleSort={() => toggleTableSort("tags", "code")}
                      filterValue={tableColumnFilters.tags.code}
                      onFilterChange={(value) => updateTableColumnFilter("tags", "code", value)}
                      placeholder="Código"
                    />
                    <TableHeaderCell
                      label="Descripción"
                      sortState={tabSort.tags}
                      sortField="description"
                      onToggleSort={() => toggleTableSort("tags", "description")}
                      filterValue={tableColumnFilters.tags.description}
                      onFilterChange={(value) => updateTableColumnFilter("tags", "description", value)}
                      placeholder="Descripción"
                    />
                    <TableHeaderCell
                      label="Asignado a"
                      sortState={tabSort.tags}
                      sortField="assigned_to"
                      onToggleSort={() => toggleTableSort("tags", "assigned_to")}
                      filterValue={tableColumnFilters.tags.assigned_to}
                      onFilterChange={(value) => updateTableColumnFilter("tags", "assigned_to", value)}
                      placeholder="Asignado"
                    />
                    <TableHeaderCell
                      label="Activa"
                      sortState={tabSort.tags}
                      sortField="active"
                      onToggleSort={() => toggleTableSort("tags", "active")}
                      filterValue={tableColumnFilters.tags.active}
                      onFilterChange={(value) => updateTableColumnFilter("tags", "active", value)}
                      filterOptions={TABLE_BOOLEAN_FILTER_OPTIONS}
                    />
                    <th className="p-2">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTags.map((t) => (
                    <tr key={t.id} className="border-b">
                      <td className="p-2">{String(t.id).slice(0, 8)}...</td>
                      <td className="p-2 font-mono">{t.code}</td>
                      <td className="p-2">{t.description || "-"}</td>
                      <td className="p-2">{t.assigned_to || "-"}</td>
                      <td className="p-2">{t.active ? "Si" : "No"}</td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-2">
                          <SmallBtn onClick={() => openEdit("tags", t)}>Editar</SmallBtn>
                          <SmallBtn onClick={() => openEdit("tagAssign", t)}>Asignar</SmallBtn>
                          <SmallBtn variant="danger" onClick={() => openDelete("tags", t)}>
                            Eliminar
                          </SmallBtn>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="Sin tags para ese filtro"
              description="Prueba con otro código, descripción, estado o asignación."
            />
          )}
        </TableCard>
      ) : null}

            {/* VEHICULOS */}
      {activeTabAllowed && activeTab === "vehicles" ? (
        <TableCard title="Vehículos" actions={<SmallBtn variant="primary" onClick={() => openCreate("vehicles")}>Nuevo</SmallBtn>}>
          {filteredVehicles.length ? (
            <div className="overflow-auto">
              <table className="tm-data-table min-w-full">
                <thead>
                  <tr className="text-left">
                    <TableHeaderCell
                      label="ID"
                      sortState={tabSort.vehicles}
                      sortField="id"
                      onToggleSort={() => toggleTableSort("vehicles", "id")}
                      filterValue={tableColumnFilters.vehicles.id}
                      onFilterChange={(value) => updateTableColumnFilter("vehicles", "id", value)}
                      placeholder="ID"
                    />
                    <TableHeaderCell
                      label="Patente"
                      sortState={tabSort.vehicles}
                      sortField="patente"
                      onToggleSort={() => toggleTableSort("vehicles", "patente")}
                      filterValue={tableColumnFilters.vehicles.patente}
                      onFilterChange={(value) => updateTableColumnFilter("vehicles", "patente", value)}
                      placeholder="Patente"
                    />
                    <TableHeaderCell
                      label="Empresa"
                      sortState={tabSort.vehicles}
                      sortField="company_name"
                      onToggleSort={() => toggleTableSort("vehicles", "company_name")}
                      filterValue={tableColumnFilters.vehicles.company_name}
                      onFilterChange={(value) => updateTableColumnFilter("vehicles", "company_name", value)}
                      placeholder="Empresa"
                    />
                    <TableHeaderCell
                      label="Descripción"
                      sortState={tabSort.vehicles}
                      sortField="descripcion"
                      onToggleSort={() => toggleTableSort("vehicles", "descripcion")}
                      filterValue={tableColumnFilters.vehicles.descripcion}
                      onFilterChange={(value) => updateTableColumnFilter("vehicles", "descripcion", value)}
                      placeholder="Descripción"
                    />
                    <TableHeaderCell
                      label="Tag"
                      sortState={tabSort.vehicles}
                      sortField="tag_code"
                      onToggleSort={() => toggleTableSort("vehicles", "tag_code")}
                      filterValue={tableColumnFilters.vehicles.tag_code}
                      onFilterChange={(value) => updateTableColumnFilter("vehicles", "tag_code", value)}
                      placeholder="Tag"
                    />
                    <TableHeaderCell
                      label="Activa"
                      sortState={tabSort.vehicles}
                      sortField="status"
                      onToggleSort={() => toggleTableSort("vehicles", "status")}
                      filterValue={tableColumnFilters.vehicles.status}
                      onFilterChange={(value) => updateTableColumnFilter("vehicles", "status", value)}
                      filterOptions={TABLE_BOOLEAN_FILTER_OPTIONS}
                    />
                    <th className="p-2">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVehicles.map((v) => (
                    <tr key={v.id} className="border-b">
                      <td className="p-2">{v.id}</td>
                      <td className="p-2 font-mono">{v.patente}</td>
                      <td className="p-2">{v.company_name || "-"}</td>
                      <td className="p-2">{v.descripcion || "-"}</td>
                      <td className="p-2">{v.tag_code || "-"}</td>
                      <td className="p-2">{v.status ? "Si" : "No"}</td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-2">
                          <SmallBtn onClick={() => openEdit("vehicles", v)}>Editar</SmallBtn>
                          <SmallBtn variant="danger" onClick={() => openDelete("vehicles", v)}>
                            Eliminar
                          </SmallBtn>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="Sin vehículos para ese filtro"
              description="Prueba con otra patente, empresa, tag o descripción."
            />
          )}
        </TableCard>
      ) : null}

            {/* CAMARAS */}
      {activeTabAllowed && activeTab === "cameras" ? (
        <TableCard
          title="NOC · cámaras, portones y ventiladores"
          actions={
            <SmallBtn variant="primary" onClick={openCameraCreate}>
              Nuevo dispositivo NOC
            </SmallBtn>
          }
        >
          <div className="mb-5 rounded-[24px] border border-slate-200 bg-slate-50/90 px-4 py-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-3xl">
                <div className="text-sm font-semibold text-slate-900">
                  Monitoreo NOC y ping de dispositivos
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  Este valor unifica la frecuencia del chequeo IP/TCP del backend, el TTL operativo
                  del estado y el auto-refresh del módulo NOC en frontend para cámaras, portones y ventiladores.
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <SmallBtn
                  onClick={() =>
                    setCameraMonitoringIntervalInput(
                      String(DEFAULT_CAMERA_MONITORING_SETTINGS.refresh_interval_seconds),
                    )
                  }
                >
                  Usar 30s
                </SmallBtn>
                <SmallBtn
                  variant="primary"
                  onClick={saveCameraMonitoringSettings}
                  disabled={cameraMonitoringSaving}
                >
                  {cameraMonitoringSaving ? "Guardando..." : "Guardar monitoreo"}
                </SmallBtn>
              </div>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
              <TextField
                label="Intervalo unificado (segundos)"
                type="number"
                min={cameraMonitoringSettings.min_seconds}
                max={cameraMonitoringSettings.max_seconds}
                step="1"
                value={cameraMonitoringIntervalInput}
                onChange={setCameraMonitoringIntervalInput}
                placeholder="30"
              />

              <div className="rounded-[20px] border border-slate-200 bg-white/92 px-4 py-4 text-sm text-slate-600 shadow-sm">
                <div>
                  Rango permitido: {cameraMonitoringSettings.min_seconds}s a{" "}
                  {cameraMonitoringSettings.max_seconds}s.
                </div>
                <div className="mt-2">
                  Valor activo:{" "}
                  <span className="font-semibold text-slate-900">
                    {cameraMonitoringSettings.refresh_interval_seconds}s
                  </span>
                </div>
                <div className="mt-2">
                  {cameraMonitoringSettings.updated_at
                    ? `Última actualización: ${formatDateTime(cameraMonitoringSettings.updated_at)}`
                    : "Usando valor base del sistema."}
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-auto">
            {filteredCameras.length ? (
              <table className="tm-data-table min-w-full">
                <thead>
                  <tr className="text-left">
                    <TableHeaderCell
                      label="ID"
                      sortState={tabSort.cameras}
                      sortField="id"
                      onToggleSort={() => toggleTableSort("cameras", "id")}
                      filterValue={tableColumnFilters.cameras.id}
                      onFilterChange={(value) => updateTableColumnFilter("cameras", "id", value)}
                      placeholder="ID"
                    />
                    <TableHeaderCell
                      label="Dispositivo"
                      sortState={tabSort.cameras}
                      sortField="device_kind"
                      onToggleSort={() => toggleTableSort("cameras", "device_kind")}
                      filterValue={tableColumnFilters.cameras.device_kind}
                      onFilterChange={(value) => updateTableColumnFilter("cameras", "device_kind", value)}
                      placeholder="Cámara / Portón / Ventilador"
                    />
                    <TableHeaderCell
                      label="Nombre"
                      sortState={tabSort.cameras}
                      sortField="name"
                      onToggleSort={() => toggleTableSort("cameras", "name")}
                      filterValue={tableColumnFilters.cameras.name}
                      onFilterChange={(value) => updateTableColumnFilter("cameras", "name", value)}
                      placeholder="Nombre"
                    />
                    <TableHeaderCell
                      label="Tipo"
                      sortState={tabSort.cameras}
                      sortField="source_type"
                      onToggleSort={() => toggleTableSort("cameras", "source_type")}
                      filterValue={tableColumnFilters.cameras.source_type}
                      onFilterChange={(value) => updateTableColumnFilter("cameras", "source_type", value)}
                      placeholder="Tipo"
                    />
                    <TableHeaderCell
                      label="Origen"
                      sortState={tabSort.cameras}
                      sortField="source"
                      onToggleSort={() => toggleTableSort("cameras", "source")}
                      filterValue={tableColumnFilters.cameras.source}
                      onFilterChange={(value) => updateTableColumnFilter("cameras", "source", value)}
                      placeholder="IP / URL"
                    />
                    <TableHeaderCell
                      label="Mapa"
                      sortState={tabSort.cameras}
                      sortField="map_preferred"
                      onToggleSort={() => toggleTableSort("cameras", "map_preferred")}
                      filterValue={tableColumnFilters.cameras.map_preferred}
                      onFilterChange={(value) => updateTableColumnFilter("cameras", "map_preferred", value)}
                      placeholder="Mapa"
                    />
                    <TableHeaderCell
                      label="NOC"
                      sortState={tabSort.cameras}
                      sortField="nok_number"
                      onToggleSort={() => toggleTableSort("cameras", "nok_number")}
                      filterValue={tableColumnFilters.cameras.nok_number}
                      onFilterChange={(value) => updateTableColumnFilter("cameras", "nok_number", value)}
                      placeholder="Número NOC"
                    />
                    <TableHeaderCell
                      label="Activa"
                      sortState={tabSort.cameras}
                      sortField="is_active"
                      onToggleSort={() => toggleTableSort("cameras", "is_active")}
                      filterValue={tableColumnFilters.cameras.is_active}
                      onFilterChange={(value) => updateTableColumnFilter("cameras", "is_active", value)}
                      filterOptions={TABLE_BOOLEAN_FILTER_OPTIONS}
                    />
                    <th className="p-2">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCameras.map((camera) => (
                    (() => {
                      const hasNokAltMap = hasCameraNokAltMap(camera);
                      const preferredMapCode = getCameraPreferredMapCode(camera);
                      const baseMapCode = getCameraBaseMapCode(camera);
                      const preferredCoords = getCameraPreferredCoordinates(camera);
                      const preferredNokNumber = getCameraPreferredNokNumber(camera);
                      const preferredNokDisplayName = getCameraPreferredNokDisplayName(camera);

                      return (
                        <tr key={camera.id} className="border-b align-top">
                          <td className="p-2">{camera.id}</td>
                          <td className="p-2">
                            <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                              {camera.device_kind_label || getNocDeviceKindLabel(camera.device_kind)}
                            </span>
                          </td>
                          <td className="p-2">
                            <div className="font-semibold text-slate-800">{camera.name}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {[camera.site, camera.nivel].filter(Boolean).join(" / ") || "Sin sitio"}
                            </div>
                          </td>
                          <td className="p-2">{camera.source_type_label || camera.source_type}</td>
                          <td className="p-2">
                            <div className="max-w-[320px] break-all text-xs text-slate-600">
                              {camera.resolved_source || camera.source || "-"}
                            </div>
                          </td>
                          <td className="p-2">
                            <div className="text-sm text-slate-700">
                              {hasNokAltMap
                                ? `NOC: ${getCameraMapLabel(preferredMapCode)}`
                                : getCameraMapLabel(preferredMapCode)}
                            </div>
                            {hasNokAltMap ? (
                              <div className="mt-1 text-xs text-slate-500">
                                Base: {getCameraMapLabel(baseMapCode)}
                              </div>
                            ) : null}
                            <div className="mt-1 text-xs text-slate-500">
                              {preferredCoords.x != null && preferredCoords.y != null
                                ? `${hasNokAltMap ? "NOC " : ""}x ${preferredCoords.x} / y ${preferredCoords.y}`
                                : "Sin coordenadas"}
                            </div>
                          </td>
                          <td className="p-2">
                            <div className="text-sm font-semibold text-slate-700">
                              {camera.nok_enabled ? "Si" : "No"}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              {camera.nok_enabled
                                ? `#${preferredNokNumber || "-"} ${preferredNokDisplayName}`.trim()
                                : "Oculta en NOC"}
                            </div>
                            {hasNokAltMap ? (
                              <div className="mt-1 text-[11px] font-medium text-sky-600">
                                Plano NOC alterno activo
                              </div>
                            ) : null}
                          </td>
                          <td className="p-2">{camera.is_active ? "Si" : "No"}</td>
                          <td className="p-2">
                            <div className="flex flex-wrap gap-2">
                              <SmallBtn onClick={() => openCameraView(camera)}>Ver</SmallBtn>
                              <SmallBtn onClick={() => openCameraEdit(camera)}>Editar</SmallBtn>
                              <SmallBtn variant="danger" onClick={() => openDelete("cameras", camera)}>
                                Eliminar
                              </SmallBtn>
                            </div>
                          </td>
                        </tr>
                      );
                    })()
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState
                title="Sin dispositivos NOC para ese filtro"
                description="Prueba con otro nombre, tipo de dispositivo, host o mapa."
              />
            )}
          </div>
        </TableCard>
      ) : null}

      {/* FUENTES EXTERNAS */}
      {activeTabAllowed && activeTab === "externalSources" ? (
        <TableCard
          title="Fuentes externas"
          actions={
            <div className="flex flex-wrap gap-2">
              <SmallBtn
                onClick={() =>
                  setExternalSources(normalizeExternalSources(DEFAULT_EXTERNAL_SOURCES))
                }
              >
                Restaurar defaults
              </SmallBtn>
              <SmallBtn
                variant="primary"
                onClick={saveExternalSources}
                disabled={externalSourcesSaving}
              >
                {externalSourcesSaving ? "Guardando..." : "Guardar URLs"}
              </SmallBtn>
            </div>
          }
        >
          <div className="rounded-[22px] border border-slate-200 bg-slate-50/90 px-4 py-4">
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                label="URL semaforos control vial"
                value={externalSourceView.control_vial_url || ""}
                onChange={(value) =>
                  setExternalSources((current) => ({ ...current, control_vial_url: value }))
                }
                placeholder="http://devtm.denial.cl:19091/"
              />
            </div>

            <div className="mt-3 text-sm text-slate-600">
              Estas URLs alimentan los iframes de los módulos operacionales. Deben ser rutas
              absolutas `http` o `https`.
            </div>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            {(externalSourceView.items || EXTERNAL_SOURCE_DEFINITIONS).map((item) => (
              <div
                key={item.key}
                className="rounded-[24px] border border-slate-200 bg-white/92 px-5 py-5 shadow-[0_16px_30px_rgba(15,23,42,0.06)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{item.label}</div>
                    <div className="mt-1 text-sm text-slate-500">{item.description}</div>
                  </div>

                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-xl border border-slate-200 bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-700"
                  >
                    Abrir
                  </a>
                </div>

                <div className="mt-4 rounded-[18px] border border-slate-200 bg-slate-50/80 px-3 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    URL activa
                  </div>
                  <div className="mt-2 break-all text-sm text-slate-800">{item.url}</div>
                  <div className="mt-2 text-xs text-slate-400">
                    {item.updated_at
                      ? `Actualizada: ${String(item.updated_at).slice(0, 19).replace("T", " ")}`
                      : "Usando valor base del sistema"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </TableCard>
      ) : null}

      {activeTabAllowed && activeTab === "porticosListener" ? (
        <TableCard
          title="Configuración pórticos · TMONE Alive"
          actions={<a href="http://localhost:8090/" target="_blank" rel="noreferrer" className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white">Abrir listener</a>}
        >
          <div className="rounded-[22px] border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900">
            Estado vivo de receiver/sender, diagnósticos y parámetros del firmware. El acceso al listener requiere un usuario administrador.
          </div>
          <iframe title="TMONE Listener" src="http://localhost:8090/" className="mt-4 h-[760px] w-full rounded-[18px] border border-slate-200 bg-white" />
        </TableCard>
      ) : null}

      {activeTabAllowed && activeTab === "productionModule" ? <ProductionConfigPanel /> : null}

      {activeTabAllowed && activeTab === "usersPermissions" ? <UserPermissionsAdminPanel /> : null}
      {activeTabAllowed && activeTab === "updates" ? <UpdatesPanel /> : null}

      {/* Modals */}
      <Modal
        open={cameraEditor.open}
        title={
          cameraEditor.mode === "view" && cameraEditor.item?.id
            ? `Ver dispositivo NOC #${cameraEditor.item.id}`
            : cameraEditor.mode === "edit" && cameraEditor.item?.id
            ? `Editar dispositivo NOC #${cameraEditor.item.id}`
            : "Nuevo dispositivo NOC"
        }
        onClose={closeCameraEditor}
        maxWidthClass="max-w-6xl"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="text-xs text-slate-500">
              Configura tipo de dispositivo NOC, conectividad IP y su punto en el mapa.
            </div>
            {cameraEditor.item?.id && cameraEditor.item?.device_kind === "camera" ? (
              <a
                href={`/cameras/ver?cam=${encodeURIComponent(cameraEditor.item.id)}`}
                className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                Abrir cámara
              </a>
            ) : null}
          </div>

          {cameraFormError ? (
            <div className="rounded-[18px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {cameraFormError}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <SelectField
              label="Tipo de dispositivo NOC"
              value={cameraEditor.item.device_kind}
              onChange={(value) => updateCameraEditorField("device_kind", value)}
              options={NOC_DEVICE_KIND_OPTIONS}
              placeholder="Selecciona un tipo"
              disabled={cameraEditor.mode === "view"}
            />
            <TextField
              label="Nombre"
              value={cameraEditor.item.name}
              onChange={(value) => updateCameraEditorField("name", value)}
              placeholder="Ej: Cámara rampa norte / Portón acceso 1 / Ventilador sala"
              disabled={cameraEditor.mode === "view"}
            />
            <SelectField
              label="Tipo de fuente"
              value={cameraEditor.item.source_type}
              onChange={(value) => updateCameraEditorField("source_type", value)}
              options={CAMERA_SOURCE_TYPE_OPTIONS}
              placeholder="Selecciona un tipo"
              disabled={cameraEditor.mode === "view"}
            />
            <TextField
              label={cameraEditor.item.source_type === "video_file" ? "Ruta del video" : "URL completa (opcional)"}
              value={cameraEditor.item.source}
              onChange={(value) => updateCameraEditorField("source", value)}
              placeholder={
                cameraEditor.item.source_type === "video_file"
                  ? "/videos/1.mp4"
                  : cameraEditor.item.source_type === "rtsp"
                  ? "rtsp://ip/path"
                  : "http://host/path"
              }
              disabled={cameraEditor.mode === "view"}
            />
            <TextField
              label="IP / host"
              value={cameraEditor.item.camera_ip}
              onChange={(value) => updateCameraEditorField("camera_ip", value)}
              placeholder="Ej: 192.168.1.20 o dominio"
              disabled={cameraEditor.mode === "view"}
            />
            <TextField
              label="Puerto"
              value={cameraEditor.item.camera_port}
              onChange={(value) => updateCameraEditorField("camera_port", value)}
              type="number"
              placeholder="554 / 80 / 443"
              disabled={cameraEditor.mode === "view"}
            />
            <TextField
              label="Path / endpoint"
              value={cameraEditor.item.camera_path}
              onChange={(value) => updateCameraEditorField("camera_path", value)}
              placeholder="stream1 o carpeta/video.m3u8"
              disabled={cameraEditor.mode === "view"}
            />
            <TextField
              label="Usuario"
              value={cameraEditor.item.camera_user}
              onChange={(value) => updateCameraEditorField("camera_user", value)}
              placeholder="admin"
              disabled={cameraEditor.mode === "view"}
            />
            <TextField
              label="Clave"
              value={cameraEditor.item.camera_password}
              onChange={(value) => updateCameraEditorField("camera_password", value)}
              type="password"
              placeholder="Clave RTSP / HTTP"
              disabled={cameraEditor.mode === "view"}
            />
            <TextField
              label="Sitio"
              value={cameraEditor.item.site}
              onChange={(value) => updateCameraEditorField("site", value)}
              placeholder="Diamante - NP"
              disabled={cameraEditor.mode === "view"}
            />
            <TextField
              label="Nivel"
              value={cameraEditor.item.nivel}
              onChange={(value) => updateCameraEditorField("nivel", value)}
              placeholder="NP / NTI"
              disabled={cameraEditor.mode === "view"}
            />
            <SelectField
              label="Mapa"
              value={cameraEditor.item.map_code}
              onChange={(value) => updateCameraEditorField("map_code", value)}
              options={CAMERA_MAP_OPTIONS}
              placeholder="Selecciona mapa"
              disabled={cameraEditor.mode === "view"}
            />
            {cameraEditor.item.position_mode === "nok_alt" ? (
              <div className="md:col-span-2 -mt-2 text-xs text-slate-500">
                Editando la ubicacion NOC alterna del plano. La ubicacion base del mapa principal se conserva.
              </div>
            ) : null}
            <div className="md:col-span-2">
              <ToggleField
                label="Visible en NOC"
                checked={Boolean(cameraEditor.item.nok_enabled)}
                onChange={(value) => updateCameraEditorField("nok_enabled", value)}
                disabled={cameraEditor.mode === "view"}
              />
            </div>
            <TextField
              label="Número NOC en plano"
              value={cameraEditor.item.nok_map_number}
              onChange={(value) => updateCameraEditorField("nok_map_number", value)}
              type="number"
              placeholder="Ej: 45"
              disabled={cameraEditor.mode === "view"}
            />
            <TextField
              label="Nombre visible NOC"
              value={cameraEditor.item.nok_display_name}
              onChange={(value) => updateCameraEditorField("nok_display_name", value)}
              placeholder="Ej: DIA PETROLERA SOC ACC"
              disabled={cameraEditor.mode === "view"}
            />
            <div className="md:col-span-2">
              <ToggleField
                label="Fuente activa"
                checked={Boolean(cameraEditor.item.is_active)}
                onChange={(value) => updateCameraEditorField("is_active", value)}
                disabled={cameraEditor.mode === "view"}
              />
            </div>
          </div>

          <CameraPositionEditor
            item={cameraEditor.item}
            disabled={cameraEditor.mode === "view"}
            onFieldChange={updateCameraEditorField}
          />

          <div>
            <label className="block">
              <FieldShell label="Notas">
                <textarea
                  className="tm-control min-h-[90px]"
                  rows={4}
                  value={cameraEditor.item.notes}
                  placeholder="Uso operacional, orientacion, observaciones o detalles de conectividad."
                  disabled={cameraEditor.mode === "view"}
                  onChange={(event) => updateCameraEditorField("notes", event.target.value)}
                />
              </FieldShell>
            </label>
          </div>

          <div className="rounded-[20px] border border-slate-200 bg-white px-4 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Preview de origen
            </div>
            <div className="mt-2 break-all text-sm text-slate-700">
              {buildCameraSourcePreview(cameraEditor.item) || "Completa URL o host/path para construir la fuente."}
            </div>
          </div>

          {cameraProbe.detail ? (
            <div
              className={`rounded-[18px] border px-3 py-2 text-sm ${
                cameraProbe.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-800"
              }`}
            >
              {cameraProbe.detail}
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            <SmallBtn onClick={closeCameraEditor} disabled={cameraSaving}>
              Cerrar
            </SmallBtn>
            {cameraEditor.mode === "view" && cameraEditor.item?.id ? (
              <SmallBtn onClick={() => openCameraEdit(cameraEditor.item)}>
                Editar
              </SmallBtn>
            ) : null}
            {cameraEditor.mode !== "view" && cameraEditor.item?.id ? (
              <SmallBtn
                onClick={() => probeCameraSource(cameraEditor.item.id)}
                disabled={cameraSaving || cameraProbe.loading}
              >
                {cameraProbe.loading
                  ? "Probando..."
                  : cameraEditor.item?.device_kind === "camera"
                  ? "Probar señal"
                  : "Probar conectividad"}
              </SmallBtn>
            ) : null}
            {cameraEditor.mode !== "view" ? (
              <SmallBtn variant="primary" onClick={saveCameraEditor} disabled={cameraSaving}>
                {cameraSaving ? "Guardando..." : cameraEditor.mode === "edit" ? "Guardar cambios" : "Crear dispositivo"}
              </SmallBtn>
            ) : null}
          </div>
        </div>
      </Modal>

      <ConfigModals
        modal={modal}
        setModal={setModal}
        companies={companies}
        companyOptions={companyOptions}
        persons={persons}
        vehicles={vehicles}
        equipment={equipment}
        porticos={porticos}
        tags={tags}
        tagOptions={tagOptions}
        onSaved={loadAll}
      />

      <Modal
        open={confirmDel.open}
        title="Confirmar eliminación"
        onClose={() => {
          if (!deleting) setConfirmDel({ open: false, type: "", item: null });
        }}
      >
        <div className="space-y-4">
          <div className="text-sm text-gray-700">
            ¿Seguro que deseas eliminar <b>{confirmDel.item?.name || confirmDel.item?.full_name || confirmDel.item?.patente || confirmDel.item?.code || `#${confirmDel.item?.id}`}</b>?
            <div className="mt-1 text-xs text-gray-500">El registro se eliminará del sistema y dejará de aparecer en el listado y en los mapas.</div>
          </div>
          {deleteError ? (
            <div className="rounded-[18px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              No se pudo eliminar: {deleteError}
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <SmallBtn
              onClick={() => setConfirmDel({ open: false, type: "", item: null })}
              disabled={deleting}
            >
              Cancelar
            </SmallBtn>
            <SmallBtn
              variant="danger"
              disabled={deleting}
              onClick={async () => {
                setDeleting(true);
                setDeleteError("");
                try {
                  await doDelete(confirmDel.type, confirmDel.item);
                  setConfirmDel({ open: false, type: "", item: null });
                } catch (e) {
                  setDeleteError(String(e.message || e));
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {deleting ? "Eliminando..." : "Eliminar"}
            </SmallBtn>
          </div>
        </div>
      </Modal>

      {porticoEdit ? (
        <PorticoEditModal
          isOpen={!!porticoEdit}
          portico={porticoEdit}
          onClose={() => setPorticoEdit(null)}
          onSaved={async () => {
            setPorticoEdit(null);
            await loadAll();
          }}
        />
      ) : null}

      <AccessDeniedModal
        open={Boolean(blockedResource)}
        resourceLabel={blockedResource || "este recurso"}
        onClose={() => setBlockedResource("")}
      />
      </div>
    </PageShell>
  );
}

function ConfigModals({ modal, setModal, companies, companyOptions, persons, vehicles, equipment, porticos, tags, tagOptions, onSaved }) {
  const { open, type, mode, item } = modal;

  // --------- Companies
  const [companyName, setCompanyName] = useState("");
  const [companyActive, setCompanyActive] = useState(true);

  // --------- Persons
  const [personCompanyId, setPersonCompanyId] = useState("");
  const [personRut, setPersonRut] = useState("");
  const [personFullName, setPersonFullName] = useState("");
  const [personRole, setPersonRole] = useState("");
  const [personActive, setPersonActive] = useState(true);
  const [personTagId, setPersonTagId] = useState("");
  const [personTagAssignmentId, setPersonTagAssignmentId] = useState(null);

  // Person extra
  const [exDriverLicense, setExDriverLicense] = useState("");
  const [exDriverLicenseExp, setExDriverLicenseExp] = useState("");
  const [exMedicalExams, setExMedicalExams] = useState("");
  const [exMedicalExamsExp, setExMedicalExamsExp] = useState("");
  const [exEntryType, setExEntryType] = useState("");
  const [exEntryExp, setExEntryExp] = useState("");
  const [exSiteInduction, setExSiteInduction] = useState("");
  const [exSiteInductionExp, setExSiteInductionExp] = useState("");
  const [exHeightWorkCert, setExHeightWorkCert] = useState("");
  const [exHeightWorkCertExp, setExHeightWorkCertExp] = useState("");
  const [exContractEnd, setExContractEnd] = useState("");
  const [exAllergies, setExAllergies] = useState("");
  const [exMedicalNotes, setExMedicalNotes] = useState("");
  const [exAddress, setExAddress] = useState("");
  const [exPhonePrimary, setExPhonePrimary] = useState("");
  const [exPhoneEmergency, setExPhoneEmergency] = useState("");
  const [exEmergencyContactName, setExEmergencyContactName] = useState("");
  const [exBloodType, setExBloodType] = useState("");
  const [exPpeSize, setExPpeSize] = useState("");
  const [exPhotoUrl, setExPhotoUrl] = useState("");

  // --------- Equipment
  const [eqCompanyId, setEqCompanyId] = useState("");
  const [eqName, setEqName] = useState("");
  const [eqType, setEqType] = useState("");
  const [eqActive, setEqActive] = useState(true);
  const [eqAllowedPorticoId, setEqAllowedPorticoId] = useState("");

  // --------- Vehicles
  const [vehPatente, setVehPatente] = useState("");
  const [vehDescripcion, setVehDescripcion] = useState("");
  const [vehCompanyId, setVehCompanyId] = useState("");
  const [vehStatus, setVehStatus] = useState(true);
  const [vehTagId, setVehTagId] = useState("");
  const [vehTagAssignmentId, setVehTagAssignmentId] = useState(null);

  // --------- Tags
  const [tagCode, setTagCode] = useState("");
  const [tagDescription, setTagDescription] = useState("");
  const [tagActive, setTagActive] = useState(true);

  // --------- Tag Assign
  const [assignEntityType, setAssignEntityType] = useState("person");
  const [assignEntityId, setAssignEntityId] = useState("");

  // --------- Porticos (configuracion operativa)
  const [porName, setPorName] = useState("");
  const [porZone, setPorZone] = useState("");
  const [porNivel, setPorNivel] = useState("");
  const [porSite, setPorSite] = useState("");
  const [porSiteCode, setPorSiteCode] = useState("");
  const [porGatewayId, setPorGatewayId] = useState("");
  const [porGatewayName, setPorGatewayName] = useState("");
  const [porSpecificName, setPorSpecificName] = useState("");
  const [porOperatingMode, setPorOperatingMode] = useState("READ");
  const [porAntennaInPort, setPorAntennaInPort] = useState("1");
  const [porAntennaOutPort, setPorAntennaOutPort] = useState("2");
  const [porSequenceWindowSeconds, setPorSequenceWindowSeconds] = useState("15");
  const [porActive, setPorActive] = useState(true);

  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState("");

  function close() {
    setModal({ open: false, type: "", mode: "create", item: null });
  }

  // inicializar campos al abrir
  useEffect(() => {
    if (!open) return;
    setFormErr("");
    setSaving(false);

    if (type === "companies") {
      setCompanyName(item?.name || "");
      setCompanyActive(item?.active ?? true);
    }

    if (type === "persons") {
      setPersonCompanyId(item?.company_id ? String(item.company_id) : "");
      setPersonRut(item?.rut || "");
      setPersonFullName(item?.full_name || "");
      setPersonRole(item?.role || "");
      setPersonActive(item?.active ?? true);
      setPersonTagId("");
      setPersonTagAssignmentId(null);

      // reset extra
      setExDriverLicense("");
      setExDriverLicenseExp("");
      setExMedicalExams("");
      setExMedicalExamsExp("");
      setExEntryType("");
      setExEntryExp("");
      setExSiteInduction("");
      setExSiteInductionExp("");
      setExHeightWorkCert("");
      setExHeightWorkCertExp("");
      setExContractEnd("");
      setExAllergies("");
      setExMedicalNotes("");
      setExAddress("");
      setExPhonePrimary("");
      setExPhoneEmergency("");
      setExEmergencyContactName("");
      setExBloodType("");
      setExPpeSize("");
      setExPhotoUrl("");

      // cargar tag asignado + extra si es edición
      (async () => {
        if (mode !== "edit" || !item?.id) return;
        try {
          const tagInfo = await apiJson(`/api/config/entity-tag?entity_type=person&entity_id=${item.id}`);
          if (tagInfo?.tag_id) setPersonTagId(tagInfo.tag_id);
          if (tagInfo?.assignment_id) setPersonTagAssignmentId(tagInfo.assignment_id);

          const extra = await apiJson(`/api/config/persons/${item.id}/extra`);
          if (extra) {
            setExDriverLicense(extra.driver_license || "");
            setExDriverLicenseExp(extra.driver_license_exp || "");
            setExMedicalExams(extra.medical_exams || "");
            setExMedicalExamsExp(extra.medical_exams_exp || "");
            setExEntryType(extra.entry_type || "");
            setExEntryExp(extra.entry_exp || "");
            setExSiteInduction(extra.site_induction || "");
            setExSiteInductionExp(extra.site_induction_exp || "");
            setExHeightWorkCert(extra.height_work_cert || "");
            setExHeightWorkCertExp(extra.height_work_cert_exp || "");
            setExContractEnd(extra.contract_end || "");
            setExAllergies(extra.allergies || "");
            setExMedicalNotes(extra.medical_notes || "");
            setExAddress(extra.address || "");
            setExPhonePrimary(extra.phone_primary || "");
            setExPhoneEmergency(extra.phone_emergency || "");
            setExEmergencyContactName(extra.emergency_contact_name || "");
            setExBloodType(extra.blood_type || "");
            setExPpeSize(extra.ppe_size || "");
            setExPhotoUrl(extra.photo_url || "");
          }
        } catch (e) {
          // no bloquea
        }
      })();
    }

    if (type === "equipment") {
      setEqCompanyId(item?.company_id ? String(item.company_id) : "");
      setEqName(item?.name || "");
      setEqType(item?.type || "");
      setEqActive(item?.active ?? true);
      setEqAllowedPorticoId("");
      if (mode === "edit" && item?.id) {
        apiJson(`/api/config/equipment-portico-rules/${item.id}`)
          .then((rule) => setEqAllowedPorticoId(rule?.allowed_portico_id ? String(rule.allowed_portico_id) : ""))
          .catch(() => setEqAllowedPorticoId(""));
      }
    }

    if (type === "vehicles") {
      setVehPatente(item?.patente || "");
      setVehDescripcion(item?.descripcion || "");
      setVehCompanyId(item?.company_id ? String(item.company_id) : "");
      setVehStatus(item?.status ?? true);
      setVehTagId("");
      setVehTagAssignmentId(null);

      (async () => {
        if (mode !== "edit" || !item?.id) return;
        try {
          const tagInfo = await apiJson(`/api/config/entity-tag?entity_type=vehicle&entity_id=${item.id}`);
          if (tagInfo?.tag_id) setVehTagId(tagInfo.tag_id);
          if (tagInfo?.assignment_id) setVehTagAssignmentId(tagInfo.assignment_id);
        } catch (e) {
          // ignore
        }
      })();
    }

    if (type === "tags") {
      setTagCode(item?.code || "");
      setTagDescription(item?.description || "");
      setTagActive(item?.active ?? true);
    }

    if (type === "tagAssign") {
      setAssignEntityType("person");
      setAssignEntityId("");
    }

    if (type === "porticos") {
      setPorName(item?.name || "");
      setPorZone(item?.zone || "");
      setPorNivel(item?.nivel != null ? String(item.nivel) : "");
      setPorSite(item?.site || "");
      setPorSiteCode(item?.site_code || "");
      setPorGatewayId(item?.gateway_id || "");
      setPorGatewayName(item?.gateway_name || "");
      setPorSpecificName(item?.specific_name || "");
      setPorOperatingMode(String(item?.operating_mode || "READ").toUpperCase());
      setPorAntennaInPort(item?.antenna_in_port != null ? String(item.antenna_in_port) : "1");
      setPorAntennaOutPort(item?.antenna_out_port != null ? String(item.antenna_out_port) : "2");
      setPorSequenceWindowSeconds(item?.sequence_window_seconds != null ? String(item.sequence_window_seconds) : "15");
      setPorActive(item?.active ?? true);
    }
  }, [open, type, mode, item]);

  async function saveCompany() {
    if (!companyName.trim()) throw new Error("Nombre requerido");
    if (mode === "create") {
      await apiJson("/api/config/companies", { method: "POST", body: JSON.stringify({ name: companyName.trim(), active: companyActive }) });
    } else {
      await apiJson(`/api/config/companies/${item.id}`, {
        method: "PUT",
        body: JSON.stringify({ name: companyName.trim(), active: companyActive }),
      });
    }
  }

  async function saveEquipment() {
    if (!eqName.trim()) throw new Error("Nombre requerido");
    const payload = {
      company_id: eqCompanyId ? Number(eqCompanyId) : null,
      name: eqName.trim(),
      type: eqType?.trim() || null,
      active: eqActive,
    };
    let saved;
    if (mode === "create") {
      saved = await apiJson("/api/config/equipment", { method: "POST", body: JSON.stringify(payload) });
    } else {
      saved = await apiJson(`/api/config/equipment/${item.id}`, { method: "PUT", body: JSON.stringify(payload) });
    }
    const equipmentId = item?.id || saved?.id;
    if (equipmentId && eqAllowedPorticoId) {
      await apiJson(`/api/config/equipment-portico-rules/${equipmentId}`, { method: "PUT", body: JSON.stringify({ allowed_portico_id: Number(eqAllowedPorticoId) }) });
    }
  }

  async function savePerson() {
    if (!personFullName.trim()) throw new Error("Nombre requerido");

    const base = {
      company_id: personCompanyId ? Number(personCompanyId) : null,
      rut: personRut?.trim() || null,
      full_name: personFullName.trim(),
      role: personRole?.trim() || null,
      active: personActive,
    };

    let personId = item?.id;
    if (mode === "create") {
      const created = await apiJson("/api/config/persons", { method: "POST", body: JSON.stringify(base) });
      personId = created?.id;
    } else {
      await apiJson(`/api/config/persons/${personId}`, { method: "PUT", body: JSON.stringify(base) });
    }

    if (personId) {
      // extra
      const extra = {
        driver_license: exDriverLicense?.trim() || null,
        driver_license_exp: exDriverLicenseExp || null,
        medical_exams: exMedicalExams?.trim() || null,
        medical_exams_exp: exMedicalExamsExp || null,
        entry_type: exEntryType || null,
        entry_exp: exEntryExp || null,
        site_induction: exSiteInduction?.trim() || null,
        site_induction_exp: exSiteInductionExp || null,
        height_work_cert: exHeightWorkCert?.trim() || null,
        height_work_cert_exp: exHeightWorkCertExp || null,
        contract_end: exContractEnd || null,
        allergies: exAllergies?.trim() || null,
        medical_notes: exMedicalNotes?.trim() || null,
        address: exAddress?.trim() || null,
        phone_primary: exPhonePrimary?.trim() || null,
        phone_emergency: exPhoneEmergency?.trim() || null,
        emergency_contact_name: exEmergencyContactName?.trim() || null,
        blood_type: exBloodType?.trim() || null,
        ppe_size: exPpeSize?.trim() || null,
        photo_url: exPhotoUrl?.trim() || null,
      };
      await apiJson(`/api/config/persons/${personId}/extra`, { method: "PUT", body: JSON.stringify(extra) });

      // tag único activo
      if (personTagId) {
        await apiJson("/api/config/tag-assignments", {
          method: "POST",
          body: JSON.stringify({ tag_id: personTagId, entity_type: "person", entity_id: personId }),
        });
      } else if (personTagAssignmentId) {
        await apiJson(`/api/config/tag-assignments/${personTagAssignmentId}`, { method: "DELETE" });
      }
    }
  }

  async function saveVehicle() {
    if (!vehPatente.trim()) throw new Error("Patente requerida");

    const payload = {
      patente: vehPatente.trim(),
      descripcion: vehDescripcion?.trim() || null,
      status: vehStatus,
      company_id: vehCompanyId ? Number(vehCompanyId) : null,
    };

    let vehicleId = item?.id;
    if (mode === "create") {
      const created = await apiJson("/api/config/vehicles", { method: "POST", body: JSON.stringify(payload) });
      vehicleId = created?.id;
    } else {
      await apiJson(`/api/config/vehicles/${vehicleId}`, { method: "PUT", body: JSON.stringify(payload) });
    }

    if (vehicleId) {
      if (vehTagId) {
        await apiJson("/api/config/tag-assignments", {
          method: "POST",
          body: JSON.stringify({ tag_id: vehTagId, entity_type: "vehicle", entity_id: vehicleId }),
        });
      } else if (vehTagAssignmentId) {
        await apiJson(`/api/config/tag-assignments/${vehTagAssignmentId}`, { method: "DELETE" });
      }
    }
  }

  async function saveTag() {
    if (!tagCode.trim()) throw new Error("Código requerido");
    const payload = { code: tagCode.trim(), description: tagDescription?.trim() || null, active: tagActive };
    if (mode === "create") {
      await apiJson("/api/config/tags", { method: "POST", body: JSON.stringify(payload) });
    } else {
      await apiJson(`/api/config/tags/${item.id}`, { method: "PUT", body: JSON.stringify(payload) });
    }
  }

  async function saveTagAssignment() {
    if (!assignEntityId) throw new Error("Selecciona el destino (persona/vehículo)");
    await apiJson("/api/config/tag-assignments", {
      method: "POST",
      body: JSON.stringify({ tag_id: item.id, entity_type: assignEntityType, entity_id: Number(assignEntityId) }),
    });
  }

  async function savePortico() {
    if (!porName.trim()) throw new Error("Nombre requerido");
    if (!porGatewayName.trim() && !porGatewayId.trim()) throw new Error("Reader o gateway requerido");
    const payload = {
      name: porName.trim(),
      site: porSite?.trim() || null,
      site_code: porSiteCode?.trim() || null,
      specific_name: porSpecificName?.trim() || null,
      zone: porZone?.trim() || null,
      nivel: porNivel !== "" ? String(porNivel).trim() : null,
      gateway_id: porGatewayId?.trim() || null,
      gateway_name: porGatewayName?.trim() || null,
      operating_mode: porOperatingMode,
      antenna_in_port: porAntennaInPort !== "" ? Number(porAntennaInPort) : 1,
      antenna_out_port:
        String(porOperatingMode).toUpperCase() === "ACCESS" && porAntennaOutPort !== ""
          ? Number(porAntennaOutPort)
          : null,
      sequence_window_seconds: porSequenceWindowSeconds !== "" ? Number(porSequenceWindowSeconds) : 15,
      active: porActive,
    };

    if (mode === "create") {
      await apiJson("/api/config/porticos", { method: "POST", body: JSON.stringify(payload) });
    } else {
      await apiJson(`/api/config/porticos/${item.id}`, { method: "PUT", body: JSON.stringify(payload) });
    }
  }

  async function onSave() {
    setSaving(true);
    setFormErr("");
    try {
      if (type === "companies") await saveCompany();
      else if (type === "persons") await savePerson();
      else if (type === "equipment") await saveEquipment();
      else if (type === "vehicles") await saveVehicle();
      else if (type === "tags") await saveTag();
      else if (type === "tagAssign") await saveTagAssignment();
      else if (type === "porticos") await savePortico();

      await onSaved();
      close();
    } catch (e) {
      setFormErr(String(e.message || e));
    } finally {
      setSaving(false);
    }
  }

  const titleMap = {
    companies: mode === "create" ? "Nueva empresa" : `Editar empresa #${item?.id}`,
    persons: mode === "create" ? "Nueva persona" : `Editar persona #${item?.id}`,
    equipment: mode === "create" ? "Nuevo equipo" : `Editar equipo #${item?.id}`,
    vehicles: mode === "create" ? "Nuevo vehículo" : `Editar vehículo #${item?.id}`,
    tags: mode === "create" ? "Nuevo tag" : `Editar tag ${item?.code || ""}`,
    tagAssign: `Asignar tag ${item?.code || ""}`,
    porticos: mode === "create" ? "Nuevo pórtico" : `Editar pórtico #${item?.id}`,
  };

  const openHere = open && ["companies", "persons", "equipment", "vehicles", "tags", "tagAssign", "porticos"].includes(type);

  const personTagOptions = [{ value: "", label: "(sin tag)" }, ...tagOptions];
  const vehicleTagOptions = [{ value: "", label: "(sin tag)" }, ...tagOptions];

  const assignOptions = useMemo(() => {
    if (assignEntityType === "person") {
      return persons.map((p) => ({ value: p.id, label: `${p.full_name} (#${p.id})` }));
    }
    if (assignEntityType === "vehicle") {
      return vehicles.map((v) => ({ value: v.id, label: `${v.patente} (#${v.id})` }));
    }
    return [];
  }, [assignEntityType, persons, vehicles]);

  const personFormAlerts = useMemo(
    () =>
      getPersonExpiryAlerts(
        {
          driver_license_exp: exDriverLicenseExp,
          medical_exams_exp: exMedicalExamsExp,
          entry_exp: exEntryExp,
          site_induction_exp: exSiteInductionExp,
          height_work_cert_exp: exHeightWorkCertExp,
          contract_end: exContractEnd,
        },
        15,
      ),
    [
      exContractEnd,
      exDriverLicenseExp,
      exEntryExp,
      exHeightWorkCertExp,
      exMedicalExamsExp,
      exSiteInductionExp,
    ],
  );

  async function handlePersonPhotoChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setFormErr("La foto debe ser un archivo de imagen.");
      event.target.value = "";
      return;
    }

    try {
      const result = await readFileAsDataUrl(file);
      setExPhotoUrl(String(result || ""));
    } catch (error) {
      setFormErr(String(error.message || error));
    } finally {
      event.target.value = "";
    }
  }

  return (
    <Modal open={openHere} title={titleMap[type] || "Editar"} onClose={close}>
      <div className="space-y-4">
        {formErr ? <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{formErr}</div> : null}

        {type === "companies" ? (
          <div className="grid gap-3">
            <TextField label="Nombre" value={companyName} onChange={setCompanyName} placeholder="Ej: Minera San Jorge" />
            <ToggleField label="Activa" checked={companyActive} onChange={setCompanyActive} />
          </div>
        ) : null}

        {type === "persons" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <SelectField label="Empresa" value={personCompanyId} onChange={setPersonCompanyId} options={companyOptions} placeholder="(sin empresa)" />
              <TextField label="RUT" value={personRut} onChange={setPersonRut} placeholder="12.345.678-9" />
              <TextField label="Nombre completo" value={personFullName} onChange={setPersonFullName} placeholder="Nombre y apellido" />
              <TextField label="Rol" value={personRole} onChange={setPersonRole} placeholder="Ej: Operador" />
              <ToggleField label="Activa" checked={personActive} onChange={setPersonActive} />
              <SelectField label="Tag RFID" value={personTagId} onChange={setPersonTagId} options={personTagOptions} placeholder="(sin tag)" />
            </div>

            {personFormAlerts.length ? (
              <div className="grid gap-2">
                {personFormAlerts.map((alert) => (
                  <div
                    key={`person-alert-${alert.key}`}
                    className={`rounded-[20px] border px-4 py-3 text-sm font-medium ${
                      alert.severity === "expired"
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : "border-amber-200 bg-amber-50 text-amber-700"
                    }`}
                  >
                    {alert.message}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="rounded border bg-gray-50 p-3">
              <div className="mb-2 text-sm font-semibold text-gray-800">Datos adicionales (gestión temprana)</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <TextField label="Licencia de conducir" value={exDriverLicense} onChange={setExDriverLicense} placeholder="Clase / Número" />
                <TextField label="Vence licencia" value={exDriverLicenseExp} onChange={setExDriverLicenseExp} type="date" />
                <TextField label="Exámenes médicos" value={exMedicalExams} onChange={setExMedicalExams} placeholder="Ej: Ocupacional, Mina" />
                <TextField label="Vence exámenes médicos" value={exMedicalExamsExp} onChange={setExMedicalExamsExp} type="date" />
                <SelectField
                  label="Tipo de ingreso"
                  value={exEntryType}
                  onChange={setExEntryType}
                  options={PERSON_ENTRY_TYPE_OPTIONS}
                  placeholder="Selecciona un tipo"
                />
                <TextField label="Vence ingreso" value={exEntryExp} onChange={setExEntryExp} type="date" />
                <TextField label="Inducción faena" value={exSiteInduction} onChange={setExSiteInduction} placeholder="Ej: Inducción Diamante NP" />
                <TextField label="Vence inducción" value={exSiteInductionExp} onChange={setExSiteInductionExp} type="date" />
                <TextField label="Trabajo en altura" value={exHeightWorkCert} onChange={setExHeightWorkCert} placeholder="Ej: Certificación vigente" />
                <TextField label="Vence trabajo en altura" value={exHeightWorkCertExp} onChange={setExHeightWorkCertExp} type="date" />
                <TextField label="Fin de contrato" value={exContractEnd} onChange={setExContractEnd} type="date" />
                <TextField label="Alergias" value={exAllergies} onChange={setExAllergies} placeholder="Ej: Penicilina" />
                <TextField label="Dirección" value={exAddress} onChange={setExAddress} placeholder="Dirección" />
                <TextField label="Teléfono" value={exPhonePrimary} onChange={setExPhonePrimary} placeholder="+56 9 ..." />
                <TextField label="Contacto de emergencia" value={exEmergencyContactName} onChange={setExEmergencyContactName} placeholder="Nombre de contacto" />
                <TextField label="Teléfono emergencia" value={exPhoneEmergency} onChange={setExPhoneEmergency} placeholder="+56 9 ..." />
                <TextField label="Grupo sanguíneo" value={exBloodType} onChange={setExBloodType} placeholder="Ej: O+" />
                <TextField label="Talla EPP" value={exPpeSize} onChange={setExPpeSize} placeholder="Ej: L / 42 / Casco M" />
              </div>
              <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
                <label className="block">
                  <FieldShell label="Ficha médica / notas">
                    <textarea
                      className="tm-control min-h-[120px]"
                      rows={4}
                      value={exMedicalNotes}
                      onChange={(e) => setExMedicalNotes(e.target.value)}
                      placeholder="Alergias, medicamentos, observaciones o restricciones operativas..."
                    />
                  </FieldShell>
                </label>

                <div className="rounded-[22px] border border-dashed border-slate-200 bg-white/80 px-4 py-4">
                  <div className="mb-3 text-sm font-semibold text-slate-800">Foto</div>
                  <div className="flex flex-col items-center gap-3">
                    <PersonPhotoAvatar
                      src={exPhotoUrl}
                      alt={personFullName || "Persona"}
                      sizeClass="h-28 w-28"
                      roundedClass="rounded-[28px]"
                      emojiClass="text-5xl"
                    />

                    <label className="w-full">
                      <FieldShell label="Subir foto" hint="Si no hay imagen, se usa un icono minero.">
                        <input type="file" accept="image/*" className="tm-control" onChange={handlePersonPhotoChange} />
                      </FieldShell>
                    </label>

                    {exPhotoUrl ? (
                      <SmallBtn onClick={() => setExPhotoUrl("")}>Quitar foto</SmallBtn>
                    ) : null}
                  </div>

                  <div className="mt-4 space-y-2 rounded-[18px] border border-slate-200 bg-slate-50/80 px-3 py-3 text-sm text-slate-600">
                    <div>
                      <span className="font-semibold text-slate-800">Ingreso:</span> {formatEntryType(exEntryType)}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-800">Licencia:</span> {exDriverLicense || "Sin dato"}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-800">Exámenes:</span> {exMedicalExams || "Sin dato"}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-800">Altura:</span> {exHeightWorkCert || "Sin dato"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {type === "equipment" ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <SelectField label="Empresa" value={eqCompanyId} onChange={setEqCompanyId} options={companyOptions} placeholder="(sin empresa)" />
            <TextField label="Nombre" value={eqName} onChange={setEqName} placeholder="Ej: Camión 12 / Excavadora" />
            <TextField label="Tipo" value={eqType} onChange={setEqType} placeholder="Ej: maquinaria, equipo" />
            <SelectField label="Pórtico autorizado" value={eqAllowedPorticoId} onChange={setEqAllowedPorticoId} options={(porticos || []).map((portico) => ({ value: String(portico.id), label: portico.name }))} placeholder="Sin restricción de pórtico" />
            <ToggleField label="Activo" checked={eqActive} onChange={setEqActive} />
          </div>
        ) : null}

        {type === "vehicles" ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <TextField label="Patente" value={vehPatente} onChange={setVehPatente} placeholder="ABCD12" />
            <SelectField label="Empresa" value={vehCompanyId} onChange={setVehCompanyId} options={companyOptions} placeholder="(sin empresa)" />
            <TextField label="Descripción" value={vehDescripcion} onChange={setVehDescripcion} placeholder="Ej: Camioneta blanca" />
            <SelectField label="Tag RFID" value={vehTagId} onChange={setVehTagId} options={vehicleTagOptions} placeholder="(sin tag)" />
            <ToggleField label="Activo" checked={vehStatus} onChange={setVehStatus} />
          </div>
        ) : null}

        {type === "tags" ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <TextField label="Código" value={tagCode} onChange={setTagCode} placeholder="Ej: C30000561F5B" />
            <TextField label="Descripción" value={tagDescription} onChange={setTagDescription} placeholder="Ej: Tag operador turno A" />
            <ToggleField label="Activo" checked={tagActive} onChange={setTagActive} />
          </div>
        ) : null}

        {type === "tagAssign" ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <SelectField
              label="Tipo"
              value={assignEntityType}
              onChange={setAssignEntityType}
              options={[
                { value: "person", label: "Persona" },
                { value: "vehicle", label: "Vehículo" },
              ]}
              placeholder="Selecciona"
            />
            <SelectField label="Destino" value={assignEntityId} onChange={setAssignEntityId} options={assignOptions} placeholder="Selecciona" />
            <div className="text-xs text-gray-500 md:col-span-2">
              Regla: el tag queda <b>único activo</b> (se desasigna de cualquier otro destino anterior).
            </div>
          </div>
        ) : null}

        {type === "porticos" ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <TextField label="Nombre" value={porName} onChange={setPorName} placeholder="Ej: 1.-SOC. ACC RAMPA NP" />
            <SelectField
              label="Tipo operativo"
              value={porOperatingMode}
              onChange={setPorOperatingMode}
              options={PORTICO_MODE_OPTIONS}
              placeholder="Selecciona"
            />
            <TextField label="Reader / Gateway" value={porGatewayName} onChange={setPorGatewayName} placeholder="Ej: 192.168.100.50" />
            <TextField label="Gateway UUID" value={porGatewayId} onChange={setPorGatewayId} placeholder="Opcional si ya existe" />
            <TextField label="Specific name" value={porSpecificName} onChange={setPorSpecificName} placeholder="Ej: 192.168.100.50" />
            <TextField label="Zona" value={porZone} onChange={setPorZone} placeholder="Ej: Rampa NP" />
            <TextField label="Site" value={porSite} onChange={setPorSite} placeholder="Ej: Diamante" />
            <TextField label="Site code" value={porSiteCode} onChange={setPorSiteCode} placeholder="Ej: SOC_ACC_RAMPA_NP" />
            <TextField label="Nivel" value={porNivel} onChange={setPorNivel} placeholder="Ej: NP" />
            <TextField label="Antena entrada / lectura" value={porAntennaInPort} onChange={setPorAntennaInPort} placeholder="1" type="number" />
            <TextField
              label="Antena salida"
              value={porAntennaOutPort}
              onChange={setPorAntennaOutPort}
              placeholder="2"
              type="number"
              disabled={String(porOperatingMode).toUpperCase() !== "ACCESS"}
            />
            <TextField
              label="Ventana secuencia (s)"
              value={porSequenceWindowSeconds}
              onChange={setPorSequenceWindowSeconds}
              placeholder="15"
              type="number"
            />
            <ToggleField label="Activo" checked={porActive} onChange={setPorActive} />
            <div className="text-xs text-gray-500 md:col-span-2">
              Para mover en el plano usa <b>Editar</b> en el listado. En acceso, la secuencia 1→2 marca entrada y 2→1 marca salida.
            </div>
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <SmallBtn onClick={close} disabled={saving}>
            Cancelar
          </SmallBtn>
          <SmallBtn variant="primary" onClick={onSave} disabled={saving}>
            {saving ? "Guardando..." : "Guardar"}
          </SmallBtn>
        </div>
      </div>
    </Modal>
  );
}
