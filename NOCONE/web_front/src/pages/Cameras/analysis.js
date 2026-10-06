import * as ort from "onnxruntime-web";
import { FINDING_CATALOG, OPERATIONAL_MODEL_CODE } from "./analyticsCatalog";
import { getModelSession } from "./models";

const INPUT = 640;
const PROCESS_EVERY = 3;
const EVENT_TTL_MS = 14000;
const FINDING_TTL_MS = 30000;
const FINDING_DEBOUNCE_MS = 5000;
const EXTERNAL_FINDING_TTL_MS = 6500;
const EXTERNAL_DETECTION_TTL_MS = 3500;
const INFERENCE_TIMEOUT_MS = 7000;
const MAX_RECENT_EVENTS = 25;
const MAX_RECENT_FINDINGS = 40;
const ACTIVE_TRACK_TTL_MS = 1500;
const PERSON_IDS = new Set([0]);
const VEHICLE_IDS = new Set([1, 2, 3, 5, 7]);
const CELL_PHONE_IDS = new Set([67]);
const COCO_LABELS = {
  0: "Persona",
  1: "Bicicleta",
  2: "Auto",
  3: "Moto",
  5: "Bus",
  7: "Camion",
  9: "Semaforo",
  11: "Senal",
  13: "Banco",
  15: "Gato",
  16: "Perro",
  24: "Mochila",
  25: "Paraguas",
  26: "Bolso",
  27: "Corbata",
  28: "Maleta",
  32: "Pelota",
  39: "Botella",
  41: "Vaso",
  56: "Silla",
  57: "Sofa",
  58: "Maceta",
  60: "Mesa",
  62: "TV",
  63: "Laptop",
  67: "Celular",
  73: "Libro",
};

const COLORS = {
  person: "#22c55e",
  vehicle: "#f59e0b",
  other: "#38bdf8",
  finding: "#ef4444",
  ppe: "#a855f7",
};

let tmpCanvas = null;
let tmpCtx = null;
const panels = new Map();

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => {
        reject(new Error(`Tiempo de espera agotado durante ${label}.`));
      }, timeoutMs);
    }),
  ]);
}

function createFindingStats() {
  const stats = {};
  FINDING_CATALOG.forEach((item) => {
    stats[item.code] = {
      ...item,
      activeCount: 0,
      totalCount: 0,
      lastSeenAt: null,
      lastSeenLabel: "-",
      lastEvidence: "-",
    };
  });
  return stats;
}

function ensurePanel(panelKey = "default") {
  if (!panels.has(panelKey)) {
    panels.set(panelKey, {
      frameCounter: 0,
      inferencePending: false,
      lastDetections: [],
      recentEvents: [],
      recentFindings: [],
      externalDetections: [],
      externalFindingInstances: [],
      findingStats: createFindingStats(),
      findingCooldowns: new Map(),
      tracks: new Map(),
      counts: {
        activePersons: 0,
        activeVehicles: 0,
        activeOthers: 0,
        activeTotal: 0,
        cumulativePersons: 0,
        cumulativeVehicles: 0,
        cumulativeOthers: 0,
        cumulativeTotal: 0,
        activeFindings: 0,
        cumulativeFindings: 0,
      },
      perf: {
        fps: 0,
        lastDrawAt: 0,
        lastInferenceMs: 0,
        lastInferenceAt: 0,
      },
      localInferenceEnabled: true,
      modelCode: null,
      status: "idle",
      lastError: null,
    });
  }
  return panels.get(panelKey);
}

export function resetPanelAnalytics(panelKey = "default") {
  panels.delete(panelKey);
}

export function setPanelLocalInferenceEnabled(panelKey = "default", enabled = true) {
  const state = ensurePanel(panelKey);
  state.localInferenceEnabled = enabled;
  if (!enabled) {
    state.inferencePending = false;
  }
}

export function getPanelAnalytics(panelKey = "default") {
  const state = ensurePanel(panelKey);
  return {
    counts: { ...state.counts },
    perf: { ...state.perf },
    modelCode: state.modelCode,
    status: state.status,
    lastError: state.lastError,
    detections: state.lastDetections.map((d) => ({ ...d })),
    recentEvents: state.recentEvents.map((e) => ({ ...e })),
    findings: {
      summary: buildFindingSummary(state),
      rows: Object.values(state.findingStats).map((row) => ({ ...row })),
      recent: state.recentFindings.map((item) => ({ ...item })),
    },
  };
}

