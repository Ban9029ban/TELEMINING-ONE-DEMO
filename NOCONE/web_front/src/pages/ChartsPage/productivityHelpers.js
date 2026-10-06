export function normalizeText(value) {
  return String(value || "").
  toLowerCase().
  normalize("NFD").
  replace(/[\u0300-\u036f]/g, "").
  replace(/[^a-z0-9]+/g, " ").
  trim();
}

export function buildOptions(items, getValue, getLabel = getValue) {
  const map = new Map();

  (items || []).forEach((item) => {
    const rawValue = getValue(item);
    const value = String(rawValue || "").trim();
    if (!value || map.has(value)) return;
    map.set(value, {
      value,
      label: String(getLabel(item) || rawValue || "").trim() || value
    });
  });

  return Array.from(map.values()).sort((left, right) =>
  left.label.localeCompare(right.label, "es", { sensitivity: "base" })
  );
}

export function buildPersonRoleMap(persons) {
  return Object.fromEntries(
    (persons || []).map((person) => [String(person.id), String(person.role || "").trim()])
  );
}

export function buildVehicleCategory(vehicle) {
  const category = String(
    vehicle?.vehicle_type ||
    vehicle?.type ||
    vehicle?.status_label ||
    vehicle?.status ||
    vehicle?.category ||
    ""
  ).trim();

  return category || "Sin categoría";
}

export function buildVehicleCategoryMap(vehicles) {
  return Object.fromEntries(
    (vehicles || []).map((vehicle) => [String(vehicle.id), buildVehicleCategory(vehicle)])
  );
}

function hasValues(items) {
  return Array.isArray(items) && items.length > 0;
}

function includesValue(items, value) {
  return !hasValues(items) || items.includes(String(value || ""));
}

function matchesPersonFilters(row, filters, context) {
  const personId = String(row?.entity_id || "");
  const role = String(context.personRoleById?.[personId] || "").trim();

  if (hasValues(filters.personIds) && !filters.personIds.includes(personId)) return false;
  if (hasValues(filters.cargos) && !filters.cargos.includes(role)) return false;
  return true;
}

function matchesVehicleFilters(row, filters, context) {
  const vehicleId = String(row?.entity_id || "");
  const category = String(context.vehicleCategoryById?.[vehicleId] || "Sin categoría");

  if (hasValues(filters.vehicleTypes) && !filters.vehicleTypes.includes(category)) return false;
  return true;
}

function matchesMovementEntityFilters(row, filters, context) {
  const personScoped = hasValues(filters.personIds) || hasValues(filters.cargos);
  const vehicleScoped = hasValues(filters.vehicleTypes);
  const entityType = String(row?.entity_type || "");

  if (!personScoped && !vehicleScoped) return true;

  if (entityType === "person") {
    if (!personScoped) return false;
    return matchesPersonFilters(row, filters, context);
  }

  if (entityType === "vehicle") {
    if (!vehicleScoped) return false;
    return matchesVehicleFilters(row, filters, context);
  }

  return false;
}

export function filterStayRows(rows, filters, context) {
  return (rows || []).filter((row) => {
    if (hasValues(filters.levels) && !filters.levels.includes(String(row?.nivel || ""))) return false;
    if (hasValues(filters.stayPorticoIds) && !filters.stayPorticoIds.includes(String(row?.portico_id || ""))) {
      return false;
    }
    return matchesMovementEntityFilters(row, filters, context);
  });
}

export function filterTransferRows(rows, filters, context) {
  return (rows || []).filter((row) => {
    const fromPorticoId = String(row?.from_portico_id || "");
    const toPorticoId = String(row?.to_portico_id || "");
    const fromLevel = String(context.porticoLevelById?.[fromPorticoId] || "");
    const toLevel = String(context.porticoLevelById?.[toPorticoId] || "");

    if (hasValues(filters.levels) && !filters.levels.includes(fromLevel) && !filters.levels.includes(toLevel)) {
      return false;
    }
    if (hasValues(filters.fromPorticoIds) && !filters.fromPorticoIds.includes(fromPorticoId)) return false;
    if (hasValues(filters.toPorticoIds) && !filters.toPorticoIds.includes(toPorticoId)) return false;
    return matchesMovementEntityFilters(row, filters, context);
  });
}

