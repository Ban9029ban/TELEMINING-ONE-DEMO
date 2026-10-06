import { SIGNAL_MATRIX, SITE_LAYOUTS } from "../operationalConfig";

export function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}

export function inferControlState(entry) {
  if (!entry) return "sin-datos";
  if (entry.state_code) return String(entry.state_code).toLowerCase();
  if (entry.control_state_code) return String(entry.control_state_code).toLowerCase();
  const raw = String(entry.state || "").toLowerCase();
  return raw || "sin-datos";
}

export function inferVisualState(entry) {
  const state = inferControlState(entry);
  if (["alerta", "red", "inferior", "superior"].includes(state)) return "red";
  if (["normal", "green", "centro"].includes(state)) return "green";
  return "off";
}

export function stateBadgeLabel(entry) {
  const state = inferControlState(entry);
  if (!state || state === "sin-datos") return "Sin datos";
  return state.toUpperCase();
}

export function buildLatestByDevice(history = [], current = null) {
  const ordered = [...history].sort((a, b) => {
    const ta = new Date(a.updated_at || 0).getTime();
    const tb = new Date(b.updated_at || 0).getTime();
    return tb - ta;
  });

  const map = new Map();
  for (const entry of ordered) {
    if (!entry?.device_code) continue;
    if (!map.has(entry.device_code)) {
      map.set(entry.device_code, entry);
    }
  }
  if (current?.device_code && !map.has(current.device_code)) {
    map.set(current.device_code, current);
  }
  return map;
}

export function buildPlcMirrorView(latestByDevice) {
  const site = SITE_LAYOUTS[0];
  const devices = site.polygons.map((polygon) => {
    const latest = latestByDevice.get(polygon.deviceCode) || null;
    const controlState = inferControlState(latest);
    const commands =
      SIGNAL_MATRIX[polygon.deviceCode]?.[controlState] ||
      SIGNAL_MATRIX[polygon.deviceCode]?.[latest?.state] ||
      [];
    return {
      ...polygon,
      latest,
      controlState,
      commands,
      visualState: inferVisualState(latest),
      timestamp: latest?.updated_at || null,
    };
  });

  return site.plcMirrors.map((plc) => ({
    ...plc,
    status: devices.some((d) => d.latest) ? "commanded" : "idle",
    devices,
  }));
}