export function mergeExternalPpeAnalytics(
  panelKey = "default",
  payload = {},
  sourceWidth = INPUT,
  sourceHeight = INPUT,
) {
  const state = ensurePanel(panelKey);
  const now = Date.now();
  const scaleX = sourceWidth > 0 ? INPUT / sourceWidth : 1;
  const scaleY = sourceHeight > 0 ? INPUT / sourceHeight : 1;

  state.externalDetections = (payload?.detections || []).map((item, index) => ({
    x1: Number((item.x1 * scaleX).toFixed(2)),
    y1: Number((item.y1 * scaleY).toFixed(2)),
    x2: Number((item.x2 * scaleX).toFixed(2)),
    y2: Number((item.y2 * scaleY).toFixed(2)),
    score: Number(item.score || 0),
    label: item.class_name || `PPE ${index + 1}`,
    category: "ppe",
    classId: `ppe_${item.class_name || index}`,
    timestamp: now,
  }));

  state.externalFindingInstances = (payload?.findings || []).map((item, index) => ({
    code: String(item.code),
    uid: item.uid || `ppe_${item.code}_${index}`,
    zone: item.zone || "-",
    confidence: Number(item.confidence || 0),
    evidence: item.evidence || "Hallazgo PPE detectado por backend",
    coverage: item.coverage || "ppe_live",
    timestamp: now,
  }));

  updateFindingAnalytics(state, now);
}

export function mergeExternalOperationalAnalytics(
  panelKey = "default",
  payload = {},
  sourceWidth = INPUT,
  sourceHeight = INPUT,
) {
  const state = ensurePanel(panelKey);
  const now = Date.now();
  const scaleX = sourceWidth > 0 ? INPUT / sourceWidth : 1;
  const scaleY = sourceHeight > 0 ? INPUT / sourceHeight : 1;

  const detections = (payload?.operational_detections || []).map((item) => {
    const classId = Number(item.class_id);
    const category = getCategory(classId);
    return {
      x1: Number((item.x1 * scaleX).toFixed(2)),
      y1: Number((item.y1 * scaleY).toFixed(2)),
      x2: Number((item.x2 * scaleX).toFixed(2)),
      y2: Number((item.y2 * scaleY).toFixed(2)),
      score: Number(item.score || 0),
      label: item.class_name || COCO_LABELS[classId] || `Clase ${classId}`,
      category,
      classId,
      timestamp: now,
    };
  });

  state.lastDetections = enrichDetections(detections, now);
  updateTrackingAndCounters(state, state.lastDetections, now);
  updateFindingAnalytics(state, now);
  state.perf.lastInferenceAt = now;
  state.perf.lastInferenceMs = 0;
  state.status = "running_backend";
  state.lastError = null;
}

export function applyModelOverlay(ctx, modelCode, w, h, panelKey = "default") {
  if (!ctx) return;

  const state = ensurePanel(panelKey);
  state.modelCode = modelCode;
  state.frameCounter += 1;
  updateFps(state);
  drawOverlay(ctx, state, w, h);
  if (!state.localInferenceEnabled) return;

  if (state.frameCounter % PROCESS_EVERY !== 0) return;
  if (state.inferencePending) return;

  const imageData = getResizedFrame(ctx, w, h);
  if (!imageData) return;

  state.inferencePending = true;
  state.status = "running";
  const startedAt = performance.now();

  runInference(modelCode, imageData)
    .then((detections) => {
      const now = Date.now();
      state.lastDetections = enrichDetections(detections, now);
      updateTrackingAndCounters(state, state.lastDetections, now);
      updateFindingAnalytics(state, now);
      state.perf.lastInferenceMs = Math.round(performance.now() - startedAt);
      state.perf.lastInferenceAt = now;
      state.status = "running";
      state.lastError = null;
    })
    .catch((error) => {
      state.status = "error";
      state.lastError = error?.message || String(error);
      console.warn("[IA] infer error", error);
    })
    .finally(() => {
      state.inferencePending = false;
    });
}

function buildFindingSummary(state) {
  const rows = Object.values(state.findingStats);
  const supportedRows = rows.filter((row) => row.mode !== "pending");
  return {
    supported: supportedRows.length,
    pendingModels: rows.length - supportedRows.length,
    active: rows.reduce((sum, row) => sum + row.activeCount, 0),
    cumulative: rows.reduce((sum, row) => sum + row.totalCount, 0),
    activeSupported: supportedRows.reduce((sum, row) => sum + row.activeCount, 0),
    cumulativeSupported: supportedRows.reduce((sum, row) => sum + row.totalCount, 0),
    isOperationalMode: state.modelCode === OPERATIONAL_MODEL_CODE,
  };
}

