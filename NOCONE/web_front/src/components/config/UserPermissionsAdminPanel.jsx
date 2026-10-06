import React, { useEffect, useMemo, useState } from "react";

import {
  ActionButton,
  EmptyState,
  FieldShell,
  SectionCard,
  StatusBadge,
} from "../SystemTheme";

const ROLE_SUGGESTIONS = [
  { value: "user", label: "Sin permisos" },
  { value: "tracking", label: "Tracking" },
  { value: "produccion", label: "Producción" },
  { value: "admin_produccion", label: "Admin Producción" },
  { value: "acceso", label: "Acceso" },
  { value: "camaras", label: "Cámaras" },
  { value: "nok_camaras", label: "NOC" },
  { value: "configuracion", label: "Configuración" },
  { value: "productividad", label: "Productividad" },
  { value: "sismico", label: "Semáforos sísmicos" },
  { value: "control_vial", label: "Semáforos control vial" },
  { value: "agente_ia", label: "Agente IA TM One" },
  { value: "admin", label: "Administrador" },
];
const LICENSE_INTERVAL_OPTIONS = [5, 10, 30, 60, 360];

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatDateInputValue(value) {
  if (!value) return "";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function buildFutureDateInput(days) {
  const base = new Date();
  base.setHours(12, 0, 0, 0);
  base.setDate(base.getDate() + Number(days || 0));
  return `${base.getFullYear()}-${pad2(base.getMonth() + 1)}-${pad2(base.getDate())}`;
}

function parseDateInputValue(value) {
  if (!value) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return null;
  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatLicenseDateLabel(value) {
  const parsed = parseDateInputValue(value) || new Date(`${String(value || "").slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed?.getTime?.())) return "-";
  return parsed.toLocaleDateString("es-CL");
}

function getLicenseDaysRemaining(value) {
  const parsed = parseDateInputValue(value);
  if (!parsed) return null;
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  return Math.round((parsed.getTime() - now.getTime()) / 86400000);
}

function getUserStatusMeta(user) {
  if (!user) {
    return { label: "Sin usuario", tone: "neutral" };
  }

  if (!user.is_active && user.license_is_expired) {
    return { label: "Inactivo y vencido", tone: "red" };
  }

  if (!user.is_active) {
    return { label: "Inactivo", tone: "amber" };
  }

  if (user.license_is_expired) {
    return { label: "Licencia vencida", tone: "red" };
  }

  return { label: "Activo", tone: "green" };
}

function describeLicenseWindow(value) {
  const daysRemaining = getLicenseDaysRemaining(value);
  if (daysRemaining == null) {
    return "Sin fecha de licencia asignada.";
  }
  if (daysRemaining < 0) {
    return `Vencida hace ${Math.abs(daysRemaining)} día(s).`;
  }
  if (daysRemaining === 0) {
    return "Vence hoy.";
  }
  return `Vence en ${daysRemaining} día(s).`;
}

function normalizeUserDraft(user = {}) {
  return {
    id: user.id ?? null,
    username: user.username || "",
    full_name: user.full_name || "",
    role: user.role || "user",
    password: "",
    is_active: user.is_active == null ? true : Boolean(user.is_active),
    license_expires_on:
      formatDateInputValue(user.license_expires_on) ||
      buildFutureDateInput(360),
  };
}

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiJson(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(options.headers || {}),
    },
    ...options,
  });

  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");

  if (!response.ok) {
    const detail =
      typeof body === "object" && body ? body.detail || JSON.stringify(body) : String(body || "Error");
    throw new Error(detail);
  }

  return body;
}

function UserEditorModal({ open, draft, mode, saving, onClose, onChange, onSave }) {
  if (!open) return null;
  const readOnly = mode === "view";
  const statusMeta = getUserStatusMeta({
    is_active: draft.is_active,
    license_is_expired: (getLicenseDaysRemaining(draft.license_expires_on) ?? 0) < 0,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-8 backdrop-blur-sm">
      <div className="w-full max-w-3xl overflow-hidden rounded-[28px] border border-white/75 bg-white/95 shadow-[0_30px_70px_rgba(15,23,42,0.22)]">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <div className="text-lg font-semibold text-slate-900">
              {mode === "view"
                ? `Ver usuario ${draft.username || ""}`
                : mode === "edit"
                ? `Editar usuario ${draft.username || ""}`
                : "Nuevo usuario"}
            </div>
            <div className="mt-1 text-sm text-slate-500">
              Administra usuario, rol, licencia y estado operativo. Si es nuevo, define una clave inicial.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
          >
            x
          </button>
        </div>

        <div className="grid gap-4 px-5 py-5 md:grid-cols-2">
          <div className="rounded-[20px] border border-slate-200 bg-slate-50/90 px-4 py-3 md:col-span-2">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge>
              <StatusBadge tone={(getLicenseDaysRemaining(draft.license_expires_on) ?? 0) < 0 ? "red" : "indigo"}>
                Licencia: {formatLicenseDateLabel(draft.license_expires_on)}
              </StatusBadge>
            </div>
            <div className="mt-2 text-sm text-slate-500">
              {describeLicenseWindow(draft.license_expires_on)}
            </div>
          </div>

          <label className="block">
            <FieldShell label="Usuario">
              <input
                className="tm-control"
                value={draft.username}
                disabled={readOnly}
                onChange={(event) => onChange("username", event.target.value)}
                placeholder="Ej: supervisor_turno"
              />
            </FieldShell>
          </label>

          <label className="block">
            <FieldShell label="Nombre completo">
              <input
                className="tm-control"
                value={draft.full_name}
                disabled={readOnly}
                onChange={(event) => onChange("full_name", event.target.value)}
                placeholder="Nombre y apellido"
              />
            </FieldShell>
          </label>

          <label className="block">
            <FieldShell label="Rol">
              <input
                list="tmone-role-suggestions"
                className="tm-control"
                value={draft.role}
                disabled={readOnly}
                onChange={(event) => onChange("role", event.target.value)}
                placeholder="user"
              />
              <datalist id="tmone-role-suggestions">
                {ROLE_SUGGESTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </datalist>
              <div className="mt-2 text-xs text-slate-500">
                Usa `user` para un perfil sin permisos o selecciona un preset como `configuracion`,
                `camaras` o `nok_camaras`.
              </div>
            </FieldShell>
          </label>

          <label className="block">
            <FieldShell label={mode === "edit" ? "Clave nueva (opcional)" : "Clave inicial"}>
              <input
                type="password"
                className="tm-control"
                value={draft.password}
                disabled={readOnly}
                onChange={(event) => onChange("password", event.target.value)}
                placeholder={mode === "edit" ? "Deja vacío para no cambiarla" : "Clave temporal"}
              />
            </FieldShell>
          </label>

          <label className="block md:col-span-2">
            <FieldShell label="Licencia vigente hasta">
              <input
                type="date"
                className="tm-control"
                value={draft.license_expires_on}
                disabled={readOnly}
                onChange={(event) => onChange("license_expires_on", event.target.value)}
              />

              <div className="mt-3 flex flex-wrap gap-2">
                {LICENSE_INTERVAL_OPTIONS.map((days) => (
                  <button
                    key={days}
                    type="button"
                    disabled={readOnly}
                    onClick={() => onChange("license_expires_on", buildFutureDateInput(days))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    +{days} días
                  </button>
                ))}
              </div>

              <div className="mt-2 text-xs text-slate-500">
                Puedes definir una fecha manual o usar intervalos rápidos de 5, 10, 30, 60 o 360 días.
              </div>
            </FieldShell>
          </label>

          <label className="flex items-center gap-3 rounded-[20px] border border-slate-200 bg-slate-50/90 px-4 py-3 md:col-span-2">
            <input
              type="checkbox"
              checked={draft.is_active}
              disabled={readOnly}
              onChange={(event) => onChange("is_active", event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-sm font-medium text-slate-700">Usuario activo</span>
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <ActionButton variant="secondary" onClick={onClose}>
            {readOnly ? "Cerrar" : "Cancelar"}
          </ActionButton>
          {!readOnly ? (
            <ActionButton onClick={onSave} disabled={saving}>
              {saving ? "Guardando..." : mode === "edit" ? "Guardar cambios" : "Crear usuario"}
            </ActionButton>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function UserPermissionsAdminPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [editor, setEditor] = useState({
    open: false,
    mode: "create",
    draft: normalizeUserDraft(),
  });

  async function loadBase() {
    setLoading(true);
    setError("");
    try {
      const nextUsers = await apiJson("/api/users/");
      const sortedUsers = Array.isArray(nextUsers) ? nextUsers : [];
      setUsers(sortedUsers);
      setSelectedUserId((current) =>
        sortedUsers.some((item) => String(item.id) === String(current))
          ? current
          : sortedUsers[0]?.id || null
      );
    } catch (requestError) {
      setError(String(requestError.message || requestError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBase();
  }, []);

  useEffect(() => {
    if (!selectedUserId) {
      setPermissions([]);
      return;
    }

    let mounted = true;
    apiJson(`/api/users/${selectedUserId}/permissions`)
      .then((response) => {
        if (mounted) {
          setPermissions(response?.items || []);
        }
      })
      .catch((requestError) => {
        if (mounted) {
          setError(String(requestError.message || requestError));
        }
      });

    return () => {
      mounted = false;
    };
  }, [selectedUserId]);

  const selectedUser = useMemo(
    () => users.find((item) => String(item.id) === String(selectedUserId)) || null,
    [selectedUserId, users]
  );

  const permissionsByModule = useMemo(() => {
    const grouped = new Map();
    permissions.forEach((item) => {
      const bucket = grouped.get(item.module_key) || [];
      bucket.push(item);
      grouped.set(item.module_key, bucket);
    });
    return Array.from(grouped.entries());
  }, [permissions]);

  const openCreate = () => {
    setEditor({
      open: true,
      mode: "create",
      draft: normalizeUserDraft(),
    });
  };

  const openEdit = (user) => {
    setEditor({
      open: true,
      mode: "edit",
      draft: normalizeUserDraft(user),
    });
  };

  const openView = (user) => {
    setEditor({
      open: true,
      mode: "view",
      draft: normalizeUserDraft(user),
    });
  };

  const toggleUserActive = async (user) => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await apiJson(`/api/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          is_active: !user.is_active,
        }),
      });
      await loadBase();
      setSelectedUserId(user.id);
      setMessage(user.is_active ? "Usuario deshabilitado." : "Usuario habilitado.");
    } catch (requestError) {
      setError(String(requestError.message || requestError));
    } finally {
      setSaving(false);
    }
  };

  const saveUser = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const draft = editor.draft;
      if (!draft.username || !draft.full_name) {
        throw new Error("Completa usuario y nombre para guardar.");
      }
      if (editor.mode === "create" && !draft.password) {
        throw new Error("Debes definir una clave inicial.");
      }
      if (!draft.license_expires_on) {
        throw new Error("Debes definir la fecha de vencimiento de la licencia.");
      }

      const path =
        editor.mode === "edit" && draft.id ? `/api/users/${draft.id}` : "/api/users/";
      const method = editor.mode === "edit" && draft.id ? "PATCH" : "POST";
      const body =
        method === "POST"
          ? {
              username: draft.username,
              full_name: draft.full_name,
              role: draft.role,
              password: draft.password,
              is_active: draft.is_active,
              license_expires_on: draft.license_expires_on || null,
            }
          : {
              username: draft.username,
              full_name: draft.full_name,
              role: draft.role,
              password: draft.password || undefined,
              is_active: draft.is_active,
              license_expires_on: draft.license_expires_on || null,
            };

      const saved = await apiJson(path, {
        method,
        body: JSON.stringify(body),
      });

      await loadBase();
      setSelectedUserId(saved?.id || draft.id || null);
      setEditor((current) => ({ ...current, open: false }));
      setMessage(editor.mode === "edit" ? "Usuario actualizado." :
        draft.role === "user" ? "Usuario creado. Asigna sus módulos en el panel de permisos para habilitar su acceso." : "Usuario creado.");
    } catch (requestError) {
      setError(String(requestError.message || requestError));
    } finally {
      setSaving(false);
    }
  };

  const savePermissions = async () => {
    if (!selectedUserId) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const saved = await apiJson(`/api/users/${selectedUserId}/permissions`, {
        method: "PUT",
        body: JSON.stringify({
          items: permissions.map((item) => ({
            module_key: item.module_key,
            submodule_key: item.submodule_key,
            allowed: Boolean(item.allowed),
          })),
        }),
      });
      setPermissions(saved?.items || []);
      setMessage("Permisos guardados.");
    } catch (requestError) {
      setError(String(requestError.message || requestError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SectionCard
        title="Usuarios y permisos"
        subtitle="Crea usuarios del sistema, edita sus datos y asigna accesos por módulo y submódulo."
        actions={
          <div className="flex flex-wrap gap-2">
            <ActionButton variant="secondary" onClick={loadBase}>
              Recargar
            </ActionButton>
            <ActionButton onClick={openCreate}>Nuevo usuario</ActionButton>
          </div>
        }
      >
        <div className="space-y-4">
          {error ? (
            <div className="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          {message ? (
            <div className="rounded-[18px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {message}
            </div>
          ) : null}

          {loading ? (
            <div className="text-sm text-slate-500">Cargando usuarios y catálogo de permisos...</div>
          ) : users.length === 0 ? (
            <EmptyState
              title="No hay usuarios disponibles"
              description="Crea el primer usuario operativo desde este panel."
            />
          ) : (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.25fr)]">
              <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white/92">
                <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">
                  Usuarios del sistema
                </div>
                <div className="overflow-x-auto">
                  <table className="tm-data-table min-w-full text-slate-900">
                    <thead>
                      <tr className="text-left">
                        <th>Usuario</th>
                        <th>Rol</th>
                        <th>Licencia</th>
                        <th>Estado</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((user) => {
                        const active = String(selectedUserId) === String(user.id);
                        const statusMeta = getUserStatusMeta(user);
                        return (
                          <tr
                            key={user.id}
                            className={active ? "bg-indigo-50/80" : ""}
                          >
                            <td>
                              <div className="font-semibold text-slate-900">{user.username}</div>
                              <div className="text-xs text-slate-500">{user.full_name || "-"}</div>
                            </td>
                            <td>{user.role || "user"}</td>
                            <td>
                              <div className="text-sm text-slate-800">
                                {formatLicenseDateLabel(user.license_expires_on)}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                {describeLicenseWindow(user.license_expires_on)}
                              </div>
                            </td>
                            <td>
                              <div className="flex flex-wrap gap-2">
                                <StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge>
                              </div>
                            </td>
                            <td>
                              <div className="flex flex-wrap gap-2">
                                <ActionButton
                                  variant="secondary"
                                  className="!px-3 !py-1.5"
                                  onClick={() => setSelectedUserId(user.id)}
                                >
                                  Seleccionar
                                </ActionButton>
                                <ActionButton
                                  variant="secondary"
                                  className="!px-3 !py-1.5"
                                  onClick={() => openView(user)}
                                >
                                  Ver
                                </ActionButton>
                                <ActionButton
                                  variant="secondary"
                                  className="!px-3 !py-1.5"
                                  onClick={() => openEdit(user)}
                                >
                                  Editar
                                </ActionButton>
                                <ActionButton
                                  variant="secondary"
                                  className="!px-3 !py-1.5"
                                  onClick={() => toggleUserActive(user)}
                                  disabled={saving}
                                >
                                  {user.is_active ? "Deshabilitar" : "Habilitar"}
                                </ActionButton>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-[24px] border border-slate-200 bg-white/92 px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        Matriz de permisos
                      </div>
                      <div className="mt-1 text-sm text-slate-500">
                        {selectedUser
                          ? `Usuario activo: ${selectedUser.username}`
                          : "Selecciona un usuario para editar su acceso."}
                      </div>
                      {selectedUser ? (
                        <div className="mt-2 text-sm text-slate-500">
                          Licencia hasta {formatLicenseDateLabel(selectedUser.license_expires_on)}.{" "}
                          {describeLicenseWindow(selectedUser.license_expires_on)}
                        </div>
                      ) : null}
                    </div>

                    {selectedUser ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone="indigo">{selectedUser.role || "user"}</StatusBadge>
                        <StatusBadge tone={getUserStatusMeta(selectedUser).tone}>
                          {getUserStatusMeta(selectedUser).label}
                        </StatusBadge>
                        <StatusBadge tone={selectedUser.license_is_expired ? "red" : "indigo"}>
                          Licencia: {formatLicenseDateLabel(selectedUser.license_expires_on)}
                        </StatusBadge>
                        <ActionButton
                          variant="secondary"
                          onClick={() => openView(selectedUser)}
                        >
                          Ver usuario
                        </ActionButton>
                        <ActionButton
                          variant="secondary"
                          onClick={() => openEdit(selectedUser)}
                        >
                          Editar usuario
                        </ActionButton>
                        <ActionButton
                          variant="secondary"
                          onClick={() => toggleUserActive(selectedUser)}
                          disabled={saving}
                        >
                          {selectedUser.is_active ? "Deshabilitar" : "Habilitar"}
                        </ActionButton>
                        <ActionButton onClick={savePermissions} disabled={saving}>
                          {saving ? "Guardando..." : "Guardar permisos"}
                        </ActionButton>
                      </div>
                    ) : null}
                  </div>
                </div>

                {!selectedUser ? (
                  <EmptyState
                    title="Sin usuario seleccionado"
                    description="Escoge un usuario de la tabla para administrar sus checks."
                  />
                ) : (
                  permissionsByModule.map(([moduleKey, items]) => (
                    <div
                      key={moduleKey}
                      className="overflow-hidden rounded-[24px] border border-slate-200 bg-white/92"
                    >
                      <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold uppercase tracking-[0.12em] text-slate-600">
                        {moduleKey}
                      </div>
                      <div className="overflow-x-auto">
                        <table className="tm-data-table min-w-full text-slate-900">
                          <thead>
                            <tr className="text-left">
                              <th>Módulo / submódulo</th>
                              <th>Acceso</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((item) => (
                              <tr key={`${item.module_key}:${item.submodule_key}`}>
                                <td>{item.label}</td>
                                <td>
                                  <label className="inline-flex items-center gap-3">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(item.allowed)}
                                      onChange={(event) =>
                                        setPermissions((current) =>
                                          current.map((row) =>
                                            row.module_key === item.module_key &&
                                            row.submodule_key === item.submodule_key
                                              ? { ...row, allowed: event.target.checked }
                                              : row
                                          )
                                        )
                                      }
                                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    <span className="text-sm text-slate-600">
                                      Permitir acceso
                                    </span>
                                  </label>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </SectionCard>

      <UserEditorModal
        open={editor.open}
        draft={editor.draft}
        mode={editor.mode}
        saving={saving}
        onClose={() => setEditor((current) => ({ ...current, open: false }))}
        onChange={(field, value) =>
          setEditor((current) => ({
            ...current,
            draft: {
              ...current.draft,
              [field]: value,
            },
          }))
        }
        onSave={saveUser}
      />
    </>
  );
}
