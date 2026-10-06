// Single source of truth for API base URL
// Priority:
// 1) window.__ENV.API_URL (injected at runtime, e.g. by Nginx env-subst)
// 2) REACT_APP_API_URL (build-time env for CRA)
// 3) Fallback inteligente:
//    - Dev server (5173/3000) -> http://<host>:8000/api
//    - Nginx/prod -> `${origin}/api`

const runtimeEnv =
  (typeof window !== "undefined" && window.__ENV) ? window.__ENV : {};

const isBrowser = typeof window !== "undefined";
const port = isBrowser ? String(window.location.port || "") : "";
const hostname = isBrowser ? window.location.hostname || "localhost" : "localhost";
const isDevServer = port === "5173" || port === "3000";

const fallbackApi = isBrowser
  ? isDevServer
    ? `http://${hostname}:8000/api`
    : `${window.location.origin}/api`
  : "http://localhost:8000/api";

function normalizeApiUrl(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return rawValue;

  const withoutTrailingSlash = rawValue.replace(/\/+$/, "");

  if (/^https?:\/\/[^/]+$/i.test(withoutTrailingSlash)) {
    return `${withoutTrailingSlash}/api`;
  }

  if (withoutTrailingSlash === "/") {
    return "/api";
  }

  return withoutTrailingSlash;
}

const API_URL = normalizeApiUrl(
  runtimeEnv && runtimeEnv.API_URL ||
  process.env.REACT_APP_API_URL ||
  fallbackApi
);

export { API_URL, normalizeApiUrl };
export default API_URL;