function updateFps(state) {
  const now = performance.now();
  if (!state.perf.lastDrawAt) {
    state.perf.lastDrawAt = now;
    return;
  }
  const dt = now - state.perf.lastDrawAt;
  state.perf.lastDrawAt = now;
  if (dt > 0) {
    const instantFps = 1000 / dt;
    state.perf.fps = state.perf.fps
      ? Number((state.perf.fps * 0.8 + instantFps * 0.2).toFixed(1))
      : Number(instantFps.toFixed(1));
  }
}

function getResizedFrame(ctx, w, h) {
  if (!tmpCanvas) {
    tmpCanvas = document.createElement("canvas");
    tmpCanvas.width = INPUT;
    tmpCanvas.height = INPUT;
    tmpCtx = tmpCanvas.getContext("2d", { willReadFrequently: true });
  }
  tmpCtx.drawImage(ctx.canvas, 0, 0, w, h, 0, 0, INPUT, INPUT);
  try {
    return tmpCtx.getImageData(0, 0, INPUT, INPUT);
  } catch (error) {
    console.warn("[IA] error imagen", error);
    return null;
  }
}

async function runInference(modelCode, imageData) {
  const session = await getModelSession(modelCode);
  const tensor = imageToTensor(imageData);
  const feeds = { [session.inputNames[0]]: tensor };
  const out = await withTimeout(
    session.run(feeds),
    INFERENCE_TIMEOUT_MS,
    `la inferencia ONNX de ${modelCode}`
  );
  const raw = out[session.outputNames[0]].data;
  return parseDetections(raw);
}

function parseDetections(data) {
  const detections = [];
  for (let i = 0; i < data.length; i += 6) {
    const x1 = data[i];
    const y1 = data[i + 1];
    const x2 = data[i + 2];
    const y2 = data[i + 3];
    const score = data[i + 4];
    const classId = Math.round(data[i + 5]);

    if (!Number.isFinite(score) || score < getThresholdByClass(classId)) continue;
    if (x2 <= x1 || y2 <= y1) continue;

    detections.push({ x1, y1, x2, y2, score, classId });
  }
  return detections;
}

function getThresholdByClass(classId) {
  if (PERSON_IDS.has(classId)) return 0.38;
  if (VEHICLE_IDS.has(classId)) return 0.33;
  if (CELL_PHONE_IDS.has(classId)) return 0.28;
  return 0.45;
}

function imageToTensor(imageData) {
  const { data, width, height } = imageData;
  const size = width * height;
  const out = new Float32Array(size * 3);

  for (let index = 0; index < size; index += 1) {
    out[index] = data[index * 4] / 255;
    out[index + size] = data[index * 4 + 1] / 255;
    out[index + size * 2] = data[index * 4 + 2] / 255;
  }

  return new ort.Tensor("float32", out, [1, 3, height, width]);
}

function enrichDetections(detections, now) {
  return detections.map((item) => {
    const category = getCategory(item.classId);
    const label = COCO_LABELS[item.classId] || `Clase ${item.classId}`;
    const centerX = (item.x1 + item.x2) / 2;
    const centerY = (item.y1 + item.y2) / 2;
    const width = Math.max(item.x2 - item.x1, 1);
    const height = Math.max(item.y2 - item.y1, 1);

    return {
      ...item,
      category,
      label,
      centerX,
      centerY,
      width,
      height,
      key: buildTrackKey(item.classId, centerX, centerY, width, height),
      timestamp: now,
    };
  });
}

function getCategory(classId) {
  if (PERSON_IDS.has(classId)) return "person";
  if (VEHICLE_IDS.has(classId)) return "vehicle";
  return "other";
}

function buildTrackKey(classId, cx, cy, w, h) {
  return [
    classId,
    Math.round(cx / 24),
    Math.round(cy / 24),
    Math.round(w / 28),
    Math.round(h / 28),
  ].join("_");
}

