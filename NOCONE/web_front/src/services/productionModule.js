import {
  DEFAULT_PRODUCTION_ALLOWED_ROLES,
  normalizeAllowedRoles,
  setStoredProductionAllowedRoles,
} from "../utils/productionAccess";

const STORAGE_KEY = "production_module_payload";

const EMPTY_PRODUCTION_PAYLOAD = {
  meta: {
    sourceWorkbook: "sql-seed",
    operationDate: "2026-06-02T00:00:00",
    generatedAt: null,
    maps: [
      { code: "NP_dia", label: "Diamante - NP" },
      { code: "NTI_andes_norte", label: "NTI Andes Norte" },
      { code: "NTI_dia", label: "NTI Dia" },
      { code: "UCL_dia", label: "UCL" },
    ],
  },
  permissions: {
    allowedRoles: [...DEFAULT_PRODUCTION_ALLOWED_ROLES],
  },
  referenceData: {
    lists: {
      Cuadrilla: [],
      Turnos: [],
      Equipos: [],
      Niveles: [],
      Posturas: [],
      Mineria: [],
      OOCC: [],
    },
    cnc: {
      external: [],
      internal: [],
    },
  },
  dashboard: {
    cumplimientoMineria: 0,
    cumplimientoOOCC: 0,
  },
  schedule: {
    waypoints: [],
    controlMineria: [],
    controlOOCC: [],
    ganttMineria: { rows: [] },
    ganttOOCC: { rows: [] },
    hoursMineria: { crew: [], equipment: [] },
  },
};

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function repairText(value) {
  if (typeof value === "string") {
    const normalized = value.replace(/\u00c2\u00b7/g, "\u00b7");
    if (/[\u00c3\u00c2\u00f0\u00d0]/.test(normalized)) {
      try {
        return decodeURIComponent(escape(normalized));
      } catch (_error) {
        return normalized;
      }
    }
    return normalized;
  }

  if (Array.isArray(value)) {
    return value.map((item) => repairText(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [repairText(key), repairText(item)])
    );
  }

  return value;
}

function normalizeWaypoints(items) {
  return Array.isArray(items)
    ? items.map((item) => ({
        ...item,
        domains: Array.isArray(item?.domains) ? item.domains : [],
        taskCounts: {
          mineria: Number(item?.taskCounts?.mineria || 0),
          oocc: Number(item?.taskCounts?.oocc || 0),
        },
      }))
    : [];
}

function normalizeTasks(items) {
  return Array.isArray(items)
    ? items.map((item) => ({
        ...item,
        linkedPeople: Array.isArray(item?.linkedPeople) ? item.linkedPeople : [],
        linkedVehicles: Array.isArray(item?.linkedVehicles) ? item.linkedVehicles : [],
        roles: Array.isArray(item?.roles) ? item.roles : [],
      }))
    : [];
}

function aliasLists(lists = {}) {
  const next = { ...lists };
  next.Mineria = next.Mineria || next["Miner\u00eda"] || next["Miner\u00c3\u00ada"] || [];
  next.OOCC = next.OOCC || next["OO.CC"] || [];
  next.Turnos = Array.isArray(next.Turnos)
    ? next.Turnos.map((item) => ({
        ...item,
        code:
          item?.code === "S\u00ed" || item?.code === "S\u00c3\u00ad" ? "Si" : item?.code,
        label:
          item?.label === "S\u00ed" || item?.label === "S\u00c3\u00ad" ? "Si" : item?.label,
      }))
    : [];
  return next;
}

export function normalizeProductionModulePayload(payload) {
  const base = deepClone(EMPTY_PRODUCTION_PAYLOAD);
  const next = repairText(payload && typeof payload === "object" ? payload : {});

  const normalized = {
    ...base,
    ...next,
    meta: {
      ...base.meta,
      ...(next.meta || {}),
      maps: Array.isArray(next?.meta?.maps) && next.meta.maps.length ? next.meta.maps : base.meta.maps,
    },
    permissions: {
      ...base.permissions,
      ...(next.permissions || {}),
      allowedRoles: normalizeAllowedRoles(next?.permissions?.allowedRoles || base.permissions.allowedRoles),
    },
    referenceData: {
      ...base.referenceData,
      ...(next.referenceData || {}),
      lists: aliasLists(next?.referenceData?.lists || base.referenceData.lists),
      cnc: next?.referenceData?.cnc || base.referenceData.cnc,
    },
    dashboard: {
      ...base.dashboard,
      ...(next.dashboard || {}),
    },
    schedule: {
      ...base.schedule,
      ...(next.schedule || {}),
      waypoints: normalizeWaypoints(next?.schedule?.waypoints || base.schedule.waypoints),
      controlMineria: normalizeTasks(next?.schedule?.controlMineria || base.schedule.controlMineria),
      controlOOCC: normalizeTasks(next?.schedule?.controlOOCC || base.schedule.controlOOCC),
      ganttMineria: next?.schedule?.ganttMineria || base.schedule.ganttMineria,
      ganttOOCC: next?.schedule?.ganttOOCC || base.schedule.ganttOOCC,
      hoursMineria: next?.schedule?.hoursMineria || base.schedule.hoursMineria,
    },
  };

  setStoredProductionAllowedRoles(normalized.permissions.allowedRoles || DEFAULT_PRODUCTION_ALLOWED_ROLES);
  return normalized;
}

function persistLocalPayload(payload) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function readLocalPayload() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
}

export async function loadProductionModulePayload() {
  try {
    const response = await fetch("/api/config/production-module");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = normalizeProductionModulePayload(await response.json());
    persistLocalPayload(payload);
    return payload;
  } catch (_error) {
    const localPayload = readLocalPayload();
    return normalizeProductionModulePayload(localPayload || EMPTY_PRODUCTION_PAYLOAD);
  }
}

export async function saveProductionModulePayload(payload) {
  const normalizedPayload = normalizeProductionModulePayload(payload);
  persistLocalPayload(normalizedPayload);

  try {
    const response = await fetch("/api/config/production-module", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(normalizedPayload),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const saved = normalizeProductionModulePayload(await response.json());
    persistLocalPayload(saved);
    return saved;
  } catch (_error) {
    return normalizedPayload;
  }
}
