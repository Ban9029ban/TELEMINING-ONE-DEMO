import { API_URL } from "../src/api-config";

const host = window.location.hostname;
const port = window.location.port;

const isLocalHost =
  host === "localhost" ||
  host === "127.0.0.1" ||
  host === "0.0.0.0";

const isDevServerPort = port === "3000" || port === "5173";

// Permite override runtime si existe (public/js/config.js)
const runtimeEnv = window.__ENV || {};

export const LISTENER_URL =
  runtimeEnv.LISTENER_URL ||
  (isDevServerPort && isLocalHost
    ? "http://localhost:8090"
    : `${window.location.protocol}//${host}:8090`);

export { API_URL };