function updateTrackingAndCounters(state, detections, now) {
  for (const [key, track] of state.tracks.entries()) {
    if (now - track.lastSeenAt > ACTIVE_TRACK_TTL_MS) {
      state.tracks.delete(key);
    }
  }

  detections.forEach((detection) => {
    const existing = state.tracks.get(detection.key);
    if (existing) {
      const deltaMs = Math.max(now - existing.lastSeenAt, 1);
      const deltaX = detection.centerX - existing.centerX;
      const deltaY = detection.centerY - existing.centerY;

      existing.lastSeenAt = now;
      existing.score = detection.score;
      existing.label = detection.label;
      existing.category = detection.category;
      existing.classId = detection.classId;
      existing.centerX = detection.centerX;
      existing.centerY = detection.centerY;
      existing.width = detection.width;
      existing.height = detection.height;
      existing.x1 = detection.x1;
      existing.y1 = detection.y1;
      existing.x2 = detection.x2;
      existing.y2 = detection.y2;
      existing.deltaX = deltaX;
      existing.deltaY = deltaY;
      existing.speedPxPerSec = Number(((Math.hypot(deltaX, deltaY) / deltaMs) * 1000).toFixed(1));
    } else {
      state.tracks.set(detection.key, {
        ...detection,
        firstSeenAt: now,
        lastSeenAt: now,
        deltaX: 0,
        deltaY: 0,
        speedPxPerSec: 0,
      });
      incrementCumulative(state, detection.category);
      pushRecentEvent(state, detection, now);
    }
  });

  const activeTracks = Array.from(state.tracks.values());
  state.counts.activePersons = activeTracks.filter((track) => track.category === "person").length;
  state.counts.activeVehicles = activeTracks.filter((track) => track.category === "vehicle").length;
  state.counts.activeOthers = activeTracks.filter((track) => track.category === "other").length;
  state.counts.activeTotal = activeTracks.length;

  state.recentEvents = state.recentEvents
    .filter((item) => now - item.timestamp <= EVENT_TTL_MS)
    .slice(0, MAX_RECENT_EVENTS);
}

function incrementCumulative(state, category) {
  state.counts.cumulativeTotal += 1;
  if (category === "person") state.counts.cumulativePersons += 1;
  else if (category === "vehicle") state.counts.cumulativeVehicles += 1;
  else state.counts.cumulativeOthers += 1;
}

