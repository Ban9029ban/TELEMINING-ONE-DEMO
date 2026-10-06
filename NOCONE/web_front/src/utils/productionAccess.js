import {
  getCurrentRoleNames,
  getStoredUserPermissions,
  setStoredUserPermissions,
  syncStoredUserPermissions,
  hasModuleAccess } from
"./accessControl";

const STORAGE_KEY = "production_allowed_roles";

export const DEFAULT_PRODUCTION_ALLOWED_ROLES = ["admin_produccion", "produccion"];

export function normalizeAllowedRoles(rawRoles) {
  if (!Array.isArray(rawRoles)) {
    return [...DEFAULT_PRODUCTION_ALLOWED_ROLES];
  }

  const normalized = [];
  const seen = new Set();

  rawRoles.forEach((item) => {
    const value = String(item || "").trim();
    if (!value) return;
    const lowered = value.toLowerCase();
    if (seen.has(lowered)) return;
    seen.add(lowered);
    normalized.push(value);
  });

  return normalized.length ? normalized : [...DEFAULT_PRODUCTION_ALLOWED_ROLES];
}

export function getStoredProductionAllowedRoles() {
  if (typeof window === "undefined") {
    return [...DEFAULT_PRODUCTION_ALLOWED_ROLES];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_PRODUCTION_ALLOWED_ROLES];
    return normalizeAllowedRoles(JSON.parse(raw));
  } catch (_error) {
    return [...DEFAULT_PRODUCTION_ALLOWED_ROLES];
  }
}

export function setStoredProductionAllowedRoles(rawRoles) {
  const roles = normalizeAllowedRoles(rawRoles);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(roles));
    window.dispatchEvent(new Event("production-access-updated"));
  }
  return roles;
}

export {
  getCurrentRoleNames,
  getStoredUserPermissions,
  setStoredUserPermissions,
  syncStoredUserPermissions };


export function canAccessProduction(_userRoles, _allowedRoles = getStoredProductionAllowedRoles()) {
  return hasModuleAccess("produccion");
}
