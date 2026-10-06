import { API_ROOT } from '../services/apiBase'

const runtimeConfig = {
  appName: import.meta.env.VITE_APP_NAME || 'Sismico_new_code',
  environment: import.meta.env.VITE_APP_ENV || 'local',
  apiBaseUrl: API_ROOT,
  pollingIntervalMs: Number(import.meta.env.VITE_POLLING_INTERVAL_MS || 15000),
}

export function getRuntimeConfig() {
  return runtimeConfig
}

export function getApiBaseUrl() {
  return runtimeConfig.apiBaseUrl.replace(/\/$/, '')
}