function pushRecentEvent(state, detection, now) {
  const zone = getZone(detection.centerX, detection.centerY);
  state.recentEvents = [
    {
      id: `${detection.key}_${now}`,
      timestamp: now,
      timeLabel: new Date(now).toLocaleTimeString("es-CL", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      label: detection.label,
      classId: detection.classId,
      category: detection.category,
      confidence: Number((detection.score * 100).toFixed(1)),
      zone,
    },
    ...state.recentEvents,
  ].slice(0, MAX_RECENT_EVENTS);
}

function updateFindingAnalytics(state, now) {
  Object.values(state.findingStats).forEach((row) => {
    row.activeCount = 0;
  });

  state.externalDetections = state.externalDetections.filter(
    (item) => now - item.timestamp <= EXTERNAL_DETECTION_TTL_MS,
  );
  state.externalFindingInstances = state.externalFindingInstances.filter(
    (item) => now - item.timestamp <= EXTERNAL_FINDING_TTL_MS,
  );

  state.recentFindings = state.recentFindings
    .filter((item) => now - item.timestamp <= FINDING_TTL_MS)
    .slice(0, MAX_RECENT_FINDINGS);

  for (const [key, timestamp] of state.findingCooldowns.entries()) {
    if (now - timestamp > FINDING_TTL_MS) {
      state.findingCooldowns.delete(key);
    }
  }

  if (state.modelCode !== OPERATIONAL_MODEL_CODE) {
    state.counts.activeFindings = 0;
    state.counts.cumulativeFindings = Object.values(state.findingStats).reduce(
      (sum, row) => sum + row.totalCount,
      0,
    );
    return;
  }

  const activeTracks = Array.from(state.tracks.values());
  const instances = [
    ...detectOperationalFindingInstances(activeTracks),
    ...state.externalFindingInstances,
  ];

  instances.forEach((instance) => {
    const row = state.findingStats[instance.code];
    if (!row) return;
    row.activeCount += 1;
    registerFindingOccurrence(state, row, instance, now);
  });

  state.counts.activeFindings = instances.length;
  state.counts.cumulativeFindings = Object.values(state.findingStats).reduce(
    (sum, row) => sum + row.totalCount,
    0,
  );
}

function registerFindingOccurrence(state, row, instance, now) {
  row.lastSeenAt = now;
  row.lastSeenLabel = formatFindingTime(now);
  row.lastEvidence = instance.evidence;

  const cooldownKey = `${instance.code}:${instance.uid}`;
  const lastSeen = state.findingCooldowns.get(cooldownKey);
  if (lastSeen && now - lastSeen < FINDING_DEBOUNCE_MS) {
    return;
  }

  row.totalCount += 1;
  state.findingCooldowns.set(cooldownKey, now);
  state.recentFindings = [
    {
      id: `${cooldownKey}:${now}`,
      code: instance.code,
      group: row.group,
      label: row.label,
      severity: row.severity,
      coverage: row.mode,
      timestamp: now,
      timeLabel: formatFindingTime(now),
      zone: instance.zone,
      confidence: instance.confidence,
      evidence: instance.evidence,
    },
    ...state.recentFindings,
  ].slice(0, MAX_RECENT_FINDINGS);
}

function detectOperationalFindingInstances(activeTracks) {
  const findings = [];
  const persons = activeTracks.filter((track) => track.category === "person");
  const vehicles = activeTracks.filter((track) => track.category === "vehicle");
  const phones = activeTracks.filter((track) => CELL_PHONE_IDS.has(track.classId));

  persons.forEach((person) => {
    const ageMs = person.lastSeenAt - person.firstSeenAt;
    if (ageMs > 450 && person.speedPxPerSec >= 95) {
      findings.push(
        createFindingInstance("22", [person.key], person.centerX, person.centerY, person.score, "Desplazamiento peatonal alto"),
      );
    }
  });

  phones.forEach((phone) => {
    const person = findNearestTrack(phone, persons, 82);
    if (!person) return;
    if (!isInsideExpandedBox(phone, person, 0.22)) return;
    if (person.speedPxPerSec >= 12) {
      findings.push(
        createFindingInstance(
          "23",
          [person.key, phone.key],
          person.centerX,
          person.centerY,
          averageConfidence(person, phone),
          "Distraido durante transito peatonal por uso de celular",
        ),
      );
    }
    findings.push(
      createFindingInstance(
        "24",
        [person.key, phone.key],
        person.centerX,
        person.centerY,
        averageConfidence(person, phone),
        "Celular detectado junto a persona",
      ),
    );
  });

  vehicles.forEach((vehicle) => {
    persons.forEach((person) => {
      const dx = person.centerX - vehicle.centerX;
      const dy = person.centerY - vehicle.centerY;
      const distancePx = Math.hypot(dx, dy);
      const nearPx = Math.max(68, Math.min(150, vehicle.width * 0.55 + person.width * 0.35));
      const dangerPx = Math.max(48, Math.min(96, vehicle.width * 0.4));
      const sameLane = Math.abs(dx) <= vehicle.width * 0.85;
      const behindVehicle = sameLane && dy > vehicle.height * 0.08 && dy < vehicle.height * 1.2;
      const lateralBlind =
        Math.abs(dx) > vehicle.width * 0.35 &&
        Math.abs(dx) < vehicle.width * 0.95 &&
        Math.abs(dy) < vehicle.height * 0.5;
      const overlap = expandedBoxOverlap(person, vehicle, 0.18);
      const vehicleMoving = vehicle.speedPxPerSec > 28;
      const personMoving = person.speedPxPerSec > 18;
      const motionDx = vehicle.deltaX || 0;
      const motionDy = vehicle.deltaY || 0;
      const dotAlongMotion = dx * motionDx + dy * motionDy;
      const aheadOfVehicle = vehicleMoving && dotAlongMotion > Math.max(36, vehicle.width * 0.35);
      const behindRelativeMotion = vehicleMoving && dotAlongMotion < -Math.max(24, vehicle.width * 0.22);
      const confidence = averageConfidence(person, vehicle);
      const centerX = (person.centerX + vehicle.centerX) / 2;
      const centerY = (person.centerY + vehicle.centerY) / 2;
      const evidence = `${person.label} cerca de ${vehicle.label}`;

      if (distancePx <= nearPx || overlap) {
        findings.push(createFindingInstance("17", [person.key, vehicle.key], centerX, centerY, confidence, evidence));
        findings.push(createFindingInstance("29", [person.key, vehicle.key], centerX, centerY, confidence, evidence));
      }

      if (vehicleMoving && (distancePx <= nearPx * 0.9 || overlap)) {
        findings.push(
          createFindingInstance("30", [person.key, vehicle.key], centerX, centerY, confidence, "Vehiculo en movimiento con peaton proximo"),
        );
      }

      if (distancePx <= dangerPx || (overlap && distancePx <= nearPx * 0.75)) {
        findings.push(
          createFindingInstance("33", [person.key, vehicle.key], centerX, centerY, confidence, "Peaton dentro del radio de accion del equipo movil"),
        );
      }

      if (behindVehicle) {
        findings.push(
          createFindingInstance("19", [person.key, vehicle.key], centerX, centerY, confidence, "Persona detectada detras del equipo movil"),
        );
      }

      if (behindVehicle || lateralBlind) {
        findings.push(
          createFindingInstance("20", [person.key, vehicle.key], centerX, centerY, confidence, "Persona ubicada en zona de punto ciego"),
        );
      }

      if (Math.abs(dx) <= vehicle.width && Math.abs(dy) <= vehicle.height * 0.95) {
        findings.push(
          createFindingInstance("21", [person.key, vehicle.key], centerX, centerY, confidence, "Peaton dentro del area de maniobra del equipo"),
        );
      }

      if (aheadOfVehicle && distancePx <= nearPx * 1.3) {
        findings.push(
          createFindingInstance(
            "28",
            [person.key, vehicle.key],
            centerX,
            centerY,
            confidence,
            "Vehiculo aproxima a peaton sin reduccion perceptible",
          ),
        );
      }

      if (aheadOfVehicle && distancePx <= nearPx * 0.95) {
        findings.push(
          createFindingInstance(
            "26",
            [person.key, vehicle.key],
            centerX,
            centerY,
            confidence,
            "Peaton por delante de vehiculo en movimiento",
          ),
        );
      }

      if (behindRelativeMotion && distancePx <= nearPx * 1.1 && personMoving) {
        findings.push(
          createFindingInstance(
            "27",
            [person.key, vehicle.key],
            centerX,
            centerY,
            confidence,
            "Peaton sigue desplazandose con vehiculo aproximando por detras",
          ),
        );
      }

      if (
        vehicleMoving &&
        personMoving &&
        Math.abs(dx) > vehicle.width * 0.35 &&
        Math.abs(dx) <= vehicle.width * 1.1 &&
        Math.abs(dy) <= vehicle.height * 0.85
      ) {
        findings.push(
          createFindingInstance(
            "25",
            [person.key, vehicle.key],
            centerX,
            centerY,
            confidence,
            "Ingreso lateral a ruta vehicular con vehiculo cercano",
          ),
        );
      }

      if (behindRelativeMotion && vehicleMoving && distancePx <= nearPx * 0.9) {
        findings.push(
          createFindingInstance(
            "32",
            [person.key, vehicle.key],
            centerX,
            centerY,
            confidence,
            "Maniobra con peaton muy proximo en zona trasera de movimiento",
          ),
        );
      }
    });
  });

  return dedupeFindingInstances(findings);
}

function createFindingInstance(code, parts, centerX, centerY, confidence, evidence) {
  return {
    code,
    uid: parts.join(":"),
    confidence: Number((confidence * 100).toFixed(1)),
    evidence,
    zone: getZone(centerX, centerY),
  };
}

function dedupeFindingInstances(instances) {
  const seen = new Map();
  instances.forEach((instance) => {
    const key = `${instance.code}:${instance.uid}`;
    if (!seen.has(key)) {
      seen.set(key, instance);
    }
  });
  return Array.from(seen.values());
}

function averageConfidence(left, right) {
  return ((left?.score || 0) + (right?.score || 0)) / 2;
}

function findNearestTrack(origin, candidates, maxDistancePx) {
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  candidates.forEach((candidate) => {
    const distancePx = Math.hypot(origin.centerX - candidate.centerX, origin.centerY - candidate.centerY);
    if (distancePx > maxDistancePx || distancePx >= bestDistance) return;
    best = candidate;
    bestDistance = distancePx;
  });

  return best;
}

function isInsideExpandedBox(inner, outer, paddingFactor = 0.2) {
  const padX = outer.width * paddingFactor;
  const padY = outer.height * paddingFactor;
  return (
    inner.centerX >= outer.x1 - padX &&
    inner.centerX <= outer.x2 + padX &&
    inner.centerY >= outer.y1 - padY &&
    inner.centerY <= outer.y2 + padY
  );
}

function expandedBoxOverlap(left, right, paddingFactor = 0.15) {
  const leftPadX = left.width * paddingFactor;
  const leftPadY = left.height * paddingFactor;
  const rightPadX = right.width * paddingFactor;
  const rightPadY = right.height * paddingFactor;

  return !(
    left.x2 + leftPadX < right.x1 - rightPadX ||
    left.x1 - leftPadX > right.x2 + rightPadX ||
    left.y2 + leftPadY < right.y1 - rightPadY ||
    left.y1 - leftPadY > right.y2 + rightPadY
  );
}

function getZone(cx, cy) {
  const horizontal = cx < INPUT / 3 ? "Izquierda" : cx > (INPUT * 2) / 3 ? "Derecha" : "Centro";
  const vertical = cy < INPUT / 3 ? "Superior" : cy > (INPUT * 2) / 3 ? "Inferior" : "Media";
  return `${horizontal} / ${vertical}`;
}

function formatFindingTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString("es-CL", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function drawOverlay(ctx, state, width, height) {
  ctx.save();

  const sx = width / INPUT;
  const sy = height / INPUT;
  const detections = [...state.lastDetections, ...state.externalDetections];

  drawHud(ctx, state, width);

  ctx.lineWidth = 2;
  ctx.font = "12px Inter, Arial, sans-serif";
  ctx.textBaseline = "top";

  detections.forEach((detection) => {
    const x = detection.x1 * sx;
    const y = detection.y1 * sy;
    const boxWidth = (detection.x2 - detection.x1) * sx;
    const boxHeight = (detection.y2 - detection.y1) * sy;
    const color = COLORS[detection.category] || COLORS.other;
    const label = `${detection.label} ${Math.round(detection.score * 100)}%`;

    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.strokeRect(x, y, boxWidth, boxHeight);
    ctx.shadowBlur = 0;

    const textWidth = Math.ceil(ctx.measureText(label).width) + 16;
    const textY = Math.max(6, y - 24);
    roundRect(ctx, x, textY, textWidth, 20, 6, "rgba(15,23,42,0.88)");
    ctx.fillStyle = color;
    ctx.fillRect(x, textY, 4, 20);
    ctx.fillStyle = "#e5e7eb";
    ctx.fillText(label, x + 8, textY + 4);
  });

  ctx.restore();
}

function drawHud(ctx, state, width) {
  const hudWidth = Math.min(470, width - 16);
  roundRect(ctx, 8, 8, hudWidth, 82, 12, "rgba(2,6,23,0.72)");

  ctx.fillStyle = "#f8fafc";
  ctx.font = "600 13px Inter, Arial, sans-serif";
  ctx.fillText(`Modelo: ${state.modelCode || "-"}`, 18, 18);

  ctx.font = "12px Inter, Arial, sans-serif";
  ctx.fillStyle = "#cbd5e1";
  ctx.fillText(`Estado: ${translateStatus(state.status)}`, 18, 40);
  ctx.fillText(`FPS: ${state.perf.fps || 0}`, 18, 58);
  ctx.fillText(`Inferencia: ${state.perf.lastInferenceMs || 0} ms`, 18, 74);

  const chips = [
    { label: `Personas ${state.counts.activePersons}`, color: COLORS.person },
    { label: `Vehiculos ${state.counts.activeVehicles}`, color: COLORS.vehicle },
    { label: `Otros ${state.counts.activeOthers}`, color: COLORS.other },
    { label: `Hallazgos ${state.counts.activeFindings}`, color: COLORS.finding },
  ];

  let x = 155;
  chips.forEach((chip) => {
    const chipWidth = Math.ceil(ctx.measureText(chip.label).width) + 24;
    roundRect(ctx, x, 22, chipWidth, 24, 999, "rgba(255,255,255,0.08)");
    ctx.fillStyle = chip.color;
    ctx.fillRect(x + 8, 31, 8, 8);
    ctx.fillStyle = "#f8fafc";
    ctx.fillText(chip.label, x + 22, 28);
    x += chipWidth + 8;
  });
}

function translateStatus(status) {
  if (status === "running") return "Analizando";
  if (status === "running_backend") return "Analizando (backend)";
  if (status === "error") return "Con error";
  return "Inicializando";
}

function roundRect(ctx, x, y, w, h, r, fill) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}