export function buildPeoplePerLevelFromStayRows(rows) {
  const byLevel = {};
  const uniqueKeys = new Set();

  (rows || []).forEach((row) => {
    if (String(row?.entity_type || "") !== "person") return;
    const level = String(row?.nivel || "SIN NIVEL");
    const personId = String(row?.entity_id || "");
    const key = `${level}:${personId}`;
    if (!personId || uniqueKeys.has(key)) return;
    uniqueKeys.add(key);
    byLevel[level] = Number(byLevel[level] || 0) + 1;
  });

  return byLevel;
}

export function buildVehiclesPerLevelFromStayRows(rows, vehicleCategoryById) {
  const result = {};
  const uniqueKeys = new Set();

  (rows || []).forEach((row) => {
    if (String(row?.entity_type || "") !== "vehicle") return;

    const level = String(row?.nivel || "SIN NIVEL");
    const vehicleId = String(row?.entity_id || "");
    const category = String(vehicleCategoryById?.[vehicleId] || "Sin categoría");
    const key = `${level}:${vehicleId}`;

    if (!vehicleId || uniqueKeys.has(key)) return;
    uniqueKeys.add(key);

    if (!result[level]) result[level] = {};
    result[level][category] = Number(result[level][category] || 0) + 1;
  });

  return result;
}

export function buildVehicleCategoryCounts(rows, vehicleCategoryById) {
  const uniqueVehicles = new Map();

  (rows || []).forEach((row) => {
    if (String(row?.entity_type || "") !== "vehicle") return;
    const vehicleId = String(row?.entity_id || "");
    if (!vehicleId) return;
    if (!uniqueVehicles.has(vehicleId)) {
      uniqueVehicles.set(vehicleId, String(vehicleCategoryById?.[vehicleId] || "Sin categoría"));
    }
  });

  const counts = {};
  Array.from(uniqueVehicles.values()).forEach((category) => {
    counts[category] = Number(counts[category] || 0) + 1;
  });
  return counts;
}

export function buildVehicleLapsFilters(filters) {
  return {
    levels: filters.levels || [],
    porticoIds: Array.from(
      new Set([...(filters.fromPorticoIds || []), ...(filters.toPorticoIds || [])])
    ),
    vehicleTypes: filters.vehicleTypes || []
  };
}

function matchesTaskRange(task, filters) {
  const taskDate = String(task?.date || task?.operationDate || "").slice(0, 10);
  if (filters.startDate && taskDate < filters.startDate) return false;
  if (filters.endDate && taskDate > filters.endDate) return false;
  return true;
}

function matchesTaskPersonFilters(task, filters, context) {
  const linkedPeopleIds = (task?.linkedPeople || []).map((item) => String(item.id));
  const taskRoles = new Set(
    [
    ...(task?.roles || []),
    ...(task?.linkedPeople || []).map((person) => context.personRoleById?.[String(person.id)] || "")].

    map((item) => String(item || "").trim()).
    filter(Boolean)
  );

  if (hasValues(filters.personIds) && !linkedPeopleIds.some((id) => filters.personIds.includes(id))) {
    return false;
  }
  if (hasValues(filters.cargos) && !Array.from(taskRoles).some((role) => filters.cargos.includes(role))) {
    return false;
  }
  return true;
}

function matchesTaskVehicleFilters(task, filters, context) {
  const linkedVehicles = task?.linkedVehicles || [];
  if (!hasValues(filters.vehicleTypes)) return true;

  return linkedVehicles.some((vehicle) => {
    const category = String(context.vehicleCategoryById?.[String(vehicle.id)] || "Sin categoría");
    return filters.vehicleTypes.includes(category);
  });
}

