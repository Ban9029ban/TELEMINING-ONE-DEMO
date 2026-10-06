/**
 * web_front/public/js/config.js
 *
 * Se carga como <script> estatico (NO es modulo ES).
 * Fuente de verdad runtime:
 *   window.__ENV.API_URL
 *   window.__ENV.LISTENER_URL
 *
 * Regla:
 *   - En dev server (3000/5173): API por puerto 8000 del mismo host
 *   - En Nginx/prod: API por el mismo host/puerto del front: <origin>/api
 *   - Listener por el mismo host, puerto 8090: <protocol>//<host>:8090
 */
(function () {
  window.__ENV = window.__ENV || {};

  const protocol = window.location.protocol; // http: | https:
  const hostname = window.location.hostname; // localhost | tmone.denial.cl | ip
  const origin = window.location.origin; // incluye puerto (ej: http://localhost:8081)
  const port = String(window.location.port || "");
  const isDevServer = port === "3000" || port === "5173";

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

  const defaultApi = isDevServer
    ? `http://${hostname}:8000/api`
    : `${origin}/api`;

  const defaultListener = `${protocol}//${hostname}:8090`;

  window.__ENV.API_URL = normalizeApiUrl(window.__ENV.API_URL || defaultApi);
  window.__ENV.LISTENER_URL = window.__ENV.LISTENER_URL || defaultListener;

  // backward-compat (si alguna parte antigua usa __APP_CONFIG__)
  window.__APP_CONFIG__ = window.__APP_CONFIG__ || {};
  window.__APP_CONFIG__.API_BASE_URL = window.__ENV.API_URL;
})();
