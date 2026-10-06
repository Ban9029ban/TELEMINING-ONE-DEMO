// web_front/src/pages/Cameras/models.js
// Mapea los modelCode lgicos del backend a un nico modelo YOLOv8s ONNX
// y maneja el cach de sesiones de onnxruntime-web.

import * as ort from "onnxruntime-web";

// Todas las variantes lgicas usan el mismo archivo ONNX
export const MODELS = {
  operational_safety_monitor: "/models/yolov8s.onnx",
  person_detection: "/models/yolov8s.onnx",
  person_count: "/models/yolov8s.onnx",
  object_detection: "/models/yolov8s.onnx",
  bolt_detection: "/models/yolov8s.onnx"
};

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.initTimeout = 12000;

const sessionCache = {};
const SESSION_TIMEOUT_MS = 12000;

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
  promise,
  new Promise((_, reject) => {
    window.setTimeout(() => {
      reject(new Error(`Tiempo de espera agotado al iniciar ${label}.`));
    }, timeoutMs);
  })]
  );
}

/**
 * Devuelve (con cach) la InferenceSession para el cdigo de modelo dado.
 * @param {string} modelCode - p.ej. "person_detection"
 */
export async function getModelSession(modelCode) {
  if (sessionCache[modelCode]) {
    return sessionCache[modelCode];
  }

  const modelUrl = MODELS[modelCode];
  if (!modelUrl) {
    throw new Error(`Modelo no configurado para code="${modelCode}"`);
  }

  console.log(`[IA] Cargando modelo ${modelCode} desde ${modelUrl}`);
  const sessionPromise = withTimeout(
    ort.InferenceSession.create(modelUrl, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all"
    }),
    SESSION_TIMEOUT_MS,
    `la sesión ONNX para ${modelCode}`
  ).catch((error) => {
    delete sessionCache[modelCode];
    throw error;
  });

  sessionCache[modelCode] = sessionPromise;
  return sessionPromise;
}