import { responseErrorMessage } from './responseError.js';
import { API_BASE_URL } from './apiBase';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(import.meta.env.VITE_EMBED_NOCONE !== 'true' && localStorage.getItem('tmone_auth') ? { Authorization: `Bearer ${JSON.parse(localStorage.getItem('tmone_auth')).token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  if (!response.ok) {
    throw new Error(await responseErrorMessage(response));
  }

  if (response.status === 204) return null;
  return isJson ? response.json() : response.text();
}

/* =========================
   SISMICO CORE
========================= */

export const getSismicoSites = () => request('/api/sismico/sites');
export const getSismicoActivePolygons = () => request('/api/sismico/active-polygons');
export const getSismicoSite = (site) => request(`/api/sismico/sites/${site}`);
export const getSismicoSiteState = (site) => request(`/api/sismico/sites/${site}/state`);
export const getSismicoPollingStatus = (site) => request(`/api/sismico/polling/status?site_code=${site}`);
export const runSismicoPolling = (site) =>
  request('/api/sismico/polling/run', {
    method: 'POST',
    body: JSON.stringify({ site_code: site }),
  });

export const getSismicoDiagnostics = (site, params = {}) => {
  const queryParams = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    const normalizedKey =
      key === 'liveFetch' ? 'live_fetch' :
      key === 'forceEndpointCode' ? 'force_endpoint_code' :
      key;
    queryParams.set(normalizedKey, String(value));
  });
  const query = queryParams.toString();
  return request(`/api/sismico/diagnostics/${site}${query ? `?${query}` : ''}`);
};

export const setObjectState = (site, payload) =>
  request(`/api/sismico/operator/site/${site}/object-state`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const setSismicoObjectState = setObjectState;

/* =========================
   SCREENS / EMERGENCY
========================= */

export const sendHeartbeat = (screen = 'main', extra = {}) =>
  request('/api/screens/heartbeat', {
    method: 'POST',
    body: JSON.stringify({ screen, ...extra }),
  });

export const getEmergencyState = () => request('/api/screens/emergency');
export const setEmergencyState = (payload) =>
  request('/api/screens/emergency', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

/* =========================
   CONFIG / SYSTEM
========================= */

export const loadPublicRuntimeConfig = () => request('/api/config/public');
export const getConfigSystem = () => request('/api/config/system');
export const updateConfigSystem = (data) =>
  request('/api/config/system', {
    method: 'PUT',
    body: JSON.stringify(data),
  });

/* =========================
   SEMAFOROS
========================= */

export const getConfigSemaforos = () => request('/api/config/semaforos');
export const createConfigSemaforo = (data) =>
  request('/api/config/semaforos', {
    method: 'POST',
    body: JSON.stringify(data),
  });
export const updateConfigSemaforo = (itemId, data) =>
  request(`/api/config/semaforos/${itemId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const executeSemaforos = (payload) =>
  request('/api/semaforos/execute-all', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

/* =========================
   AGENTE IA
========================= */

export const askAgent = (payload) =>
  request('/api/agent/ask', {
    method: 'POST',
    body: JSON.stringify(typeof payload === 'string' ? { question: payload } : (payload || {})),
  });
export const loadFaqs = () => request('/api/agent/faqs');
export const getAgentStatus = () => request('/api/agent/status');

/* =========================
   PRODUCTIVIDAD
========================= */

export const loadSismicoProductivityFilters = () => request('/api/module-tmone/productivity/filters');

export const loadSismicoProductivityDashboard = (params = {}) => {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    query.set(key, value);
  });
  return request(`/api/module-tmone/productivity/dashboard${query.toString() ? `?${query.toString()}` : ''}`);
};

export const loadProductivityChart = (params = {}) => {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    query.set(key, value);
  });
  return request(`/api/module-tmone/productivity/chart${query.toString() ? `?${query.toString()}` : ''}`);
};

export const loadProductivitySummary = (params = {}) => {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    query.set(key, value);
  });
  return request(`/api/module-tmone/productivity/summary${query.toString() ? `?${query.toString()}` : ''}`);
};

/* =========================
   ZONAS DET
========================= */

export const loadZonesDet = () => request('/api/zones/det');

/* =========================
   MAPAS / POLIGONOS
========================= */

export const getPolygonSites = () => request('/api/config/polygon-sites');

export const getMapPolygons = (siteCode, mapCode) =>
  request(`/api/config/polygon-maps/${siteCode}/${mapCode}/polygons`);

export const updateMapPolygon = (siteCode, mapCode, mapObjectId, data) =>
  request(`/api/config/polygon-maps/${siteCode}/${mapCode}/polygons/${mapObjectId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

/* =========================
   USERS / COMPANIES / CONFIG
========================= */

export const getConfigUsers = () => request('/api/config/users');
export const createConfigUser = (data) =>
  request('/api/config/users', {
    method: 'POST',
    body: JSON.stringify(data),
  });
export const updateConfigUser = (itemId, data) =>
  request(`/api/config/users/${itemId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const getConfigCompanies = () => request('/api/config/companies');
export const createConfigCompany = (data) =>
  request('/api/config/companies', {
    method: 'POST',
    body: JSON.stringify(data),
  });
export const updateConfigCompany = (itemId, data) =>
  request(`/api/config/companies/${itemId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const getConfigExternalSources = () => request('/api/config/external-sources');
export const createConfigExternalSource = (data) =>
  request('/api/config/external-sources', {
    method: 'POST',
    body: JSON.stringify(data),
  });
export const updateConfigExternalSource = (itemId, data) =>
  request(`/api/config/external-sources/${itemId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const getScreens = () => request('/api/config/screens');
export const createConfigScreen = (data) =>
  request('/api/config/screens', {
    method: 'POST',
    body: JSON.stringify(data),
  });
export const updateConfigScreen = (itemId, data) =>
  request(`/api/config/screens/${itemId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });


export const loginRequest = (payload) => request('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) });