export function filterProductionTasks(tasks, filters, context) {
  return (tasks || []).filter((task) => {
    if (!matchesTaskRange(task, filters)) return false;
    if (hasValues(filters.levels) && !filters.levels.includes(String(task?.nivel || ""))) return false;
    if (hasValues(filters.porticoIds) && !filters.porticoIds.includes(String(task?.trackingPorticoId || ""))) {
      return false;
    }
    if (hasValues(filters.crews)) {
      const crewCandidates = [task?.crewPlanned, task?.crewReal].map((item) => String(item || "").trim());
      if (!crewCandidates.some((crew) => filters.crews.includes(crew))) return false;
    }
    if (hasValues(filters.equipments)) {
      const equipmentCandidates = [task?.equipmentPlanned, task?.equipmentReal].map((item) =>
      String(item || "").trim()
      );
      if (!equipmentCandidates.some((equipment) => filters.equipments.includes(equipment))) return false;
    }
    if (!matchesTaskPersonFilters(task, filters, context)) return false;
    if (!matchesTaskVehicleFilters(task, filters, context)) return false;
    return true;
  });
}

export function buildHoursRowsFromTasks(tasks) {
  const crewRows = {};
  const equipmentRows = {};

  (tasks || []).forEach((task) => {
    const plannedHours = Number(((Number(task?.plannedMinutes || 0) || 0) / 60).toFixed(2));
    const realHours = Number(((Number(task?.realMinutes || 0) || 0) / 60).toFixed(2));

    const crewPlanned = String(task?.crewPlanned || "").trim();
    const crewReal = String(task?.crewReal || "").trim();
    const equipmentPlanned = String(task?.equipmentPlanned || "").trim();
    const equipmentReal = String(task?.equipmentReal || "").trim();

    if (crewPlanned) {
      crewRows[crewPlanned] = crewRows[crewPlanned] || {
        label: crewPlanned,
        plannedHours: 0,
        realHours: 0,
        targetHours: 0,
        plannedTasks: 0,
        realTasks: 0
      };
      crewRows[crewPlanned].plannedHours += plannedHours;
      crewRows[crewPlanned].targetHours += plannedHours;
      crewRows[crewPlanned].plannedTasks += 1;
    }

    if (crewReal) {
      crewRows[crewReal] = crewRows[crewReal] || {
        label: crewReal,
        plannedHours: 0,
        realHours: 0,
        targetHours: 0,
        plannedTasks: 0,
        realTasks: 0
      };
      crewRows[crewReal].realHours += realHours;
      crewRows[crewReal].realTasks += 1;
    }

    if (equipmentPlanned) {
      equipmentRows[equipmentPlanned] = equipmentRows[equipmentPlanned] || {
        label: equipmentPlanned,
        plannedHours: 0,
        realHours: 0,
        targetHours: 0,
        plannedTasks: 0,
        realTasks: 0
      };
      equipmentRows[equipmentPlanned].plannedHours += plannedHours;
      equipmentRows[equipmentPlanned].targetHours += plannedHours;
      equipmentRows[equipmentPlanned].plannedTasks += 1;
    }

    if (equipmentReal) {
      equipmentRows[equipmentReal] = equipmentRows[equipmentReal] || {
        label: equipmentReal,
        plannedHours: 0,
        realHours: 0,
        targetHours: 0,
        plannedTasks: 0,
        realTasks: 0
      };
      equipmentRows[equipmentReal].realHours += realHours;
      equipmentRows[equipmentReal].realTasks += 1;
    }
  });

  const finalizeRows = (rows) =>
  Object.values(rows).
  map((row) => ({
    ...row,
    plannedHours: Number(row.plannedHours.toFixed(2)),
    realHours: Number(row.realHours.toFixed(2)),
    targetHours: Number(row.targetHours.toFixed(2))
  })).
  sort(
    (left, right) =>
    right.plannedHours - left.plannedHours ||
    right.realHours - left.realHours ||
    left.label.localeCompare(right.label, "es", { sensitivity: "base" })
  );

  return {
    crew: finalizeRows(crewRows),
    equipment: finalizeRows(equipmentRows)
  };
}

export function buildHoursVarianceRows(rows) {
  return (rows || []).map((row) => ({
    ...row,
    varianceHours: Number((Number(row.realHours || 0) - Number(row.plannedHours || 0)).toFixed(2))
  }));
}

export function matchesSelection(value, selectedValues) {
  return includesValue(selectedValues, value);
}