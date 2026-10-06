import React, { useEffect, useMemo, useRef, useState } from "react";
import { BsArrowClockwise, BsGeoAltFill, BsTrash3 } from "react-icons/bs";
import { FaCar, FaMapMarkedAlt, FaRoute, FaTools, FaUser } from "react-icons/fa";

import { API_URL } from "../api-config";
import NodeHistoryTable from "./NodeHistoryTable";

const API = `${API_URL}/control/maps`;

const MAPS = [
  { label: "Diamante - NP", code: "NP_dia" },
  { label: "NTI Andes Norte", code: "NTI_andes_norte" },
];

function formatDateTime(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("es-CL", {
      hour12: false,
      timeZone: "America/Santiago",
    });
  } catch (_error) {
    return value;
  }
}

function typeLabel(entityType) {
  if (entityType === "person") return "Persona";
  if (entityType === "vehicle") return "Vehiculo";
  if (entityType === "equipment") return "Equipo";
  if (entityType === "portico") return "Pórtico";
  return entityType || "Entidad";
}

function extractPorticoSequence(porticoName) {
  if (!porticoName) return null;

  const directMatch = String(porticoName).match(/^\s*(\d+)/);
  if (directMatch) return Number(directMatch[1]);

  const fallbackMatch = String(porticoName).match(/(\d+)/);
  return fallbackMatch ? Number(fallbackMatch[1]) : null;
}

function getRoutePointKey(item) {
  if (item?.portico?.id != null) return `portico-${item.portico.id}`;
  if (item?.sequence != null) return `sequence-${item.sequence}`;
  return `${item?.x_pct ?? "x"}-${item?.y_pct ?? "y"}`;
}

function buildMapCoverage(history) {
  const coverage = new Map();

  for (const item of history || []) {
    const mapCode = item?.map?.map_code;
    if (!mapCode) continue;

    const entry = coverage.get(mapCode) || {
      mapCode,
      mappedEvents: 0,
      uniquePorticos: new Set(),
      sequences: new Set(),
    };

    entry.mappedEvents += 1;

    if (item?.portico?.id != null) {
      entry.uniquePorticos.add(String(item.portico.id));
    }

    const sequence = extractPorticoSequence(item?.portico?.name);
    if (sequence != null) {
      entry.sequences.add(sequence);
    }

    coverage.set(mapCode, entry);
  }

  return coverage;
}

function waypointColor(filters) {
  const onlyPeople = filters.people && !filters.vehicles && !filters.equipment;
  const onlyVehicles = !filters.people && filters.vehicles && !filters.equipment;
  const onlyEquipment = !filters.people && !filters.vehicles && filters.equipment;

  if (onlyPeople) return "rgba(34, 197, 94, 0.92)";
  if (onlyVehicles) return "rgba(37, 99, 235, 0.92)";
  if (onlyEquipment) return "rgba(249, 115, 22, 0.92)";
  return "rgba(79, 70, 229, 0.9)";
}

function climateBorder(level) {
  if (level === "red") return "2px solid rgba(220, 38, 38, 0.95)";
  if (level === "yellow") return "2px solid rgba(234, 179, 8, 0.95)";
  if (level === "green") return "2px solid rgba(34, 197, 94, 0.95)";
  return "2px solid rgba(255, 255, 255, 0.85)";
}

function summarizeWaypointCount(waypoint, filters) {
  let total = 0;
  if (filters.people) total += Number(waypoint.people_count || 0);
  if (filters.vehicles) total += Number(waypoint.vehicle_count || 0);
  if (filters.equipment) total += Number(waypoint.equipment_count || 0);
  return total;
}

function resolvePrimaryFilter(filters) {
  if (filters.people && !filters.vehicles && !filters.equipment) return "person";
  if (!filters.people && filters.vehicles && !filters.equipment) return "vehicle";
  if (!filters.people && !filters.vehicles && filters.equipment) return "equipment";
  return null;
}

function subfilterLabel(entityType) {
  if (entityType === "vehicle") return "Tipo o nombre de vehículo";
  if (entityType === "equipment") return "Nombre de equipo";
  if (entityType === "person") return "Nombre de persona";
  return "Subfiltro";
}

function fleetSubfilterLabel(entityType) {
  if (entityType === "vehicle") return "Tipo de vehiculo";
  if (entityType === "equipment") return "Tipo de equipo";
  if (entityType === "person") return "Cargo de persona";
  return subfilterLabel(entityType);
}

function fleetScopeLabel(scope) {
  return scope === "current" ? "Posicion actual" : "Dia";
}

function FleetMapControlButton({ icon, label, active = false, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`flex h-9 w-9 items-center justify-center rounded-xl border text-xs transition sm:h-10 sm:w-10 sm:rounded-2xl sm:text-sm ${
        active
          ? "border-transparent bg-[linear-gradient(135deg,#4f46e5_0%,#2563eb_100%)] text-white shadow-[0_16px_30px_rgba(79,70,229,0.26)]"
          : "border-white/75 bg-white/92 text-slate-600 shadow-[0_12px_25px_rgba(15,23,42,0.12)] hover:bg-white hover:text-slate-900"
      }`}
    >
      {icon}
    </button>
  );
}

function toEntityRows(detail, entityType) {
  if (!detail) return [];

  if (entityType === "person") {
    return (detail.personas || []).map((item) => ({
      id: item.id,
      entityType,
      label: item.full_name || item.name || item.display_name || "Persona",
      secondary: item.company_name || item.position || "-",
      lastSeenAt: item.last_seen_at,
    }));
  }

  if (entityType === "vehicle") {
    return (detail.vehiculos || []).map((item) => ({
      id: item.id,
      entityType,
      label: item.patente || item.name || item.display_name || "Vehiculo",
      secondary: item.company_name || item.type || "-",
      lastSeenAt: item.last_seen_at,
    }));
  }

  return (detail.equipos || []).map((item) => ({
    id: item.id,
    entityType,
    label: item.name || item.code || item.display_name || "Equipo",
    secondary: item.company_name || item.zone || "-",
    lastSeenAt: item.last_seen_at,
  }));
}

function buildRouteModel(history, selectedMap, waypoints) {
  return buildGuidedRouteModel(history, selectedMap, waypoints);
  /*
  const mappedEvents = (history || [])
    .filter((item) => item?.map?.map_code === selectedMap)
    .filter((item) => item?.map?.x_pct != null && item?.map?.y_pct != null)
    .map((item) => ({
      ...item,
      x_pct: Number(item.map.x_pct),
      y_pct: Number(item.map.y_pct),
    }));

  if (mappedEvents.length === 0) {
    return {
      mode: "none",
      points: [],
      mappedEvents: [],
      uniquePorticos: 0,
      uniquePorticoNames: [],
    };
  }

  const uniquePorticoMap = new Map();
  for (const item of mappedEvents) {
    if (item?.portico?.id == null) continue;
    uniquePorticoMap.set(String(item.portico.id), item.portico.name || `Pórtico ${item.portico.id}`);
  }

  if (uniquePorticoMap.size <= 1 && mappedEvents.length > 1) {
    const center = mappedEvents[0];
    const baseRadius = 0.02;
    const syntheticPoints = mappedEvents.map((item, index) => {
      const angle = (-Math.PI / 2) + (index / Math.max(mappedEvents.length, 1)) * (Math.PI * 2);
      const radius = baseRadius + (item.direction === "out" ? 0.008 : 0);

      return {
        ...item,
        x_pct: clamp01(center.x_pct + Math.cos(angle) * radius),
        y_pct: clamp01(center.y_pct + Math.sin(angle) * radius),
        isSyntheticLocal: true,
        anchor_x_pct: center.x_pct,
        anchor_y_pct: center.y_pct,
      };
    });

    return {
      mode: "local",
      points: syntheticPoints,
      mappedEvents,
      uniquePorticos: uniquePorticoMap.size || 1,
      uniquePorticoNames: [...uniquePorticoMap.values()],
    };
  }

  const points = [];
  for (const item of mappedEvents) {
    const previous = points[points.length - 1];
    if (previous && previous.portico?.id === item.portico?.id) {
      continue;
    }

    points.push(item);
  }

  return {
    mode: points.length > 1 ? "network" : "single",
    points,
    mappedEvents,
    uniquePorticos: uniquePorticoMap.size || (points.length > 0 ? 1 : 0),
    uniquePorticoNames: [...uniquePorticoMap.values()],
  };
  */
}

