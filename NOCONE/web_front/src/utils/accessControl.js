const USER_PERMISSION_STORAGE_KEY = "tm_user_permissions";

export const ROUTE_ACCESS_RULES = [
{ path: "/cameras/ver", label: "Cámaras / Ver cámaras", permissionKeys: ["camaras:ver_camaras", "camaras:camaras"] },
{ path: "/produccion", label: "Producción", permissionKeys: ["produccion:produccion", "produccion:plano", "produccion:gantt_mineria", "produccion:control_mineria", "produccion:gantt_oocc", "produccion:control_oocc", "produccion:horas_mineria"] },
{ path: "/access", label: "Acceso", permissionKeys: ["acceso:acceso"] },
{ path: "/cameras", label: "Cámaras", permissionKeys: ["camaras:camaras"] },
{ path: "/cameras/nok", label: "NOC", permissionKeys: ["camaras:nok_camaras"] },
{ path: "/productividad", label: "Productividad", permissionKeys: ["productividad:productividad"] },
{ path: "/mcp", label: "Agente IA TM One", permissionKeys: ["agente_ia:agente_ia"] },
{ path: "/config", label: "Configuración", permissionKeys: ["configuracion:configuracion", "configuracion:empresas", "configuracion:personas", "configuracion:equipos", "configuracion:porticos", "configuracion:tags", "configuracion:vehiculos", "configuracion:camaras", "configuracion:produccion", "configuracion:usuarios_permisos", "configuracion:fuentes_externas", "configuracion:actualizaciones"] },
{ path: "/sismico", label: "Semáforos sísmicos", permissionKeys: ["sismico:sismico"] },
{ path: "/semaforos-control-vial", label: "Semáforos control vial", permissionKeys: ["control_vial:control_vial"] },
{ path: "/control-trafico-barreras", label: "Control de tráfico vial / barreras", permissionKeys: ["control_vial:control_vial"] },
{ path: "/lobby", label: "Tracking / Zonas DET", permissionKeys: ["tracking:zonas_det", "tracking:tracking"] },
{ path: "/", label: "Tracking", permissionKeys: ["tracking:tracking", "tracking:mapa", "tracking:alertas", "tracking:tiempo_real", "tracking:movimiento"] }];


function normalizeRoleName(value) {
  return String(value || "").trim().toLowerCase();
}

export function isAdminRole(value) {
  const normalized = normalizeRoleName(value);
  return normalized === "admin" || normalized === "administrador";
}

export function getCurrentRoleNames() {
  if (typeof window === "undefined") {
    return [];
  }

  const roleName = String(window.localStorage.getItem("role_name") || "").trim();
  return roleName ? [roleName] : [];
}

export function getStoredUserPermissions() {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(USER_PERMISSION_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

export function setStoredUserPermissions(permissions) {
  const nextValue =
  permissions && typeof permissions === "object" && !Array.isArray(permissions) ? permissions : {};
  if (typeof window !== "undefined") {
    window.localStorage.setItem(USER_PERMISSION_STORAGE_KEY, JSON.stringify(nextValue));
    window.dispatchEvent(new Event("user-permissions-updated"));
    window.dispatchEvent(new Event("auth-updated"));
  }
  return nextValue;
}

export async function syncStoredUserPermissions() {
  if (typeof window === "undefined") return {};

  const token = window.localStorage.getItem("token") || "";
  if (!token) {
    return setStoredUserPermissions({});
  }

  try {
    const response = await fetch("/api/users/me/permissions", {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    return setStoredUserPermissions(payload?.allowed || {});
  } catch (_error) {
    return setStoredUserPermissions({});
  }
}

export function hasAnyPermission(permissionKeys, options = {}) {
  const keys = Array.isArray(permissionKeys) ? permissionKeys : [permissionKeys];
  const roles = Array.isArray(options.roles) ? options.roles : getCurrentRoleNames();
  if (roles.some(isAdminRole)) {
    return true;
  }

  const permissions = options.permissions || getStoredUserPermissions();
  return keys.some((key) => Boolean(permissions[String(key || "")]));
}

export function hasPermission(permissionKey, options = {}) {
  return hasAnyPermission([permissionKey], options);
}

export function hasModuleAccess(moduleKey, options = {}) {
  const prefix = `${String(moduleKey || "").trim()}:`;
  if (!prefix || prefix === ":") {
    return false;
  }
  const roles = Array.isArray(options.roles) ? options.roles : getCurrentRoleNames();
  if (roles.some(isAdminRole)) {
    return true;
  }
  const permissions = options.permissions || getStoredUserPermissions();
  return Object.entries(permissions).some(
    ([key, allowed]) => Boolean(allowed) && String(key || "").startsWith(prefix)
  );
}

export function getRouteAccessRule(pathname) {
  return ROUTE_ACCESS_RULES.find((item) => item.path === pathname) || null;
}

export function canAccessRoute(pathname, options = {}) {
  const rule = getRouteAccessRule(pathname);
  if (!rule) return true;
  return hasAnyPermission(rule.permissionKeys, options);
}

export function getFirstAccessiblePath(options = {}) {
  const roles = Array.isArray(options.roles) ? options.roles : getCurrentRoleNames();
  const permissions = options.permissions || getStoredUserPermissions();

  if (roles.some(isAdminRole)) {
    return "/";
  }

  const allowed = ROUTE_ACCESS_RULES.find((item) =>
  hasAnyPermission(item.permissionKeys, { roles, permissions })
  );
  return allowed?.path || null;
}
