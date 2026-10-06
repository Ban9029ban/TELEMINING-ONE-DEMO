export const OPERATIONAL_MODEL_CODE = "operational_safety_monitor";

export const FINDING_CATALOG = [
{ code: "1", group: "EPP", mode: "ppe_live", severity: "high", label: "Personal sin casco de seguridad" },
{ code: "2", group: "EPP", mode: "pending", severity: "high", label: "Personal con casco mal puesto o sin barbiquejo cuando corresponde" },
{ code: "3", group: "EPP", mode: "ppe_live", severity: "medium", label: "Personal sin lentes de seguridad" },
{ code: "4", group: "EPP", mode: "pending", severity: "medium", label: "Personal con lentes levantados o no utilizados correctamente" },
{ code: "5", group: "EPP", mode: "ppe_live", severity: "high", label: "Personal sin guantes antigolpe" },
{ code: "6", group: "EPP", mode: "pending", severity: "high", label: "Personal usando guantes no adecuados para la tarea" },
{ code: "7", group: "EPP", mode: "pending", severity: "high", label: "Personal sin respirador" },
{ code: "8", group: "EPP", mode: "pending", severity: "high", label: "Personal con respirador mal ajustado o mal puesto" },
{ code: "9", group: "EPP", mode: "pending", severity: "high", label: "Personal sin autorrescatador" },
{ code: "10", group: "EPP", mode: "pending", severity: "high", label: "Personal con autorrescatador mal portado o no visible" },
{ code: "11", group: "EPP", mode: "pending", severity: "medium", label: "Personal sin linterna minera" },
{ code: "12", group: "EPP", mode: "pending", severity: "medium", label: "Personal con linterna apagada en zona donde debe estar encendida" },
{ code: "13", group: "EPP", mode: "pending", severity: "medium", label: "Personal con prenda que obstaculiza la visual de reflectante de personal" },
{ code: "14", group: "EPP", mode: "pending", severity: "medium", label: "Personal con EPP visiblemente deteriorado o mal puesto" },
{ code: "15", group: "EPP", mode: "ppe_live", severity: "high", label: "Personal ejecutando labores con EPP incompleto" },
{ code: "16", group: "Peatonal", mode: "pending", severity: "high", label: "Personal caminando por zona no habilitada para peatones" },
{ code: "17", group: "Peatonal", mode: "heuristic", severity: "high", label: "Personal transitando demasiado cerca de equipos o vehículos en movimiento" },
{ code: "18", group: "Peatonal", mode: "pending", severity: "high", label: "Personal cruzando frente a vehículos sin asegurar contacto visual con el operador" },
{ code: "19", group: "Peatonal", mode: "heuristic", severity: "high", label: "Personal caminando detrás de vehículos o equipos móviles" },
{ code: "20", group: "Peatonal", mode: "heuristic", severity: "high", label: "Personal permaneciendo en puntos ciegos de camiones, camionetas o maquinaria" },
{ code: "21", group: "Peatonal", mode: "heuristic", severity: "high", label: "Personal transitando por áreas de maniobra de equipos pesados" },
{ code: "22", group: "Peatonal", mode: "heuristic", severity: "medium", label: "Personal corriendo dentro de áreas operacionales" },
{ code: "23", group: "Peatonal", mode: "heuristic", severity: "medium", label: "Personal distraído durante el tránsito peatonal" },
{ code: "24", group: "Peatonal", mode: "heuristic", severity: "medium", label: "Personal usando celular mientras camina en zona operacional" },
{ code: "25", group: "Peatonal", mode: "heuristic", severity: "high", label: "Personal ingresando a rutas vehiculares sin precaución" },
{ code: "26", group: "Interacción", mode: "heuristic", severity: "high", label: "Vehículo que no detiene su marcha ante presencia de peatón por delante" },
{ code: "27", group: "Interacción", mode: "heuristic", severity: "high", label: "Personal que no se detiene cuando vehículo se aproxima por detrás" },
{ code: "28", group: "Interacción", mode: "heuristic", severity: "high", label: "Vehículo aproximándose a personal sin reducir velocidad" },
{ code: "29", group: "Interacción", mode: "heuristic", severity: "high", label: "Operación simultánea de vehículos y personas sin separación segura" },
{ code: "30", group: "Interacción", mode: "heuristic", severity: "high", label: "Vehículo transitando con peatones demasiado próximos" },
{ code: "31", group: "Interacción", mode: "pending", severity: "high", label: "Personal ubicándose entre vehículo y estructura fija" },
{ code: "32", group: "Interacción", mode: "heuristic", severity: "high", label: "Maniobras de retroceso con presencia de personal cercano" },
{ code: "33", group: "Interacción", mode: "heuristic", severity: "high", label: "Equipo móvil operando con personal dentro de su radio de acción invadiendo delimitación o segregación" }];


export function isLiveFindingMode(mode) {
  return mode === "heuristic" || mode === "ppe_live";
}

export function buildFindingCoverageByGroup() {
  const grouped = new Map();

  FINDING_CATALOG.forEach((item) => {
    const current = grouped.get(item.group) || {
      group: item.group,
      heuristic: 0,
      ppe_live: 0,
      pending: 0,
      total: 0,
      high: 0,
      medium: 0
    };

    current.total += 1;
    if (item.mode === "heuristic") current.heuristic += 1;
    if (item.mode === "ppe_live") current.ppe_live += 1;
    if (item.mode === "pending") current.pending += 1;
    if (item.severity === "high") current.high += 1;else
    current.medium += 1;

    grouped.set(item.group, current);
  });

  return Array.from(grouped.values()).sort(
    (left, right) => right.total - left.total || left.group.localeCompare(right.group)
  );
}

export function getModelCoveragePreset(modelCode) {
  if (modelCode === OPERATIONAL_MODEL_CODE) {
    const liveAnalyses = FINDING_CATALOG.filter((item) => isLiveFindingMode(item.mode)).length;
    return {
      focus: "Seguridad operacional",
      liveAnalyses,
      pendingAnalyses: FINDING_CATALOG.length - liveAnalyses
    };
  }

  if (modelCode === "person_detection") {
    return {
      focus: "Personas",
      liveAnalyses: 1,
      pendingAnalyses: 0
    };
  }

  if (modelCode === "person_count") {
    return {
      focus: "Conteo de personas",
      liveAnalyses: 1,
      pendingAnalyses: 0
    };
  }

  if (modelCode === "object_detection") {
    return {
      focus: "Objetos y vehículos",
      liveAnalyses: 3,
      pendingAnalyses: 0
    };
  }

  if (modelCode === "bolt_detection") {
    return {
      focus: "Especializado",
      liveAnalyses: 0,
      pendingAnalyses: 1
    };
  }

  return {
    focus: "Catálogo IA",
    liveAnalyses: 0,
    pendingAnalyses: 0
  };
}