function getBestRouteMapCode(history, selectedMap) {
  return resolveGuidedRouteMapCode(history, selectedMap);
  /*
  const counts = new Map();

  for (const item of history || []) {
    const mapCode = item?.map?.map_code;
    if (!mapCode) continue;

    const current = counts.get(mapCode) || {
      points: 0,
      porticos: new Set(),
    };
    current.points += 1;
    if (item?.portico?.id != null) {
      current.porticos.add(String(item.portico.id));
    }
    counts.set(mapCode, current);
  }

  let bestCode = null;
  let bestScore = -1;

  for (const [mapCode, info] of counts.entries()) {
    const score = info.porticos.size * 1000 + info.points;
    if (score > bestScore) {
      bestScore = score;
      bestCode = mapCode;
    }
  }

  return bestCode;
  */
}

function getRouteSegments(routePoints) {
  return getGuidedRouteSegments(routePoints);
  /*
  const segments = [];

  for (let index = 0; index < routePoints.length - 1; index += 1) {
    const from = routePoints[index];
    const to = routePoints[index + 1];

    if (!from || !to) continue;
    if (from.x_pct == null || from.y_pct == null || to.x_pct == null || to.y_pct == null) {
      continue;
    }

    segments.push({
      id: `${from.portico?.id || "from"}-${to.portico?.id || "to"}-${index}`,
      from,
      to,
      isLocal: mode === "local",
    });
  }

  return segments;
  */
}

function resolveGuidedRouteMapCode(history, selectedMap) {
  const coverage = buildMapCoverage(history);
  if (coverage.size === 0) return selectedMap;

  const current = selectedMap ? coverage.get(selectedMap) : null;
  if (current && current.uniquePorticos.size > 1) {
    return selectedMap;
  }

  let bestCode = selectedMap;
  let bestScore = -1;

  for (const [mapCode, info] of coverage.entries()) {
    const score = (info.uniquePorticos.size * 1000) + (info.sequences.size * 100) + info.mappedEvents;
    if (score > bestScore) {
      bestScore = score;
      bestCode = mapCode;
    }
  }

  return bestCode || selectedMap;
}

function expandGuidedRoutePoints(points, waypointIndex) {
  if (!Array.isArray(points) || points.length <= 1) return points || [];

  const expanded = [];
  const pushPoint = (point) => {
    if (!point) return;
    const previous = expanded[expanded.length - 1];
    if (previous && getRoutePointKey(previous) === getRoutePointKey(point)) {
      return;
    }
    expanded.push(point);
  };

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[index + 1];

    pushPoint(current);

    if (!current || !next) continue;
    if (current.sequence == null || next.sequence == null || current.sequence === next.sequence) {
      continue;
    }

    const step = current.sequence < next.sequence ? 1 : -1;
    for (let sequence = current.sequence + step; sequence !== next.sequence; sequence += step) {
      const waypoint = waypointIndex.get(sequence);
      if (!waypoint) continue;

      pushPoint({
        ts_edge: current.ts_edge,
        ts_event: current.ts_event,
        direction: current.direction,
        zone: waypoint.zone || current.zone,
        sequence,
        x_pct: Number(waypoint.x_pct),
        y_pct: Number(waypoint.y_pct),
        isInferred: true,
        portico: {
          id: waypoint.portico_id,
          name: waypoint.portico_name || `Pórtico ${sequence}`,
        },
        map: {
          device_id: waypoint.device_id,
          map_code: waypoint.map_code,
          x_pct: Number(waypoint.x_pct),
          y_pct: Number(waypoint.y_pct),
        },
      });
    }
  }

  return expanded;
}

function buildGuidedRouteModel(history, selectedMap, waypoints) {
  const mappedEvents = (history || [])
    .filter((item) => item?.map?.map_code === selectedMap)
    .filter((item) => item?.map?.x_pct != null && item?.map?.y_pct != null)
    .map((item) => ({
      ...item,
      x_pct: Number(item.map.x_pct),
      y_pct: Number(item.map.y_pct),
      sequence: extractPorticoSequence(item?.portico?.name),
    }));

  if (mappedEvents.length === 0) {
    return {
      mode: "none",
      points: [],
      actualPoints: [],
      mappedEvents: [],
      uniquePorticos: 0,
      uniquePorticoNames: [],
      inferredPoints: 0,
    };
  }

  const uniquePorticoMap = new Map();
  for (const item of mappedEvents) {
    if (item?.portico?.id == null) continue;
    uniquePorticoMap.set(String(item.portico.id), item.portico.name || `Pórtico ${item.portico.id}`);
  }

  const actualPoints = [];
  for (const item of mappedEvents) {
    const previous = actualPoints[actualPoints.length - 1];
    if (previous && getRoutePointKey(previous) === getRoutePointKey(item)) {
      continue;
    }

    actualPoints.push(item);
  }

  const waypointIndex = new Map(
    (waypoints || [])
      .map((item) => {
        const sequence = extractPorticoSequence(item?.portico_name);
        if (sequence == null) return null;
        return [sequence, item];
      })
      .filter(Boolean)
  );

  const points = expandGuidedRoutePoints(actualPoints, waypointIndex);
  const inferredPoints = points.filter((item) => item.isInferred).length;

  return {
    mode: points.length > 1 ? (inferredPoints > 0 ? "guided" : "network") : "single",
    points,
    actualPoints,
    mappedEvents,
    uniquePorticos: uniquePorticoMap.size || (actualPoints.length > 0 ? 1 : 0),
    uniquePorticoNames: [...uniquePorticoMap.values()],
    inferredPoints,
  };
}

function getGuidedRouteSegments(routePoints) {
  const segments = [];

  for (let index = 0; index < routePoints.length - 1; index += 1) {
    const from = routePoints[index];
    const to = routePoints[index + 1];

    if (!from || !to) continue;
    if (from.x_pct == null || from.y_pct == null || to.x_pct == null || to.y_pct == null) {
      continue;
    }

    segments.push({
      id: `${from.portico?.id || "from"}-${to.portico?.id || "to"}-${index}`,
      from,
      to,
      isGuided: Boolean(from.isInferred || to.isInferred),
    });
  }

  return segments;
}

