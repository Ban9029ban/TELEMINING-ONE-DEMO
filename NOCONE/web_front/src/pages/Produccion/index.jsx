import React, { useEffect, useMemo, useState } from "react";
import {
  FaClipboardList,
  FaLink,
  FaMountain,
  FaRoute,
} from "react-icons/fa";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import AccessDeniedModal from "../../components/AccessDeniedModal";
import ProductionMapPanel from "../../components/production/ProductionMapPanel";
import ProductionTaskModal from "../../components/production/ProductionTaskModal";
import WorkbookGanttBoard from "../../components/production/WorkbookGanttBoard";
import {
  ActionButton,
  EmptyState,
  FieldShell,
  MetricStrip,
  PageShell,
  SectionCard,
  SegmentedTabs,
  StatusBadge,
} from "../../components/SystemTheme";
import useUserPermissions from "../../hooks/useUserPermissions";
import {
  loadProductionModulePayload,
  saveProductionModulePayload,
} from "../../services/productionModule";
import { hasAnyPermission, hasPermission } from "../../utils/accessControl";
import {
  buildProductionGanttRows,
  buildProductionWorkbookExportUrl,
  exportProductionGanttPdf,
  formatOperationDateLabel,
  PRODUCTION_GANTT_SLOTS,
  slotWindow,
} from "../../utils/productionGantt";

const TAB_ITEMS = [
  { value: "ganttMineria", label: "Gantt minería", permissionKey: "produccion:gantt_mineria" },
  { value: "controlMineria", label: "Control minería", permissionKey: "produccion:control_mineria" },
  { value: "ganttOocc", label: "Gantt OO.CC", permissionKey: "produccion:gantt_oocc" },
  { value: "controlOocc", label: "Control OO.CC", permissionKey: "produccion:control_oocc" },
  { value: "hoursMineria", label: "Horas minería", permissionKey: "produccion:horas_mineria" },
];
const TASK_MANAGEMENT_PERMISSION_KEYS = TAB_ITEMS.filter(
  (item) => item.value !== "hoursMineria"
).map((item) => item.permissionKey);

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatPercent(value) {
  const numeric = Number(value || 0);
  return `${Math.round(numeric * 100)}%`;
}

function formatTimeRange(startValue, endValue) {
  if (!startValue || !endValue) return "Sin horario";
  const options = { hour: "2-digit", minute: "2-digit", timeZone: "America/Santiago" };
  return `${new Date(startValue).toLocaleTimeString("es-CL", options)} - ${new Date(endValue).toLocaleTimeString("es-CL", options)}`;
}

function formatDateLabel(value) {
  if (!value) return "Sin fecha";
  const parsed = new Date(value);
  return parsed.toLocaleDateString("es-CL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Santiago",
  });
}

function formatDuration(minutes) {
  const numeric = Number(minutes || 0);
  const hours = Math.floor(numeric / 60);
  const remainder = numeric % 60;
  return `${hours}h ${remainder}m`;
}

function toDateTimeLocalValue(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function buildWaypointTaskMap(tasks) {
  const nextMap = new Map();
  tasks.forEach((task) => {
    const items = nextMap.get(task.waypointId) || [];
    items.push(task);
    items.sort((left, right) => String(left.plannedStart || "").localeCompare(String(right.plannedStart || "")));
    nextMap.set(task.waypointId, items);
  });
  return nextMap;
}

function domainKeyFromTab(activeTab) {
  if (activeTab === "ganttOocc" || activeTab === "controlOocc") return "oocc";
  return "mineria";
}

function calculateAverageProgress(tasks) {
  if (!tasks.length) return 0;
  return tasks.reduce((sum, task) => sum + Number(task.progress || 0), 0) / tasks.length;
}

function buildFilterOptions(tasks) {
  return {
    dates: Array.from(new Set(tasks.map((task) => String(task.date || "").slice(0, 10)).filter(Boolean))).sort(),
    shifts: Array.from(new Set(tasks.map((task) => task.turno).filter(Boolean))).sort(),
    levels: Array.from(new Set(tasks.map((task) => task.nivel).filter(Boolean))).sort(),
  };
}

function sortTasks(tasks) {
  return [...tasks].sort((left, right) => {
    const leftStart = new Date(left.plannedStart || left.realStart || left.date || 0).getTime();
    const rightStart = new Date(right.plannedStart || right.realStart || right.date || 0).getTime();
    return leftStart - rightStart;
  });
}

function filterTasks(tasks, filters) {
  const normalizedSearch = normalizeSearch(filters.search);

  return tasks.filter((task) => {
    if (filters.date && String(task.date || "").slice(0, 10) !== filters.date) return false;
    if (filters.turno && task.turno !== filters.turno) return false;
    if (filters.nivel && task.nivel !== filters.nivel) return false;
    if (filters.mapCode && task.mapCode !== filters.mapCode) return false;
    if (!normalizedSearch) return true;

    const haystack = normalizeSearch(
      [
        task.postura,
        task.activity,
        task.type,
        task.crewPlanned,
        task.crewReal,
        task.equipmentPlanned,
        task.equipmentReal,
        task.observation,
        ...(task.roles || []),
        ...(task.linkedPeople || []).map((item) => item.name || item.label),
        ...(task.linkedVehicles || []).map((item) => item.name || item.label),
      ].join(" ")
    );

    return haystack.includes(normalizedSearch);
  });
}

function nextWaypointPosition(existingWaypoints, mapCode) {
  const sameMap = existingWaypoints.filter((item) => item.mapCode === mapCode);
  const index = sameMap.length;
  const columns = 4;
  const col = index % columns;
  const row = Math.floor(index / columns);
  const xPct = Math.min(0.84, 0.18 + col * 0.18);
  const yPct = Math.min(0.82, 0.18 + row * 0.16);
  return { xPct: Number(xPct.toFixed(4)), yPct: Number(yPct.toFixed(4)) };
}

function rebuildWaypoints(allTasks, previousWaypoints) {
  const previousMap = new Map((previousWaypoints || []).map((item) => [item.id, item]));
  const grouped = new Map();

  allTasks.forEach((task) => {
    const current = grouped.get(task.waypointId) || {
      id: task.waypointId,
      label: task.postura,
      postura: task.postura,
      nivel: task.nivel,
      mapCode: task.mapCode,
      domains: new Set(),
      taskCounts: { mineria: 0, oocc: 0 },
      trackingPorticoId: null,
      trackingPorticoName: "",
    };
    current.domains.add(task.domain);
    current.taskCounts[task.domain] += 1;
    if (task.trackingPorticoId) {
      current.trackingPorticoId = task.trackingPorticoId;
      current.trackingPorticoName = task.trackingPorticoName || current.trackingPorticoName;
    }
    grouped.set(task.waypointId, current);
  });

  return Array.from(grouped.values()).map((item) => {
    const existing = previousMap.get(item.id);
    const position = existing || nextWaypointPosition(previousWaypoints || [], item.mapCode);
    return {
      ...item,
      domains: Array.from(item.domains),
      xPct: existing?.xPct ?? position.xPct,
      yPct: existing?.yPct ?? position.yPct,
    };
  });
}

function buildTrackingValidationSummary(validation) {
  if (!validation) {
    return {
      tone: "amber",
      label: "Sin validar",
      description: "Selecciona una tarea con personas o vehículos vinculados para contrastar con Tracking.",
    };
  }

  if (validation.status === "ok") {
    return {
      tone: "green",
      label: "Cuadre correcto",
      description: "Las entidades vinculadas muestran presencia compatible con el frente y la ventana programada.",
    };
  }

  if (validation.status === "partial") {
    return {
      tone: "amber",
      label: "Cuadre parcial",
      description: "Solo parte de las entidades calza con la postura o el rango horario esperado.",
    };
  }

  if (validation.status === "no_links") {
    return {
      tone: "amber",
      label: "Sin entidades vinculadas",
      description: "Asocia personas, vehículos y un pórtico de validación en la tarea para activar el cruce.",
    };
  }

  return {
    tone: "red",
    label: "Sin match",
    description: "No se encontraron eventos compatibles en el historial de Tracking para el periodo esperado.",
  };
}

async function fetchJson(path, options = {}) {
  const token =
    typeof window !== "undefined" ? window.localStorage.getItem("token") || "" : "";
  const response = await fetch(path, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function validateTaskAgainstTracking(task) {
  if (!task) {
    return { status: "no_links", items: [] };
  }

  return fetchJson("/api/config/production-module/validate-tracking", {
    method: "POST",
    body: JSON.stringify(task),
  });
}

function ControlTable({ title, subtitle, tasks, onEditTask, onDeleteTask }) {
  return (
    <SectionCard title={title} subtitle={subtitle}>
      {tasks.length === 0 ? (
        <EmptyState
          title="Sin tareas para este filtro"
          description="Prueba con otra fecha, nivel o postura."
        />
      ) : (
        <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white/92">
          <div className="overflow-x-auto">
            <table className="tm-data-table min-w-full text-slate-900">
              <thead>
                <tr className="text-left">
                  <th>Postura</th>
                  <th>Actividad</th>
                  <th>Plan</th>
                  <th>Real</th>
                  <th>Avance</th>
                  <th>Personas</th>
                  <th>Vehiculos</th>
                  <th>Tracking</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <div className="font-medium text-slate-800">{task.postura}</div>
                      <div className="text-xs text-slate-500">{task.nivel}</div>
                    </td>
                    <td>
                      <div className="font-medium text-slate-800">{task.activity}</div>
                      <div className="text-xs text-slate-500">{task.type || "Sin tipo"}</div>
                    </td>
                    <td>{formatTimeRange(task.plannedStart, task.plannedEnd)}</td>
                    <td>{formatTimeRange(task.realStart, task.realEnd)}</td>
                    <td>{formatPercent(task.progress)}</td>
                    <td>{task.linkedPeople?.length || 0}</td>
                    <td>{task.linkedVehicles?.length || 0}</td>
                    <td>{task.trackingPorticoId ? "Listo" : "Pendiente"}</td>
                    <td className="space-x-2">
                      <ActionButton
                        variant="secondary"
                        className="!px-3 !py-1.5"
                        onClick={() => onEditTask(task)}
                      >
                        Editar
                      </ActionButton>
                      <ActionButton
                        variant="secondary"
                        className="!px-3 !py-1.5 !bg-rose-600 !text-white hover:!bg-rose-700"
                        onClick={() => onDeleteTask(task)}
                      >
                        Eliminar
                      </ActionButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function HoursBoard({ hoursData }) {
  const [filters, setFilters] = useState({
    crew: "",
    equipment: "",
  });

  const filteredCrew = useMemo(() => {
    const items = hoursData?.crew || [];
    return filters.crew ? items.filter((item) => item.label === filters.crew) : items;
  }, [filters.crew, hoursData]);

  const filteredEquipment = useMemo(() => {
    const items = hoursData?.equipment || [];
    return filters.equipment ? items.filter((item) => item.label === filters.equipment) : items;
  }, [filters.equipment, hoursData]);

  return (
    <SectionCard
      title="Horas minería"
      subtitle="Vista de horas programadas y efectivas por cuadrilla y equipo, con gráficos y tablas para el turno completo."
    >
      <div className="space-y-5">
        <div className="grid gap-3 rounded-[24px] border border-slate-200 bg-white/92 px-4 py-4 md:grid-cols-2">
          <label className="block">
            <FieldShell label="Filtro cuadrilla">
              <select
                className="tm-control"
                value={filters.crew}
                onChange={(event) => setFilters((current) => ({ ...current, crew: event.target.value }))}
              >
                <option value="">Todas</option>
                {(hoursData?.crew || []).map((item) => (
                  <option key={`crew-filter-${item.label}`} value={item.label}>
                    {item.label}
                  </option>
                ))}
              </select>
            </FieldShell>
          </label>

          <label className="block">
            <FieldShell label="Filtro equipo">
              <select
                className="tm-control"
                value={filters.equipment}
                onChange={(event) => setFilters((current) => ({ ...current, equipment: event.target.value }))}
              >
                <option value="">Todos</option>
                {(hoursData?.equipment || []).map((item) => (
                  <option key={`equipment-filter-${item.label}`} value={item.label}>
                    {item.label}
                  </option>
                ))}
              </select>
            </FieldShell>
          </label>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <div className="rounded-[24px] border border-slate-200 bg-white/92 px-4 py-4">
            <div className="mb-3 text-sm font-semibold text-slate-900">Tiempo programado por cuadrilla</div>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={filteredCrew}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dbe4f0" />
                  <XAxis dataKey="label" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="plannedHours" name="TP" fill="#6ba142" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="targetHours" name="Meta TP" fill="#a3c97a" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white/92 px-4 py-4">
            <div className="mb-3 text-sm font-semibold text-slate-900">Tiempo efectivo por cuadrilla</div>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={filteredCrew}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dbe4f0" />
                  <XAxis dataKey="label" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="realHours" name="TR" fill="#3b82f6" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <div className="rounded-[24px] border border-slate-200 bg-white/92 px-4 py-4">
            <div className="mb-3 text-sm font-semibold text-slate-900">Tiempo programado por equipo</div>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={filteredEquipment}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dbe4f0" />
                  <XAxis dataKey="label" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="plannedHours" name="TP" fill="#f5822c" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="targetHours" name="Meta TP" fill="#f7b16d" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white/92 px-4 py-4">
            <div className="mb-3 text-sm font-semibold text-slate-900">Tiempo efectivo por equipo</div>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={filteredEquipment}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dbe4f0" />
                  <XAxis dataKey="label" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="realHours" name="TR" fill="#fb923c" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
        <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white/92">
          <div className="border-b border-slate-200/80 px-4 py-3 text-sm font-semibold text-slate-900">
            Horas por cuadrilla
          </div>
          <div className="overflow-x-auto">
            <table className="tm-data-table min-w-full text-slate-900">
              <thead>
                <tr className="text-left">
                  <th>Cuadrilla</th>
                  <th>TP</th>
                  <th>TR</th>
                  <th>Meta TP</th>
                  <th>Tareas plan</th>
                  <th>Tareas real</th>
                </tr>
              </thead>
              <tbody>
                {filteredCrew.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td>{row.plannedHours} h</td>
                    <td>{row.realHours} h</td>
                    <td>{row.targetHours} h</td>
                    <td>{row.plannedTasks}</td>
                    <td>{row.realTasks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white/92">
          <div className="border-b border-slate-200/80 px-4 py-3 text-sm font-semibold text-slate-900">
            Horas por equipo
          </div>
          <div className="overflow-x-auto">
            <table className="tm-data-table min-w-full text-slate-900">
              <thead>
                <tr className="text-left">
                  <th>Equipo</th>
                  <th>TP</th>
                  <th>TR</th>
                  <th>Meta TP</th>
                  <th>Tareas plan</th>
                  <th>Tareas real</th>
                </tr>
              </thead>
              <tbody>
                {filteredEquipment.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td>{row.plannedHours} h</td>
                    <td>{row.realHours} h</td>
                    <td>{row.targetHours} h</td>
                    <td>{row.plannedTasks}</td>
                    <td>{row.realTasks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        </div>
      </div>
    </SectionCard>
  );
}

export default function Produccion() {
  const { permissions, roles } = useUserPermissions({ syncOnMount: false });
  const [blockedResource, setBlockedResource] = useState("");
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("");
  const [selectedWaypointId, setSelectedWaypointId] = useState(null);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [trackingValidation, setTrackingValidation] = useState(null);
  const [validationLoading, setValidationLoading] = useState(false);
  const [taskModal, setTaskModal] = useState({ open: false, task: null, defaults: {} });

  const canUsePlanView = hasPermission("produccion:plano", { permissions, roles });
  const canManageTasks = hasAnyPermission(TASK_MANAGEMENT_PERMISSION_KEYS, { permissions, roles });
  const allowedTabItems = TAB_ITEMS.filter((item) =>
    hasPermission(item.permissionKey, { permissions, roles })
  );
  const [masters, setMasters] = useState({ persons: [], vehicles: [], porticos: [] });
  const [filters, setFilters] = useState({
    date: "",
    turno: "",
    nivel: "",
    search: "",
    mapCode: "NP_dia",
  });

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      setLoading(true);
      const [nextPayload, persons, vehicles, porticos] = await Promise.all([
        loadProductionModulePayload(),
        fetchJson("/api/config/persons").catch(() => []),
        fetchJson("/api/config/vehicles").catch(() => []),
        fetchJson("/api/config/porticos").catch(() => []),
      ]);

      if (!mounted) return;

      const allTasks = [
        ...(nextPayload?.schedule?.controlMineria || []),
        ...(nextPayload?.schedule?.controlOOCC || []),
      ];
      const filterOptions = buildFilterOptions(allTasks);
      setPayload(nextPayload);
      setMasters({
        persons: Array.isArray(persons) ? persons : [],
        vehicles: Array.isArray(vehicles) ? vehicles : [],
        porticos: Array.isArray(porticos) ? porticos : [],
      });
      setFilters((current) => ({
        ...current,
        date: current.date || filterOptions.dates[0] || String(nextPayload?.meta?.operationDate || "").slice(0, 10),
        turno: current.turno || filterOptions.shifts[0] || "B",
        nivel: current.nivel || "",
        mapCode: current.mapCode || nextPayload?.meta?.maps?.[0]?.code || "NP_dia",
      }));
      setLoading(false);
    }

    loadData();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const fallbackTab = allowedTabItems[0]?.value || "";
    if (!fallbackTab) {
      if (activeTab) {
        setActiveTab("");
      }
      return;
    }

    if (!allowedTabItems.some((item) => item.value === activeTab)) {
      setActiveTab(fallbackTab);
    }
  }, [activeTab, allowedTabItems]);

  const allTasks = useMemo(
    () => [
      ...(payload?.schedule?.controlMineria || []),
      ...(payload?.schedule?.controlOOCC || []),
    ],
    [payload]
  );

  const waypoints = useMemo(() => payload?.schedule?.waypoints || [], [payload]);
  const waypointTaskMap = useMemo(() => buildWaypointTaskMap(allTasks), [allTasks]);
  const filterOptions = useMemo(() => buildFilterOptions(allTasks), [allTasks]);

  const filteredWaypoints = useMemo(
    () => waypoints.filter((item) => item.mapCode === filters.mapCode),
    [filters.mapCode, waypoints]
  );

  const filteredMineriaTasks = useMemo(
    () => filterTasks(payload?.schedule?.controlMineria || [], filters),
    [filters, payload]
  );
  const filteredOoccTasks = useMemo(
    () => filterTasks(payload?.schedule?.controlOOCC || [], filters),
    [filters, payload]
  );

  const selectedTask = useMemo(() => {
    if (!selectedTaskId) return null;
    return allTasks.find((item) => item.id === selectedTaskId) || null;
  }, [allTasks, selectedTaskId]);

  const activeTabTasks = useMemo(() => {
    if (activeTab === "ganttOocc" || activeTab === "controlOocc") {
      return sortTasks(filteredOoccTasks);
    }
    return sortTasks(filteredMineriaTasks);
  }, [activeTab, filteredMineriaTasks, filteredOoccTasks]);

  useEffect(() => {
    if (!selectedWaypointId && filteredWaypoints.length) {
      setSelectedWaypointId(filteredWaypoints[0].id);
    }
  }, [filteredWaypoints, selectedWaypointId]);

  useEffect(() => {
    if (!activeTabTasks.length) {
      if (!selectedTaskId) return;
      setSelectedTaskId(null);
      return;
    }

    const currentExists = activeTabTasks.some((item) => item.id === selectedTaskId);
    if (currentExists) return;

    const preferredTask =
      activeTabTasks.find(
        (item) =>
          item.trackingPorticoId &&
          (((item.linkedPeople || []).length || (item.linkedVehicles || []).length) > 0)
      ) || activeTabTasks[0];

    if (preferredTask) {
      setSelectedTaskId(preferredTask.id);
      setSelectedWaypointId(preferredTask.waypointId);
    }
  }, [activeTabTasks, selectedTaskId]);

  useEffect(() => {
    if (!selectedWaypointId) return;

    const scopedTasks = sortTasks(
      (waypointTaskMap.get(selectedWaypointId) || []).filter(
        (item) => item.domain === domainKeyFromTab(activeTab)
      )
    );

    if (!scopedTasks.length) return;
    if (scopedTasks.some((item) => item.id === selectedTaskId)) return;

    setSelectedTaskId(scopedTasks[0].id);
  }, [activeTab, selectedTaskId, selectedWaypointId, waypointTaskMap]);

  useEffect(() => {
    let cancelled = false;

    async function runValidation() {
      if (!selectedTask) {
        setTrackingValidation(null);
        setValidationLoading(false);
        return;
      }

      setValidationLoading(true);
      const validation = await validateTaskAgainstTracking(selectedTask);
      if (!cancelled) {
        setTrackingValidation(validation);
        setValidationLoading(false);
      }
    }

    runValidation();
    return () => {
      cancelled = true;
    };
  }, [selectedTask]);

  const ganttMineriaRows = useMemo(
    () => buildProductionGanttRows(filteredMineriaTasks, PRODUCTION_GANTT_SLOTS),
    [filteredMineriaTasks]
  );
  const ganttOoccRows = useMemo(
    () => buildProductionGanttRows(filteredOoccTasks, PRODUCTION_GANTT_SLOTS),
    [filteredOoccTasks]
  );

  const mineriaProgress = calculateAverageProgress(payload?.schedule?.controlMineria || []);
  const ooccProgress = calculateAverageProgress(payload?.schedule?.controlOOCC || []);
  const linkedTasksCount = allTasks.filter(
    (task) => task.trackingPorticoId && ((task.linkedPeople || []).length || (task.linkedVehicles || []).length)
  ).length;

  const trackingSummary = buildTrackingValidationSummary(trackingValidation);
  const operationDateLabel = formatOperationDateLabel(filters.date || payload?.meta?.operationDate);
  const activeMapLabel =
    payload?.meta?.maps?.find((item) => item.code === filters.mapCode)?.label || filters.mapCode || "Mapa";
  const activeTabConfig = TAB_ITEMS.find((item) => item.value === activeTab) || null;
  const activeTabAllowed = activeTabConfig
    ? hasPermission(activeTabConfig.permissionKey, { permissions, roles })
    : false;
  const openBlockedResource = (resourceLabel = "este recurso") => {
    setBlockedResource(resourceLabel);
  };
  const handleProtectedTabChange = (nextTab) => {
    const tab = TAB_ITEMS.find((item) => item.value === nextTab);
    if (!tab) return;
    if (!hasPermission(tab.permissionKey, { permissions, roles })) {
      openBlockedResource(tab.label);
      return;
    }
    setActiveTab(nextTab);
  };

  const openNewTask = (waypoint) => {
    if (!canManageTasks) {
      openBlockedResource("Producción / Gestión de tareas");
      return;
    }
    setTaskModal({
      open: true,
      task: null,
      defaults: {
        domain: domainKeyFromTab(activeTab),
        date: filters.date,
        turno: filters.turno || "B",
        nivel: waypoint?.nivel || filters.nivel || "",
        postura: waypoint?.postura || "",
        mapCode: waypoint?.mapCode || filters.mapCode,
        waypointId: waypoint?.id || "",
      },
    });
  };

  const handleQuickCreateTask = ({ row, lineKey, slotLabel }) => {
    if (!canManageTasks) {
      openBlockedResource("Producción / Gestión de tareas");
      return;
    }
    const slotMeta = slotLabel
      ? slotWindow(filters.date || payload?.meta?.operationDate, slotLabel)
      : { start: null, end: null };
    setSelectedWaypointId(row.waypointId);
    setTaskModal({
      open: true,
      task: null,
      defaults: {
        domain: domainKeyFromTab(activeTab),
        date: filters.date || String(payload?.meta?.operationDate || "").slice(0, 10),
        turno: filters.turno || row.tasks[0]?.turno || "B",
        nivel: row.nivel,
        postura: row.postura,
        mapCode: row.mapCode,
        waypointId: row.waypointId,
        plannedStart: slotMeta.start ? toDateTimeLocalValue(slotMeta.start) : "",
        plannedEnd: slotMeta.end ? toDateTimeLocalValue(slotMeta.end) : "",
        realStart:
          lineKey === "real" || lineKey === "resourceReal"
            ? toDateTimeLocalValue(slotMeta.start)
            : "",
        realEnd:
          lineKey === "real" || lineKey === "resourceReal"
            ? toDateTimeLocalValue(slotMeta.end)
            : "",
      },
    });
  };

  const openEditTask = (task) => {
    if (!canManageTasks) {
      openBlockedResource("Producción / Gestión de tareas");
      return;
    }
    setSelectedTaskId(task.id);
    setSelectedWaypointId(task.waypointId);
    setTaskModal({
      open: true,
      task,
      defaults: {},
    });
  };

  const handleTaskSave = async (task) => {
    if (!payload) return;
    if (!canManageTasks) {
      openBlockedResource("Producción / Gestión de tareas");
      return;
    }

    const nextPayload = JSON.parse(JSON.stringify(payload));
    const targetKey = task.domain === "oocc" ? "controlOOCC" : "controlMineria";
    const targetTasks = nextPayload.schedule[targetKey] || [];
    const taskId = task.id || `${task.domain}-${targetTasks.length + 1}`.toLowerCase();
    const nextTask = {
      ...task,
      id: taskId,
      plannedMinutes:
        task.plannedStart && task.plannedEnd
          ? Math.max(0, Math.round((new Date(task.plannedEnd) - new Date(task.plannedStart)) / 60000))
          : 0,
      realMinutes:
        task.realStart && task.realEnd
          ? Math.max(0, Math.round((new Date(task.realEnd) - new Date(task.realStart)) / 60000))
          : 0,
      delayMinutes:
        task.plannedStart && task.plannedEnd && task.realStart && task.realEnd
          ? Math.max(
              0,
              Math.round(
                (new Date(task.realEnd) -
                  new Date(task.realStart) -
                  (new Date(task.plannedEnd) - new Date(task.plannedStart))) /
                  60000
              )
            )
          : 0,
      status:
        task.progress >= 1
          ? "completed"
          : task.realStart && !task.realEnd
          ? "in_progress"
          : task.realEnd &&
            task.plannedEnd &&
            new Date(task.realEnd).getTime() > new Date(task.plannedEnd).getTime()
          ? "delayed"
          : task.realStart
          ? "partially_complete"
          : "planned",
    };

    const nextTasks = targetTasks.some((item) => item.id === nextTask.id)
      ? targetTasks.map((item) => (item.id === nextTask.id ? nextTask : item))
      : [...targetTasks, nextTask];

    nextPayload.schedule[targetKey] = sortTasks(nextTasks);

    const mergedTasks = [
      ...(nextPayload.schedule.controlMineria || []),
      ...(nextPayload.schedule.controlOOCC || []),
    ];
    nextPayload.schedule.waypoints = rebuildWaypoints(mergedTasks, nextPayload.schedule.waypoints || []);
    nextPayload.dashboard.cumplimientoMineria = calculateAverageProgress(nextPayload.schedule.controlMineria || []);
    nextPayload.dashboard.cumplimientoOOCC = calculateAverageProgress(nextPayload.schedule.controlOOCC || []);

    const saved = await saveProductionModulePayload(nextPayload);
    setPayload(saved);
    setSelectedWaypointId(nextTask.waypointId);
    setSelectedTaskId(nextTask.id);
    setTaskModal({ open: false, task: null, defaults: {} });
  };

  const handleTaskDelete = async (task) => {
    if (!payload || !task?.id) return;
    if (!canManageTasks) {
      openBlockedResource("Producción / Gestión de tareas");
      return;
    }

    const nextPayload = JSON.parse(JSON.stringify(payload));
    const targetKey = task.domain === "oocc" ? "controlOOCC" : "controlMineria";
    nextPayload.schedule[targetKey] = (nextPayload.schedule[targetKey] || []).filter(
      (item) => item.id !== task.id
    );

    const mergedTasks = [
      ...(nextPayload.schedule.controlMineria || []),
      ...(nextPayload.schedule.controlOOCC || []),
    ];
    nextPayload.schedule.waypoints = rebuildWaypoints(mergedTasks, nextPayload.schedule.waypoints || []);
    nextPayload.dashboard.cumplimientoMineria = calculateAverageProgress(nextPayload.schedule.controlMineria || []);
    nextPayload.dashboard.cumplimientoOOCC = calculateAverageProgress(nextPayload.schedule.controlOOCC || []);

    const saved = await saveProductionModulePayload(nextPayload);
    setPayload(saved);
    setSelectedTaskId((current) => (current === task.id ? null : current));
    setTaskModal({ open: false, task: null, defaults: {} });
  };

  const handleInlineRowUpdate = async (row, field, value) => {
    if (!payload) return;
    if (!canManageTasks) {
      openBlockedResource("Producción / Gestión de tareas");
      return;
    }

    const nextPayload = JSON.parse(JSON.stringify(payload));
    const updateTask = (task) => {
      if (task.waypointId !== row.waypointId) return task;
      if (field === "postura") {
        return { ...task, postura: value || task.postura };
      }
      if (field === "notes") {
        return { ...task, observation: value };
      }
      return task;
    };

    nextPayload.schedule.controlMineria = (nextPayload.schedule.controlMineria || []).map(updateTask);
    nextPayload.schedule.controlOOCC = (nextPayload.schedule.controlOOCC || []).map(updateTask);
    nextPayload.schedule.waypoints = (nextPayload.schedule.waypoints || []).map((item) =>
      item.id === row.waypointId
        ? {
            ...item,
            postura: field === "postura" ? value || item.postura : item.postura,
            label: field === "postura" ? value || item.label : item.label,
            observations: field === "notes" ? value : item.observations,
          }
        : item
    );
    nextPayload.schedule.ganttMineria = {
      ...(nextPayload.schedule.ganttMineria || {}),
      rows: (nextPayload.schedule.ganttMineria?.rows || []).map((item) =>
        item.waypointId === row.waypointId
          ? {
              ...item,
              postura: field === "postura" ? value || item.postura : item.postura,
              observations: field === "notes" ? value : item.observations,
            }
          : item
      ),
    };
    nextPayload.schedule.ganttOOCC = {
      ...(nextPayload.schedule.ganttOOCC || {}),
      rows: (nextPayload.schedule.ganttOOCC?.rows || []).map((item) =>
        item.waypointId === row.waypointId
          ? {
              ...item,
              postura: field === "postura" ? value || item.postura : item.postura,
              observations: field === "notes" ? value : item.observations,
            }
          : item
      ),
    };

    const saved = await saveProductionModulePayload(nextPayload);
    setPayload(saved);
  };

  const handleExportGanttPdf = (domain) => {
    const rows = domain === "oocc" ? ganttOoccRows : ganttMineriaRows;
    const title = domain === "oocc" ? "Gantt OO.CC" : "Gantt minería";
    const turno = domain === "oocc"
      ? filteredOoccTasks[0]?.turno || filters.turno
      : filteredMineriaTasks[0]?.turno || filters.turno;

    exportProductionGanttPdf({
      title,
      rows,
      slotLabels: PRODUCTION_GANTT_SLOTS,
      operationDate: filters.date || payload?.meta?.operationDate,
      turno,
      mapLabel: activeMapLabel,
    });
  };

  const handleExportGanttExcel = (domain) => {
    const exportUrl = buildProductionWorkbookExportUrl({ domain, filters });
    const link = document.createElement("a");
    link.href = exportUrl;
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-[calc(100vh-64px)] bg-slate-950/5 p-3 sm:p-4">
      <PageShell
        eyebrow="Módulo Producción"
        title="Producción"
        description={null}
        stats={[
          {
            icon: <FaMountain />,
            label: "Cumplimiento minería",
            value: formatPercent(mineriaProgress),
            meta: "Promedio actualizado del control diario",
            tone: "green",
          },
          {
            icon: <FaClipboardList />,
            label: "Cumplimiento OO.CC",
            value: formatPercent(ooccProgress),
            meta: "Seguimiento consolidado del frente OO.CC",
            tone: "blue",
          },
          {
            icon: <FaRoute />,
            label: "Tareas del día",
            value: allTasks.length,
            meta: `${waypoints.length} posturas mapeadas`,
            tone: "indigo",
          },
          {
            icon: <FaLink />,
            label: "Cruces con Tracking",
            value: linkedTasksCount,
            meta: "Tareas con personas/vehículos vinculados",
            tone: "amber",
          },
        ]}
      >
        <div className="space-y-5">
          <SectionCard
            title="Filtros operativos"
            subtitle="Puedes filtrar por fecha, turno, nivel, mapa y texto libre para cruzar rápidamente frentes, actividades y entidades asignadas."
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <label className="block">
                <FieldShell label="Fecha">
                  <select
                    className="tm-control"
                    value={filters.date}
                    onChange={(event) => setFilters((current) => ({ ...current, date: event.target.value }))}
                  >
                    <option value="">Todas</option>
                    {filterOptions.dates.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </FieldShell>
              </label>

              <label className="block">
                <FieldShell label="Turno">
                  <select
                    className="tm-control"
                    value={filters.turno}
                    onChange={(event) => setFilters((current) => ({ ...current, turno: event.target.value }))}
                  >
                    <option value="">Todos</option>
                    {filterOptions.shifts.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </FieldShell>
              </label>

              <label className="block">
                <FieldShell label="Nivel">
                  <select
                    className="tm-control"
                    value={filters.nivel}
                    onChange={(event) => setFilters((current) => ({ ...current, nivel: event.target.value }))}
                  >
                    <option value="">Todos</option>
                    {filterOptions.levels.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </FieldShell>
              </label>

              <label className="block">
                <FieldShell label="Texto libre">
                  <input
                    type="text"
                    className="tm-control"
                    value={filters.search}
                    placeholder="Postura, actividad, equipo, persona..."
                    onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                  />
                </FieldShell>
              </label>

              <div className="flex items-end">
                <ActionButton
                  variant="secondary"
                  className="w-full"
                  onClick={() =>
                    setFilters((current) => ({
                      ...current,
                      nivel: "",
                      turno: "",
                      search: "",
                    }))
                  }
                >
                  Limpiar
                </ActionButton>
              </div>
            </div>
          </SectionCard>

          {loading || !payload ? (
            <SectionCard title="Cargando Producción">
              <div className="text-sm text-slate-500">Preparando plano, gantt y tablas del módulo...</div>
            </SectionCard>
          ) : (
            <>
              {canUsePlanView ? (
                <ProductionMapPanel
                  maps={payload.meta.maps || []}
                  selectedMapCode={filters.mapCode}
                  onMapCodeChange={(value) => setFilters((current) => ({ ...current, mapCode: value }))}
                  waypoints={filteredWaypoints}
                  tasksByWaypoint={waypointTaskMap}
                  selectedWaypointId={selectedWaypointId}
                  onSelectWaypoint={setSelectedWaypointId}
                  onOpenNewTask={openNewTask}
                  onOpenEditTask={openEditTask}
                  canManageTasks={canManageTasks}
                  onBlockedTaskAction={openBlockedResource}
                />
              ) : (
                <SectionCard
                  title="Plano de producción"
                  subtitle="El perfil actual puede ingresar al módulo, pero no tiene permiso para abrir el plano operativo."
                  actions={
                    <ActionButton variant="secondary" onClick={() => openBlockedResource("Producción / Plano")}>
                      Ver restricción
                    </ActionButton>
                  }
                >
                  <div className="text-sm text-slate-500">
                    Solicita al administrador el submódulo <span className="font-semibold text-slate-800">Producción / Plano</span> para usar herramientas de mapa, zoom, medición y marcado.
                  </div>
                </SectionCard>
              )}

              <SectionCard
                title="Cruce con Tracking"
                subtitle="Valida si las personas y vehículos vinculados estuvieron en el frente correcto durante la ventana esperada."
                actions={
                  selectedTask ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={trackingSummary.tone}>{trackingSummary.label}</StatusBadge>
                      <StatusBadge tone="blue">{selectedTask.id}</StatusBadge>
                    </div>
                  ) : null
                }
              >
                <div className="space-y-4">
                  <MetricStrip
                    items={[
                      {
                        label: "Tarea seleccionada",
                        value: selectedTask?.activity || "Sin selección",
                        meta: selectedTask ? `${selectedTask.postura} · ${formatDateLabel(selectedTask.date)}` : "Selecciona o edita una tarea",
                      },
                      {
                        label: "Ventana planificada",
                        value: selectedTask ? formatTimeRange(selectedTask.plannedStart, selectedTask.plannedEnd) : "Sin horario",
                        meta: selectedTask ? formatDuration(selectedTask.plannedMinutes) : "Duración estimada",
                      },
                      {
                        label: "Pórtico Tracking",
                        value: selectedTask?.trackingPorticoName || "Sin vincular",
                        meta: selectedTask?.trackingPorticoId ? `ID ${selectedTask.trackingPorticoId}` : "Configúralo en la tarea",
                      },
                      {
                        label: "Estado de cuadre",
                        value: trackingSummary.label,
                        meta: trackingSummary.description,
                      },
                    ]}
                  />

                  <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white/92">
                    <div className="border-b border-slate-200/80 px-4 py-3 text-sm font-semibold text-slate-900">
                      Detalle por entidad
                    </div>
                    <div className="overflow-x-auto">
                      <table className="tm-data-table min-w-full text-slate-900">
                        <thead>
                          <tr className="text-left">
                            <th>Entidad</th>
                            <th>Tipo</th>
                            <th>Match</th>
                            <th>Eventos</th>
                            <th>Permanencia</th>
                            <th>Primer / último evento</th>
                          </tr>
                        </thead>
                        <tbody>
                          {validationLoading ? (
                            <tr>
                              <td colSpan={6} className="text-center text-slate-500">
                                Validando con Tracking...
                              </td>
                            </tr>
                          ) : (trackingValidation?.items || []).length > 0 ? (
                            trackingValidation.items.map((item) => (
                              <tr key={`${item.entityType}-${item.id}`}>
                                <td>{item.name || item.label}</td>
                                <td>{item.entityType}</td>
                                <td>{item.matched ? "Sí" : "No"}</td>
                                <td>{item.events}</td>
                                <td>{item.dwellMinutes} min</td>
                                <td>
                                  {item.firstSeen
                                    ? `${formatTimeRange(item.firstSeen, item.lastSeen || item.firstSeen)}`
                                    : "Sin eventos"}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={6} className="text-center text-slate-500">
                                {trackingSummary.description}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </SectionCard>

              <div className="space-y-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <SegmentedTabs items={TAB_ITEMS} value={activeTab} onChange={handleProtectedTabChange} />

                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone="green">{formatDateLabel(filters.date || payload.meta.operationDate)}</StatusBadge>
                    <StatusBadge tone="blue">{filters.mapCode}</StatusBadge>
                    <ActionButton onClick={() => openNewTask(null)}>
                      Nueva tarea
                    </ActionButton>
                  </div>
                </div>

                {!activeTabAllowed ? (
                  <SectionCard
                    title="Submódulos de Producción"
                    subtitle="Selecciona una vista habilitada o pide acceso al submódulo que necesitas."
                    actions={
                      <ActionButton variant="secondary" onClick={() => openBlockedResource("Producción / Submódulos")}>
                        Ver restricción
                      </ActionButton>
                    }
                  >
                    <div className="text-sm text-slate-500">
                      Este perfil no tiene tabs operativas habilitadas dentro de Producción.
                    </div>
                  </SectionCard>
                ) : null}

                {activeTabAllowed && activeTab === "ganttMineria" ? (
                  <WorkbookGanttBoard
                    title="Gantt minería"
                    subtitle="Vista horaria del programa y ejecución por postura, alineada con el control del turno."
                    rows={ganttMineriaRows}
                    slotLabels={PRODUCTION_GANTT_SLOTS}
                    completionLabel={formatPercent(mineriaProgress)}
                    operationDateLabel={operationDateLabel}
                    turno={filteredMineriaTasks[0]?.turno || filters.turno}
                    mapLabel={activeMapLabel}
                    onEditTask={openEditTask}
                    onQuickCreateTask={handleQuickCreateTask}
                    onInlineRowUpdate={handleInlineRowUpdate}
                    onExportPdf={() => handleExportGanttPdf("mineria")}
                    onExportExcel={() => handleExportGanttExcel("mineria")}
                    canManageTasks={canManageTasks}
                    onBlockedTaskAction={openBlockedResource}
                  />
                ) : null}

                {activeTabAllowed && activeTab === "controlMineria" ? (
                  <ControlTable
                    title="Control minería"
                    subtitle="Tabla operativa equivalente a la hoja de control, enriquecida con personas, vehículos y tracking."
                    tasks={sortTasks(filteredMineriaTasks)}
                    onEditTask={openEditTask}
                    onDeleteTask={handleTaskDelete}
                  />
                ) : null}

                {activeTabAllowed && activeTab === "ganttOocc" ? (
                  <WorkbookGanttBoard
                    title="Gantt OO.CC"
                    subtitle="Seguimiento horario de actividades OO.CC con la misma lógica de frente, recursos y validación."
                    rows={ganttOoccRows}
                    slotLabels={PRODUCTION_GANTT_SLOTS}
                    completionLabel={formatPercent(ooccProgress)}
                    operationDateLabel={operationDateLabel}
                    turno={filteredOoccTasks[0]?.turno || filters.turno}
                    mapLabel={activeMapLabel}
                    onEditTask={openEditTask}
                    onQuickCreateTask={handleQuickCreateTask}
                    onInlineRowUpdate={handleInlineRowUpdate}
                    onExportPdf={() => handleExportGanttPdf("oocc")}
                    onExportExcel={() => handleExportGanttExcel("oocc")}
                    canManageTasks={canManageTasks}
                    onBlockedTaskAction={openBlockedResource}
                  />
                ) : null}

                {activeTabAllowed && activeTab === "controlOocc" ? (
                  <ControlTable
                    title="Control OO.CC"
                    subtitle="Control detallado para enfierradura, carpetas, buzones y demás actividades OO.CC."
                    tasks={sortTasks(filteredOoccTasks)}
                    onEditTask={openEditTask}
                    onDeleteTask={handleTaskDelete}
                  />
                ) : null}

                {activeTabAllowed && activeTab === "hoursMineria" ? (
                  <HoursBoard hoursData={payload.schedule.hoursMineria} />
                ) : null}
              </div>
            </>
          )}
        </div>
      </PageShell>

      <ProductionTaskModal
        open={taskModal.open && canManageTasks}
        task={taskModal.task}
        defaults={taskModal.defaults}
        referenceData={payload?.referenceData}
        masters={masters}
        waypoints={payload?.schedule?.waypoints || []}
        onClose={() => setTaskModal({ open: false, task: null, defaults: {} })}
        onSave={handleTaskSave}
        onDelete={handleTaskDelete}
      />

      <AccessDeniedModal
        open={Boolean(blockedResource)}
        resourceLabel={blockedResource || "este recurso"}
        onClose={() => setBlockedResource("")}
      />
    </div>
  );
}