export default function FleetTrackingView({ selectedMap = "NP_dia", onMapChange }) {
  const [waypoints, setWaypoints] = useState([]);
  const [loadingWaypoints, setLoadingWaypoints] = useState(false);

  const [filters, setFilters] = useState({
    people: true,
    vehicles: true,
    equipment: true,
  });
  const [fleetScope, setFleetScope] = useState("day");
  const [subfilterOptions, setSubfilterOptions] = useState([]);
  const [selectedSubfilters, setSelectedSubfilters] = useState([]);
  const [loadingSubfilters, setLoadingSubfilters] = useState(false);
  const [filteredCountsByDeviceId, setFilteredCountsByDeviceId] = useState({});

  const [selectedWaypointId, setSelectedWaypointId] = useState(null);
  const [selectedWaypointDetail, setSelectedWaypointDetail] = useState(null);
  const [loadingWaypointDetail, setLoadingWaypointDetail] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const searchBoxRef = useRef(null);

  const [selectedEntity, setSelectedEntity] = useState(null);
  const [routeHistory, setRouteHistory] = useState([]);
  const [routeMapCode, setRouteMapCode] = useState(null);
  const [routeVisible, setRouteVisible] = useState(false);
  const [routePlaying, setRoutePlaying] = useState(false);
  const [routeProgress, setRouteProgress] = useState(0);
  const [routeLoading, setRouteLoading] = useState(false);

  const activeFiltersCount = Number(filters.people) + Number(filters.vehicles) + Number(filters.equipment);
  const activePrimaryFilter = useMemo(() => resolvePrimaryFilter(filters), [filters]);
  const activeMapCode = routeVisible && routeMapCode ? routeMapCode : selectedMap;

  useEffect(() => {
    const handleDocumentClick = (event) => {
      if (!searchBoxRef.current?.contains(event.target)) {
        setSearchOpen(false);
      }
    };

    document.addEventListener("mousedown", handleDocumentClick);
    return () => document.removeEventListener("mousedown", handleDocumentClick);
  }, []);

  useEffect(() => {
    if (!activeMapCode) return;
    setLoadingWaypoints(true);

    fetch(`${API}/fleet-waypoints/${activeMapCode}?scope=${encodeURIComponent(fleetScope)}`)
      .then((response) => response.json())
      .then((data) => {
        setWaypoints(Array.isArray(data) ? data : []);
      })
      .catch((error) => {
        console.error("No se pudieron cargar los waypoints de flota:", error);
        setWaypoints([]);
      })
      .finally(() => setLoadingWaypoints(false));
  }, [activeMapCode, fleetScope]);

  useEffect(() => {
    if (!activePrimaryFilter || !activeMapCode) {
      setSubfilterOptions([]);
      setSelectedSubfilters([]);
      setFilteredCountsByDeviceId({});
      return;
    }

    setLoadingSubfilters(true);

    fetch(
      `${API}/fleet-subfilters/${activeMapCode}?entity_type=${encodeURIComponent(activePrimaryFilter)}&scope=${encodeURIComponent(fleetScope)}`
    )
      .then((response) => response.json())
      .then((data) => {
        const items = Array.isArray(data?.items) ? data.items : [];
        setSubfilterOptions(items);
        setSelectedSubfilters((current) =>
          current.filter((value) => items.some((item) => String(item.value) === String(value)))
        );
      })
      .catch((error) => {
        console.error("No se pudieron cargar los subfiltros de flota:", error);
        setSubfilterOptions([]);
        setSelectedSubfilters([]);
      })
      .finally(() => setLoadingSubfilters(false));
  }, [activeMapCode, activePrimaryFilter, fleetScope]);

  useEffect(() => {
    if (!activePrimaryFilter || !activeMapCode) {
      setFilteredCountsByDeviceId({});
      return;
    }

    const params = new URLSearchParams({
      entity_type: activePrimaryFilter,
      scope: fleetScope,
    });
    selectedSubfilters.forEach((item) => params.append("subtype", item));

    fetch(`${API}/fleet-waypoints-filtered/${activeMapCode}?${params.toString()}`)
      .then((response) => response.json())
      .then((data) => {
        const items = Array.isArray(data) ? data : [];
        const nextCounts = {};
        items.forEach((item) => {
          nextCounts[String(item.device_id)] = Number(item.filtered_count || 0);
        });
        setFilteredCountsByDeviceId(nextCounts);
      })
      .catch((error) => {
        console.error("No se pudieron cargar los conteos filtrados de flota:", error);
        setFilteredCountsByDeviceId({});
      });
  }, [activeMapCode, activePrimaryFilter, fleetScope, selectedSubfilters]);

  useEffect(() => {
    const term = searchTerm.trim();
    if (term.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return undefined;
    }

    const timer = setTimeout(async () => {
      try {
        setIsSearching(true);
        const response = await fetch(`${API}/search-node?term=${encodeURIComponent(term)}`);
        const data = await response.json();
        setSearchResults(Array.isArray(data) ? data : []);
        setSearchOpen(true);
      } catch (error) {
        console.error("No se pudo buscar en Flota:", error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  const waypointById = useMemo(() => {
    return new Map(waypoints.map((item) => [String(item.device_id), item]));
  }, [waypoints]);

  const selectedWaypointSummary = selectedWaypointId != null
    ? waypointById.get(String(selectedWaypointId)) || null
    : null;

  useEffect(() => {
    if (selectedWaypointId == null) return;
    if (!selectedWaypointSummary) {
      setSelectedWaypointId(null);
      setSelectedWaypointDetail(null);
    }
  }, [selectedWaypointId, selectedWaypointSummary]);

  const routeModel = useMemo(
    () => buildRouteModel(routeHistory, activeMapCode, waypoints),
    [routeHistory, activeMapCode, waypoints]
  );
  const routePoints = routeModel.points;

  useEffect(() => {
    setRouteProgress(0);
    if (routeVisible) {
      setRoutePlaying(routePoints.length > 1);
    }
  }, [routeVisible, routePoints.length, selectedEntity?.entityId, activeMapCode]);

  useEffect(() => {
    if (!routeVisible || !routePlaying || routePoints.length < 2) return undefined;

    const maxProgress = routePoints.length - 1;
    const timer = setInterval(() => {
      setRouteProgress((prev) => {
        const next = prev + 0.03;
        return next >= maxProgress ? maxProgress : next;
      });
    }, 50);

    return () => clearInterval(timer);
  }, [routeVisible, routePlaying, routePoints.length]);

  useEffect(() => {
    if (routePoints.length < 2) return;
    if (routeProgress >= routePoints.length - 1) {
      setRoutePlaying(false);
    }
  }, [routeProgress, routePoints.length]);

  const sectorRows = useMemo(() => {
    const grouped = new Map();

    for (const waypoint of waypoints) {
      const key = waypoint.zone || "Sin sector";
      if (!grouped.has(key)) {
        grouped.set(key, {
          zone: key,
          people: 0,
          vehicles: 0,
          equipment: 0,
          filtered: 0,
          total: 0,
        });
      }

      const entry = grouped.get(key);
      entry.people += Number(waypoint.people_count || 0);
      entry.vehicles += Number(waypoint.vehicle_count || 0);
      entry.equipment += Number(waypoint.equipment_count || 0);
      entry.filtered += Number(filteredCountsByDeviceId[String(waypoint.device_id)] || 0);
    }

    const rows = [];
    for (const item of grouped.values()) {
      item.total = activePrimaryFilter
        ? item.filtered
        : summarizeWaypointCount(
            {
              people_count: item.people,
              vehicle_count: item.vehicles,
              equipment_count: item.equipment,
            },
            filters
          );
      rows.push(item);
    }

    return rows.sort((left, right) => right.total - left.total || left.zone.localeCompare(right.zone));
  }, [activePrimaryFilter, filteredCountsByDeviceId, filters, waypoints]);

  const currentMapLabel = MAPS.find((item) => item.code === activeMapCode)?.label || activeMapCode;

  const selectedSubfilterLabels = useMemo(
    () =>
      selectedSubfilters
        .map((value) => subfilterOptions.find((item) => String(item.value) === String(value))?.label || value)
        .filter(Boolean),
    [selectedSubfilters, subfilterOptions]
  );

  const handleToggleFilter = (key) => {
    setFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const loadWaypointDetail = async ({ porticoId, deviceId }) => {
    if (!porticoId) return;

    setLoadingWaypointDetail(true);
    try {
      const response = await fetch(
        `${API}/portico-popup/${porticoId}?mode=${fleetScope === "current" ? "current" : "accumulated"}`
      );
      const data = await response.json();
      setSelectedWaypointId(deviceId ?? null);
      setSelectedWaypointDetail(data);
    } catch (error) {
      console.error("No se pudo cargar el detalle del waypoint:", error);
      setSelectedWaypointDetail(null);
    } finally {
      setLoadingWaypointDetail(false);
    }
  };

  const handleSearchSelect = async (result) => {
    if (!result) return;

    setSearchTerm(result.label || "");
    setSearchResults([]);
    setSearchOpen(false);

    const nextMapCode = result.map?.map_code || selectedMap;
    if (nextMapCode && typeof onMapChange === "function") {
      setRouteMapCode(null);
      onMapChange(nextMapCode);
    }

    if (result.portico?.id != null) {
      await loadWaypointDetail({
        porticoId: result.portico.id,
        deviceId: result.map?.device_id ?? null,
      });
    }

    if (["person", "vehicle", "equipment"].includes(result.entity_type)) {
      setSelectedEntity({
        entityType: result.entity_type,
        entityId: result.entity_id,
        label: result.label,
      });
    } else {
      setSelectedEntity(null);
      setRouteHistory([]);
      setRouteVisible(false);
      setRoutePlaying(false);
      setRouteProgress(0);
    }
  };

  const handleSearchButton = () => {
    if (searchResults.length > 0) {
      handleSearchSelect(searchResults[0]);
      return;
    }
    setSearchOpen(true);
  };

  const loadEntityRoute = async ({ entityType, entityId, label }) => {
    if (!entityType || !entityId) return;

    setRouteLoading(true);
    try {
      const response = await fetch(
        `${API}/node-history?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}`
      );
      const data = await response.json();
      const history = Array.isArray(data) ? data : [];
      const bestMapCode = getBestRouteMapCode(history, selectedMap);

      if (bestMapCode && typeof onMapChange === "function") {
        onMapChange(bestMapCode);
      }

      setRouteMapCode(bestMapCode || null);
      setSelectedEntity({ entityType, entityId, label });
      setRouteHistory(history);
      setRouteVisible(true);
      setRoutePlaying(history.length > 1);
      setRouteProgress(0);
    } catch (error) {
      console.error("No se pudo cargar el recorrido:", error);
      setRouteHistory([]);
      setRouteVisible(false);
      setRoutePlaying(false);
      setRouteProgress(0);
    } finally {
      setRouteLoading(false);
    }
  };

  const clearRoute = () => {
    setRouteHistory([]);
    setRouteMapCode(null);
    setRouteVisible(false);
    setRoutePlaying(false);
    setRouteProgress(0);
  };

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.18),_transparent_35%),linear-gradient(135deg,#0f172a_0%,#1e293b_42%,#312e81_100%)] p-4 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:rounded-[28px] sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between sm:gap-5">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-100">
              Flota Inteligente
            </div>
            <div className="mt-3 text-[22px] font-semibold tracking-tight text-white sm:text-[28px]">
              Flota Personas y vehículos
            </div>
            <div className="mt-2 max-w-3xl text-xs text-slate-200/85 sm:text-sm">
              Vista acumulativa por pórtico, sectores y recorridos de personas, vehículos y equipos.
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3 sm:gap-3">
            <HeroMiniStat
              label="Mapa activo"
              value={currentMapLabel}
              icon={<BsGeoAltFill />}
            />
            <HeroMiniStat
              label="Waypoints"
              value={String(waypoints.length)}
              icon={<FaRoute />}
            />
            <HeroMiniStat
              label="Movimiento"
              value={
                routeModel.mode === "guided"
                  ? "Ruta guiada"
                  : routeModel.mode === "network"
                  ? "Ruta"
                  : "Punto"
              }
              icon={<FaCar />}
            />
          </div>
        </div>
      </div>

      <div
        className="rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur"
        ref={searchBoxRef}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            onFocus={() => {
              if (searchResults.length > 0) setSearchOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleSearchButton();
              }
              if (event.key === "Escape") {
                setSearchOpen(false);
              }
            }}
            placeholder="Buscar persona, vehículo, equipo o pórtico para ver flota y recorrido..."
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[13px] text-slate-700 outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-100 sm:px-4 sm:py-3"
          />

          {searchOpen && (
            <div className="mt-2 overflow-hidden rounded-2xl border border-slate-700/80 bg-[radial-gradient(circle_at_top_right,_rgba(37,99,235,0.18),_transparent_35%),linear-gradient(180deg,rgba(2,6,23,0.985)_0%,rgba(15,23,42,0.97)_100%)] shadow-[0_28px_60px_rgba(2,6,23,0.42)] backdrop-blur-xl">
              {isSearching && (
                <div className="px-4 py-3 text-xs text-slate-300">Buscando...</div>
              )}

              {!isSearching && searchResults.length === 0 && searchTerm.trim().length >= 2 && (
                <div className="px-4 py-3 text-xs text-slate-300">
                  Sin resultados para "{searchTerm.trim()}"
                </div>
              )}

              {searchResults.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => handleSearchSelect(result)}
                  className="block w-full border-b border-white/10 bg-transparent px-4 py-3 text-left text-white transition last:border-b-0 hover:bg-white/8"
                >
                  <div className="text-[13px] font-semibold text-white">{result.label}</div>
                  <div className="mt-1 text-xs text-slate-300">
                    {typeLabel(result.entity_type)} · {result.portico?.name || "Sin pórtico"}
                    {result.portico?.zone ? ` · ${result.portico.zone}` : ""}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

          <button
            type="button"
            onClick={handleSearchButton}
            className="rounded-2xl bg-[linear-gradient(135deg,#4f46e5_0%,#2563eb_100%)] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_16px_30px_rgba(79,70,229,0.28)] transition hover:translate-y-[-1px] hover:shadow-[0_20px_36px_rgba(79,70,229,0.34)] sm:px-5 sm:py-3"
          >
            Buscar
          </button>
        </div>
      </div>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 flex-1 space-y-4">
          <div className="rounded-[24px] border border-slate-200 bg-white p-3.5 shadow-[0_18px_45px_rgba(15,23,42,0.08)] sm:rounded-[26px] sm:p-4">
            <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-slate-700">Mapa:</span>
                <select
                  value={activeMapCode}
                  onChange={(event) => {
                    setRouteMapCode(null);
                    onMapChange?.(event.target.value);
                  }}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-700"
                >
                  {MAPS.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-500">
                {loadingWaypoints
                  ? `Actualizando ${fleetScope === "current" ? "posiciones actuales" : "waypoints del día"}...`
                  : `${fleetScope === "current" ? "Posiciones actuales" : "Waypoints del día"}: ${waypoints.length}`}
              </div>
            </div>

            <FleetMapCanvas
              selectedMap={activeMapCode}
              fleetScope={fleetScope}
              activePrimaryFilter={activePrimaryFilter}
              filteredCountsByDeviceId={filteredCountsByDeviceId}
              filters={filters}
              waypoints={waypoints}
              selectedSubfilterLabels={selectedSubfilterLabels}
              selectedWaypointId={selectedWaypointId}
              onWaypointSelect={async (waypoint) => {
                await loadWaypointDetail({
                  porticoId: waypoint.portico_id,
                  deviceId: waypoint.device_id,
                });
              }}
              onClearSelection={() => {
                setSelectedWaypointId(null);
                setSelectedWaypointDetail(null);
              }}
              routePoints={routeVisible ? routePoints : []}
              routeProgress={routeProgress}
              routeVisible={routeVisible}
              routePlaying={routePlaying}
            />
          </div>

          {selectedEntity && (
            <RouteSummaryCard
              selectedEntity={selectedEntity}
              routeHistory={routeHistory}
              routeModel={routeModel}
              routeVisible={routeVisible}
              routeLoading={routeLoading}
              routePlaying={routePlaying}
              onShowRoute={() =>
                loadEntityRoute({
                  entityType: selectedEntity.entityType,
                  entityId: selectedEntity.entityId,
                  label: selectedEntity.label,
                })
              }
              onReplayRoute={() => {
                if (!routeVisible || routePoints.length === 0) {
                  loadEntityRoute({
                    entityType: selectedEntity.entityType,
                    entityId: selectedEntity.entityId,
                    label: selectedEntity.label,
                  });
                  return;
                }

                setRouteVisible(true);
                setRoutePlaying(routePoints.length > 1);
                setRouteProgress(0);
              }}
              onHideRoute={clearRoute}
            />
          )}

          {(selectedWaypointDetail || loadingWaypointDetail) && (
            <WaypointDetailCard
              detail={selectedWaypointDetail}
              summary={selectedWaypointSummary}
              loading={loadingWaypointDetail}
              filters={filters}
              selectedEntity={selectedEntity}
              onShowRoute={({ entityType, entityId, label }) =>
                loadEntityRoute({ entityType, entityId, label })
              }
            />
          )}

          {selectedEntity && (
            <NodeHistoryTable
              history={routeHistory}
              entityType={selectedEntity.entityType}
              label={selectedEntity.label}
            />
          )}
        </div>

        <div className="w-full space-y-3 2xl:sticky 2xl:top-4 2xl:self-start">
          <FilterCard
            fleetScope={fleetScope}
            activePrimaryFilter={activePrimaryFilter}
            filters={filters}
            activeFiltersCount={activeFiltersCount}
            loadingSubfilters={loadingSubfilters}
            onToggleFilter={handleToggleFilter}
            onFleetScopeChange={setFleetScope}
            subfilterLabel={fleetSubfilterLabel(activePrimaryFilter)}
            subfilterOptions={subfilterOptions}
            selectedSubfilters={selectedSubfilters}
            onToggleSubfilter={(value) =>
              setSelectedSubfilters((current) =>
                current.includes(value)
                  ? current.filter((item) => item !== value)
                  : [...current, value]
              )
            }
            onSelectAllSubfilters={() =>
              setSelectedSubfilters(subfilterOptions.map((item) => String(item.value)))
            }
            onClearSubfilters={() => setSelectedSubfilters([])}
          />

          <LegendCard />

          <SectorSummaryCard sectorRows={sectorRows} filters={filters} />
        </div>
      </div>
    </div>
  );
}

function FleetMapCanvas({
  selectedMap,
  fleetScope,
  activePrimaryFilter,
  filteredCountsByDeviceId,
  filters,
  waypoints,
  selectedSubfilterLabels,
  selectedWaypointId,
  onWaypointSelect,
  onClearSelection,
  routePoints,
  routeProgress,
  routeVisible,
  routePlaying,
}) {
  const [visualFxOn, setVisualFxOn] = useState(false);
  const [visualFxAutoMode, setVisualFxAutoMode] = useState(false);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const autoVisualFxRef = useRef(false);
  const manualRouteFxBlockRef = useRef(false);

  const mapRef = useRef(null);
  const routeColor = waypointColor(filters);
  const routeSegments = useMemo(
    () => getRouteSegments(routePoints),
    [routePoints]
  );

  const animatedMarker = useMemo(() => {
    if (!visualFxOn) return null;
    if (!routeVisible || routePoints.length === 0) return null;
    if (routePoints.length === 1) return routePoints[0];

    const currentIndex = Math.min(Math.floor(routeProgress), routePoints.length - 2);
    const nextIndex = Math.min(currentIndex + 1, routePoints.length - 1);
    const progress = Math.max(0, Math.min(1, routeProgress - currentIndex));

    const from = routePoints[currentIndex];
    const to = routePoints[nextIndex];

    return {
      x_pct: from.x_pct + (to.x_pct - from.x_pct) * progress,
      y_pct: from.y_pct + (to.y_pct - from.y_pct) * progress,
    };
  }, [routePoints, routeProgress, routeVisible, visualFxOn]);

  useEffect(() => {
    if (!routeVisible || routePoints.length <= 1) {
      manualRouteFxBlockRef.current = false;
      return;
    }

    if (!visualFxOn && !manualRouteFxBlockRef.current) {
      autoVisualFxRef.current = true;
      setVisualFxAutoMode(true);
      setVisualFxOn(true);
      setScale(1);
      setPan({ x: 0, y: 0 });
      setIsPanning(false);
    }
  }, [routeVisible, routePoints.length, visualFxOn]);

  useEffect(() => {
    if (!autoVisualFxRef.current) return;

    const routeFinished =
      routePoints.length > 1 &&
      !routePlaying &&
      routeProgress >= Math.max(routePoints.length - 1, 0);

    if (!routeFinished && routeVisible) return;

    autoVisualFxRef.current = false;
    manualRouteFxBlockRef.current = false;
    setVisualFxAutoMode(false);
    setVisualFxOn(false);
    setScale(1);
    setPan({ x: 0, y: 0 });
    setIsPanning(false);
  }, [routeVisible, routePlaying, routeProgress, routePoints.length]);

  const handleMouseDown = (event) => {
    if (!visualFxOn) return;
    setIsPanning(true);
    panStartRef.current = {
      x: event.clientX - pan.x,
      y: event.clientY - pan.y,
    };
  };

  const handleMouseMove = (event) => {
    if (!visualFxOn || !isPanning) return;
    setPan({
      x: event.clientX - panStartRef.current.x,
      y: event.clientY - panStartRef.current.y,
    });
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  useEffect(() => {
    const node = mapRef.current;
    if (!node) return undefined;

    const onWheel = (event) => {
      if (!visualFxOn) return;
      event.preventDefault();
      setScale((prev) => Math.min(3, Math.max(0.7, prev + (event.deltaY > 0 ? -0.1 : 0.1))));
    };

    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [visualFxOn]);

  const resetMapView = () => {
    setScale(1);
    setPan({ x: 0, y: 0 });
    setIsPanning(false);
  };

  const toggleVisualFx = () => {
    setVisualFxOn((current) => {
      const next = !current;

      if (!next && routeVisible && routePoints.length > 1) {
        autoVisualFxRef.current = false;
        manualRouteFxBlockRef.current = true;
        setVisualFxAutoMode(false);
      } else if (next) {
        autoVisualFxRef.current = false;
        manualRouteFxBlockRef.current = false;
        setVisualFxAutoMode(false);
      }

      return next;
    });
    resetMapView();
  };

  const activeFilterSummary = [
    filters.people ? "Personas" : null,
    filters.vehicles ? "Vehiculos" : null,
    filters.equipment ? "Equipos" : null,
  ]
    .filter(Boolean)
    .join(" / ");
  const scopeSummaryTitle =
    fleetScope === "current" ? "Posición actual visible" : "Waypoints del día";
  const selectedSubfilterSummary =
    activePrimaryFilter && selectedSubfilterLabels.length > 0
      ? `${selectedSubfilterLabels.length} ${selectedSubfilterLabels.length === 1 ? "seleccion" : "selecciones"} en ${fleetSubfilterLabel(activePrimaryFilter).toLowerCase()}`
      : activePrimaryFilter
      ? `Sin subfiltro multiple en ${fleetSubfilterLabel(activePrimaryFilter).toLowerCase()}`
      : "Subfiltro no disponible con mezcla de entidades";

  return (
    <div className="relative overflow-hidden rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,#e2e8f0_0%,#f8fafc_100%)] sm:rounded-[24px]">
      <div className="absolute right-3 top-3 z-20 flex flex-row flex-wrap justify-end gap-2 sm:flex-col">
        <FleetMapControlButton
          icon={<span className="text-base font-bold">+</span>}
          label="Acercar"
          onClick={() => setScale((prev) => (visualFxOn ? Math.min(3, prev + 0.15) : prev))}
        />
        <FleetMapControlButton
          icon={<span className="text-base font-bold">-</span>}
          label="Alejar"
          onClick={() => setScale((prev) => (visualFxOn ? Math.max(0.7, prev - 0.15) : prev))}
        />
        <FleetMapControlButton
          icon={<BsArrowClockwise />}
          label="Recentrar"
          onClick={resetMapView}
        />
        <FleetMapControlButton
          icon={<FaMapMarkedAlt />}
          label="Activar o desactivar efectos gráficos"
          active={visualFxOn}
          onClick={toggleVisualFx}
        />
        <FleetMapControlButton
          icon={<BsTrash3 />}
          label="Limpiar selección"
          onClick={() => {
            resetMapView();
            onClearSelection?.();
          }}
        />
        <button
          type="button"
          onClick={toggleVisualFx}
          className="hidden rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] shadow-sm"
          title="Bloquear efectos gráficos"
        >
          {visualFxOn ? "Efectos ON" : "Efectos OFF"}
        </button>
        <button
          type="button"
          onClick={() => {
            setScale(1);
            setPan({ x: 0, y: 0 });
          }}
          className="hidden rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] shadow-sm"
          title="Recentrar"
        >
          100%
        </button>
        <button
          type="button"
          onClick={() => {
            setScale(1);
            setPan({ x: 0, y: 0 });
            onClearSelection?.();
          }}
          className="hidden rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] shadow-sm"
          title="Limpiar seleccion"
        >
          Limpiar
        </button>
      </div>

      <div className="absolute left-3 right-20 top-3 z-20 rounded-2xl bg-white/95 px-3 py-2 text-[11px] text-slate-600 shadow-sm backdrop-blur sm:right-auto sm:text-xs">
        <div className="font-semibold text-slate-800">{scopeSummaryTitle}</div>
        <div>Filtros activos: {activeFilterSummary || "Sin filtros activos"}</div>
        <div className="mt-1">
          Efectos gráficos: {visualFxOn ? "activos" : "bloqueados"}
          {visualFxAutoMode ? " - activados automaticamente para mostrar la ruta" : ""}
        </div>
        <div className="mt-1">
          Horizonte: {fleetScopeLabel(fleetScope)} - {selectedSubfilterSummary}
        </div>
      </div>

      <div className="hidden absolute left-3 right-20 top-3 z-20 rounded-2xl bg-white/95 px-3 py-2 text-[11px] text-slate-600 shadow-sm backdrop-blur sm:right-auto sm:text-xs">
        <div className="font-semibold text-slate-800">{scopeSummaryTitle}</div>
        <div>
          Filtros activos: {activeFilterSummary || "Sin filtros activos"}
        </div>
        <div className="mt-1">
          Efectos gráficos: {visualFxOn ? "activos" : "bloqueados"}
          {activePrimaryFilter ? ` · ${fleetSubfilterLabel(activePrimaryFilter)}` : ""}
        </div>
      </div>

      <div
        ref={mapRef}
        className="relative overflow-hidden"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={() => onClearSelection?.()}
        style={{ cursor: visualFxOn ? (isPanning ? "grabbing" : "grab") : "default" }}
      >
        <div
          className="relative select-none"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            transformOrigin: "top left",
            transition: visualFxOn && isPanning ? "none" : "transform 160ms ease-out",
          }}
        >
          <img
            src={`/maps/${selectedMap}.jpeg`}
            alt={`Mapa ${selectedMap}`}
            className="block w-full max-w-none pointer-events-none"
            draggable="false"
          />

          {routeVisible && routeSegments.length > 0 && (
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
            >
              <defs>
                <marker
                  id="fleet-route-arrow"
                  markerWidth="12"
                  markerHeight="12"
                  refX="8"
                  refY="4"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path d="M0,0 L8,4 L0,8 z" fill={routeColor} opacity="0.95" />
                </marker>
              </defs>

              {routeSegments.map((segment) => (
                <g key={segment.id}>
                  <line
                    x1={segment.from.x_pct}
                    y1={segment.from.y_pct}
                    x2={segment.to.x_pct}
                    y2={segment.to.y_pct}
                    stroke="rgba(255,255,255,0.92)"
                    strokeWidth={segment.isGuided ? "0.009" : "0.012"}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    opacity="0.95"
                  />
                  <line
                    x1={segment.from.x_pct}
                    y1={segment.from.y_pct}
                    x2={segment.to.x_pct}
                    y2={segment.to.y_pct}
                    stroke={routeColor}
                    strokeWidth={segment.isGuided ? "0.0045" : "0.006"}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    markerEnd="url(#fleet-route-arrow)"
                    opacity="0.95"
                    strokeDasharray={segment.isGuided ? "0.012 0.008" : undefined}
                  />
                </g>
              ))}
            </svg>
          )}

          {routeVisible &&
            routePoints.map((point, index) => (
              <div
                key={`${point.portico?.id || "route"}-${index}`}
                className="pointer-events-none absolute"
                style={{
                  left: `${point.x_pct * 100}%`,
                  top: `${point.y_pct * 100}%`,
                  transform: "translate(-50%, -50%)",
                }}
              >
                {point.isInferred ? (
                  <div className="flex h-4 w-4 items-center justify-center rounded-full border border-white bg-indigo-500/90 text-[9px] font-semibold text-white shadow-lg">
                    ·
                  </div>
                ) : (
                  <div className="flex h-5 w-5 items-center justify-center rounded-full border border-white bg-slate-900 text-[10px] font-semibold text-white shadow-lg">
                    {index + 1}
                  </div>
                )}
              </div>
            ))}

          {animatedMarker && (
            <div
              className="pointer-events-none absolute"
              style={{
                left: `${animatedMarker.x_pct * 100}%`,
                top: `${animatedMarker.y_pct * 100}%`,
                transform: "translate(-50%, -50%)",
              }}
            >
              <span className="absolute -inset-3 rounded-full border-2 border-indigo-400 animate-ping opacity-60" />
              <div className="relative flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-indigo-600 shadow-lg" />
            </div>
          )}

          {waypoints.map((waypoint) => {
            const filteredCount = Number(filteredCountsByDeviceId[String(waypoint.device_id)] || 0);
            const visibleCount = activePrimaryFilter ? filteredCount : summarizeWaypointCount(waypoint, filters);
            const size = visibleCount > 0 ? Math.min(42, 18 + visibleCount * 2.4) : 14;
            const isSelected = String(selectedWaypointId) === String(waypoint.device_id);
            const waypointBg = visibleCount > 0 ? waypointColor(filters) : "rgba(148, 163, 184, 0.72)";

            return (
              <button
                key={waypoint.device_id}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onWaypointSelect?.(waypoint);
                }}
                className="absolute"
                style={{
                  left: `${Number(waypoint.x_pct) * 100}%`,
                  top: `${Number(waypoint.y_pct) * 100}%`,
                  transform: "translate(-50%, -50%)",
                }}
                title={`${waypoint.portico_name || waypoint.label} · ${visibleCount} activos`}
              >
                <div className="relative flex items-center justify-center">
                  {isSelected && (
                    <span className="absolute -inset-3 rounded-full border-2 border-indigo-500 opacity-80" />
                  )}
                  <div
                    className="flex items-center justify-center rounded-full text-[11px] font-bold text-white shadow-xl"
                    style={{
                      width: `${size}px`,
                      height: `${size}px`,
                      background: waypointBg,
                      border: climateBorder(waypoint.climate_level),
                    }}
                  >
                    {visibleCount > 0 ? visibleCount : ""}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FilterCard({
  fleetScope,
  activePrimaryFilter,
  filters,
  activeFiltersCount,
  loadingSubfilters,
  onToggleFilter,
  onFleetScopeChange,
  subfilterLabel: nestedFilterLabel,
  subfilterOptions,
  selectedSubfilters,
  onToggleSubfilter,
  onSelectAllSubfilters,
  onClearSubfilters,
}) {
  const [subfilterSearch, setSubfilterSearch] = useState("");

  useEffect(() => {
    setSubfilterSearch("");
  }, [activePrimaryFilter, fleetScope]);

  const visibleSubfilterOptions = useMemo(() => {
    const normalizedSearch = subfilterSearch.trim().toLowerCase();
    if (!normalizedSearch) return subfilterOptions;

    return subfilterOptions.filter((item) => {
      const label = String(item.label || "").toLowerCase();
      const value = String(item.value || "").toLowerCase();
      return label.includes(normalizedSearch) || value.includes(normalizedSearch);
    });
  }, [subfilterOptions, subfilterSearch]);

  const selectedSummary =
    selectedSubfilters.length === 0
      ? "Todos"
      : `${selectedSubfilters.length} ${selectedSubfilters.length === 1 ? "seleccionado" : "seleccionados"}`;

  return (
    <div className="rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,#0f172a_0%,#1e1b4b_100%)] p-3.5 text-white shadow-[0_18px_45px_rgba(15,23,42,0.18)] sm:rounded-[24px] sm:p-4">
      <div className="mb-3 text-[13px] font-semibold text-white sm:text-sm">
        Filtros de Flota
      </div>

      <div className="space-y-2 text-[13px] sm:text-sm">
        <FilterToggle
          label="Personas"
          active={filters.people}
          accent="bg-emerald-500"
          onClick={() => onToggleFilter("people")}
        />
        <FilterToggle
          label="Vehículos"
          active={filters.vehicles}
          accent="bg-blue-600"
          onClick={() => onToggleFilter("vehicles")}
        />
        <FilterToggle
          label="Equipos"
          active={filters.equipment}
          accent="bg-orange-500"
          onClick={() => onToggleFilter("equipment")}
        />
      </div>

      <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-xs text-slate-300">
        {activeFiltersCount > 0
          ? `Activos ${activeFiltersCount} filtros para alternar entre personas, vehículos y equipos.`
          : "Sin filtros activos. El mapa deja visibles los pórticos pero sin acumulado."}
      </div>

      <div className="mt-3 space-y-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-100/80">
            Horizonte
          </div>
          <div className="rounded-full border border-white/10 bg-slate-950/35 px-2.5 py-1 text-[11px] font-medium text-white/85">
            {fleetScopeLabel(fleetScope)}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onFleetScopeChange("current")}
            className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
              fleetScope === "current"
                ? "border-transparent bg-[linear-gradient(135deg,#4f46e5_0%,#2563eb_100%)] text-white shadow-[0_14px_28px_rgba(79,70,229,0.24)]"
                : "border-white/10 bg-slate-950/35 text-slate-200 hover:bg-white/10"
            }`}
          >
            Actual
          </button>
          <button
            type="button"
            onClick={() => onFleetScopeChange("day")}
            className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
              fleetScope === "day"
                ? "border-transparent bg-[linear-gradient(135deg,#4f46e5_0%,#2563eb_100%)] text-white shadow-[0_14px_28px_rgba(79,70,229,0.24)]"
                : "border-white/10 bg-slate-950/35 text-slate-200 hover:bg-white/10"
            }`}
          >
            Día
          </button>
        </div>
        <div className="text-xs text-slate-300">
          {fleetScope === "current"
            ? "Actual muestra la posición visible más reciente por pórtico."
            : "Día mantiene el acumulado diario de posiciones como la vista actual."}
        </div>
      </div>

      {activePrimaryFilter ? (
        <div className="mt-3 space-y-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-100/80">
                Subfiltro multiple
              </div>
              <div className="mt-1 text-xs text-slate-300">
                {loadingSubfilters
                  ? "Cargando opciones disponibles..."
                  : `Selecciona uno o varios valores de ${nestedFilterLabel.toLowerCase()}. Si no eliges ninguno, se muestran todos.`}
              </div>
            </div>
            <div className="rounded-full border border-white/10 bg-slate-950/35 px-2.5 py-1 text-[11px] font-medium text-white/85">
              {selectedSummary}
            </div>
          </div>
          <input
            type="text"
            value={subfilterSearch}
            onChange={(event) => setSubfilterSearch(event.target.value)}
            placeholder={`Buscar ${nestedFilterLabel.toLowerCase()}...`}
            className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-500/15"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSelectAllSubfilters}
              disabled={loadingSubfilters || subfilterOptions.length === 0}
              className="rounded-xl border border-white/10 bg-slate-950/35 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Seleccionar todos
            </button>
            <button
              type="button"
              onClick={onClearSubfilters}
              disabled={selectedSubfilters.length === 0}
              className="rounded-xl border border-white/10 bg-slate-950/35 px-3 py-2 text-xs font-medium text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Limpiar
            </button>
          </div>

          <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
            {!loadingSubfilters && visibleSubfilterOptions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-xs text-slate-400">
                Sin coincidencias para este subfiltro.
              </div>
            ) : (
              visibleSubfilterOptions.map((item) => {
                const value = String(item.value);
                const active = selectedSubfilters.includes(value);

                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onToggleSubfilter(value)}
                    className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition ${
                      active
                        ? "border-indigo-300/60 bg-indigo-500/18 text-white shadow-[0_12px_28px_rgba(79,70,229,0.18)]"
                        : "border-white/10 bg-slate-950/30 text-slate-200 hover:bg-white/10"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{item.label}</div>
                      <div className="mt-0.5 text-[11px] text-slate-300">
                        {item.count} visibles en el mapa
                      </div>
                    </div>
                    <div
                      className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                        active ? "bg-white/18 text-white" : "bg-white/8 text-slate-300"
                      }`}
                    >
                      {active ? "ON" : "OFF"}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FilterToggle({ active, accent, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition ${
        active
          ? "border-white/20 bg-white/10 text-white"
          : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`inline-block h-3 w-3 rounded-full ${accent}`} />
        <span>{label}</span>
      </div>
      <span className="text-xs font-semibold">{active ? "ON" : "OFF"}</span>
    </button>
  );
}

function LegendCard() {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-white p-3.5 shadow-[0_18px_45px_rgba(15,23,42,0.08)] sm:rounded-[24px] sm:p-4">
      <div className="mb-3 text-[13px] font-semibold text-slate-900 sm:text-sm">Leyenda Flota</div>

      <div className="space-y-2 text-[11px] text-slate-600 sm:text-xs">
        <LegendRow dotClass="bg-indigo-600" text="Waypoint mixto (personas, vehículos y equipos)" />
        <LegendRow dotClass="bg-emerald-500" text="Solo personas activas" />
        <LegendRow dotClass="bg-blue-600" text="Solo vehículos activos" />
        <LegendRow dotClass="bg-orange-500" text="Solo equipos activos" />
        <LegendRow dotClass="bg-slate-400" text="Pórtico sin acumulado visible" />
        <LegendRow outlineClass="border-red-600" text="Pórtico ambiental crítico" />
      </div>
    </div>
  );
}

function LegendRow({ dotClass, outlineClass, text }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-block h-3 w-3 rounded-full border ${dotClass || "bg-white"} ${outlineClass || "border-white"}`}
      />
      <span>{text}</span>
    </div>
  );
}

function SectorSummaryCard({ sectorRows, filters }) {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-white p-3.5 shadow-[0_18px_45px_rgba(15,23,42,0.08)] sm:rounded-[24px] sm:p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[13px] font-semibold text-slate-900 sm:text-sm">Sectores</div>
        <div className="text-[11px] text-slate-500 sm:text-xs">Acumulado visible</div>
      </div>

      <div className="space-y-2">
        {sectorRows.map((row) => (
          <div key={row.zone} className="rounded-2xl border border-slate-100 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-3 py-2.5">
            <div className="flex items-center justify-between">
              <div className="text-[13px] font-medium text-slate-800 sm:text-sm">{row.zone}</div>
              <div className="text-[13px] font-semibold text-slate-900 sm:text-sm">{row.total}</div>
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              {filters.people ? `P ${row.people} ` : ""}
              {filters.vehicles ? `V ${row.vehicles} ` : ""}
              {filters.equipment ? `E ${row.equipment}` : ""}
            </div>
          </div>
        ))}

        {sectorRows.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500">
            Sin sectores visibles para este mapa.
          </div>
        )}
      </div>
    </div>
  );
}

function RouteSummaryCard({
  selectedEntity,
  routeHistory,
  routeModel,
  routeVisible,
  routeLoading,
  routePlaying,
  onShowRoute,
  onReplayRoute,
  onHideRoute,
}) {
  const routePoints = routeModel?.points || [];
  const actualPoints = routeModel?.actualPoints || [];
  const firstPoint = routePoints[0] || null;
  const lastPoint = routePoints[routePoints.length - 1] || null;
  const uniquePorticos = routeModel?.uniquePorticos || 0;
  const isSinglePoint = routeModel?.mode === "single";
  const isGuidedRoute = routeModel?.mode === "guided";
  const drawnSegments = Math.max(0, routePoints.length - 1);
  const stateLabel = routeVisible
    ? isGuidedRoute
      ? "Ruta guiada"
      : routePlaying
      ? "En movimiento"
      : "Visible"
    : "Oculto";
  const actualFirstPoint = actualPoints[0] || firstPoint || null;
  const actualLastPoint = actualPoints[actualPoints.length - 1] || lastPoint || null;

  return (
    <div className="rounded-[22px] border border-slate-200 bg-white p-3.5 shadow-[0_18px_45px_rgba(15,23,42,0.08)] sm:rounded-[24px] sm:p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-[13px] font-semibold text-slate-900 sm:text-sm">
            Recorrido seleccionado
          </div>
          <div className="text-xs text-slate-500">
            {typeLabel(selectedEntity.entityType)} · {selectedEntity.label}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onShowRoute}
            className="rounded-xl bg-[linear-gradient(135deg,#4f46e5_0%,#2563eb_100%)] px-3 py-2 text-[11px] font-semibold text-white shadow-[0_12px_24px_rgba(79,70,229,0.22)] hover:translate-y-[-1px] sm:text-xs"
          >
            {routeLoading ? "Cargando..." : routeHistory.length > 0 ? "Actualizar ruta" : "Mostrar recorrido"}
          </button>

          <button
            type="button"
            onClick={onReplayRoute}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50 sm:text-xs"
          >
            <span className="inline-flex items-center gap-1">
              <BsArrowClockwise />
              <span>{routePlaying ? "Reproduciendo" : "Reproducir"}</span>
            </span>
          </button>

          <button
            type="button"
            onClick={onHideRoute}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50 sm:text-xs"
          >
            Ocultar
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <MetricCard title="Lecturas hoy" value={routeHistory.length} />
        <MetricCard title="Pórticos únicos" value={uniquePorticos} />
        <MetricCard title="Tramos dibujados" value={drawnSegments} />
        <MetricCard title="Estado" value={stateLabel} />
      </div>

      <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-4 text-[13px] text-slate-600 sm:text-sm">
        {routePoints.length > 1 ? (
          <div className="space-y-1">
            <div>
              <span className="font-semibold text-slate-800">Origen:</span>{" "}
              {actualFirstPoint?.portico?.name || "-"} ({formatDateTime(actualFirstPoint?.ts_edge)})
            </div>
            <div>
              <span className="font-semibold text-slate-800">Destino:</span>{" "}
              {actualLastPoint?.portico?.name || "-"} ({formatDateTime(actualLastPoint?.ts_edge)})
            </div>
            {isGuidedRoute && (
              <div>
                La ruta completa pórticos intermedios del plano para seguir el corredor numerado entre accesos consecutivos.
              </div>
            )}
          </div>
        ) : routePoints.length > 0 ? (
          <>
            <div>
              <span className="font-semibold text-slate-800">Pórtico actual:</span>{" "}
              {firstPoint?.portico?.name || "-"}
            </div>
            <div className="mt-1">Solo existe un waypoint georreferenciado en el historial actual para esta entidad.</div>
          </>
        ) : isSinglePoint ? (
          <div>
            Solo existe un waypoint con coordenadas para esta entidad en el mapa actual. Falta un segundo pórtico georreferenciado para trazar una línea de traslado.
          </div>
        ) : (
          <div>
            No hay waypoints georreferenciados para el mapa actual. Puedes actualizar el recorrido o cambiar de mapa.
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({ title, value }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        {title}
      </div>
      <div className="mt-1 text-lg font-semibold text-slate-900 sm:text-xl">{value}</div>
    </div>
  );
}

function HeroMiniStat({ icon, label, value }) {
  return (
    <div className="min-w-[130px] rounded-2xl border border-white/10 bg-white/10 px-3.5 py-3 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur sm:min-w-[150px] sm:px-4">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-100/80">
        <span className="text-sm text-white">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="mt-2 text-[13px] font-semibold text-white sm:text-sm">{value}</div>
    </div>
  );
}

function WaypointDetailCard({ detail, summary, loading, filters, selectedEntity, onShowRoute }) {
  if (loading) {
    return (
      <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_18px_45px_rgba(15,23,42,0.08)]">
      <div className="text-[13px] text-slate-500 sm:text-sm">Cargando detalle del waypoint...</div>
      </div>
    );
  }

  if (!detail) return null;

  const peopleRows = toEntityRows(detail, "person");
  const vehicleRows = toEntityRows(detail, "vehicle");
  const equipmentRows = toEntityRows(detail, "equipment");

  return (
    <div className="rounded-[22px] border border-slate-200 bg-white p-3.5 shadow-[0_18px_45px_rgba(15,23,42,0.08)] sm:rounded-[24px] sm:p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-[13px] font-semibold text-slate-900 sm:text-sm">
            {detail.portico?.name || summary?.portico_name || "Waypoint de flota"}
          </div>
          <div className="text-xs text-slate-500">
            {detail.portico?.zone || summary?.zone || "Sin sector"}
            {summary?.nivel ? ` · Nivel ${summary.nivel}` : ""}
            {summary?.site ? ` · ${summary.site}` : ""}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <CountBadge icon={<FaUser />} value={peopleRows.length} color="bg-emerald-500" />
          <CountBadge icon={<FaCar />} value={vehicleRows.length} color="bg-blue-600" />
          <CountBadge icon={<FaTools />} value={equipmentRows.length} color="bg-orange-500" />
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
        {filters.people && (
          <EntityTable
            title="Personas"
            accent="text-emerald-600"
            icon={<FaUser />}
            rows={peopleRows}
            selectedEntity={selectedEntity}
            onShowRoute={onShowRoute}
          />
        )}

        {filters.vehicles && (
          <EntityTable
            title="Vehiculos"
            accent="text-blue-600"
            icon={<FaCar />}
            rows={vehicleRows}
            selectedEntity={selectedEntity}
            onShowRoute={onShowRoute}
          />
        )}

        {filters.equipment && (
          <EntityTable
            title="Equipos"
            accent="text-orange-600"
            icon={<FaTools />}
            rows={equipmentRows}
            selectedEntity={selectedEntity}
            onShowRoute={onShowRoute}
          />
        )}
      </div>
    </div>
  );
}

function CountBadge({ color, icon, value }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm">
      <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-white ${color}`}>
        {icon}
      </span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function EntityTable({ title, accent, icon, rows, selectedEntity, onShowRoute }) {
  const [searchTerm, setSearchTerm] = useState("");
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredRows = useMemo(
    () =>
      rows.filter((row) =>
        [row.label, row.secondary, formatDateTime(row.lastSeenAt)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch)
      ),
    [normalizedSearch, rows]
  );

  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
      <div className={`mb-3 flex items-center gap-2 text-sm font-semibold ${accent}`}>
        {icon}
        <span>{title}</span>
      </div>

      <input
        type="text"
        value={searchTerm}
        onChange={(event) => setSearchTerm(event.target.value)}
        placeholder={`Buscar en ${title.toLowerCase()}...`}
        className="mb-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
      />

      <div className="space-y-2">
        {filteredRows.map((row) => {
          const isSelected =
            selectedEntity &&
            String(selectedEntity.entityId) === String(row.id) &&
            selectedEntity.entityType === row.entityType;

          return (
            <div
              key={`${row.entityType}-${row.id}`}
              className={`rounded-xl border px-3 py-2 ${
                isSelected
                  ? "border-indigo-300 bg-indigo-50"
                  : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900">
                    {row.label}
                  </div>
                  <div className="truncate text-xs text-slate-500">{row.secondary}</div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    Ultima lectura: {formatDateTime(row.lastSeenAt)}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    onShowRoute({
                      entityType: row.entityType,
                      entityId: row.id,
                      label: row.label,
                    })
                  }
                  className="shrink-0 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-slate-700"
                >
                  <span className="inline-flex items-center gap-1">
                    <FaRoute />
                    <span>Ver</span>
                  </span>
                </button>
              </div>
            </div>
          );
        })}

        {filteredRows.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500">
            {normalizedSearch
              ? "No hay coincidencias para ese filtro."
              : `Sin ${title.toLowerCase()} en este pórtico.`}
          </div>
        )}
      </div>
    </div>
  );
}
