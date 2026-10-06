import React, { useEffect, useMemo, useState } from "react";
import { FaLink, FaShieldAlt, FaTable } from "react-icons/fa";

import {
  ActionButton,
  EmptyState,
  FieldShell,
  SectionCard,
  SegmentedTabs,
  StatusBadge,
} from "../SystemTheme";
import {
  loadProductionModulePayload,
  saveProductionModulePayload,
} from "../../services/productionModule";

function SmallInput({ value, onChange, placeholder = "" }) {
  return (
    <input
      type="text"
      className="tm-control"
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function CategoryEditor({ items, onChange }) {
  const updateRow = (index, nextRow) => {
    onChange(items.map((item, itemIndex) => (itemIndex === index ? nextRow : item)));
  };

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-[22px] border border-slate-200 bg-white/92">
        <div className="overflow-x-auto">
          <table className="tm-data-table min-w-full text-slate-900">
            <thead>
              <tr className="text-left">
                <th>Categoría</th>
                <th>Opciones</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={`category-${index}`}>
                  <td>
                    <SmallInput
                      value={item.category}
                      onChange={(value) => updateRow(index, { ...item, category: value })}
                      placeholder="Categoría"
                    />
                  </td>
                  <td>
                    <textarea
                      className="tm-control min-h-[88px]"
                      rows={3}
                      value={(item.options || []).join("\n")}
                      onChange={(event) =>
                        updateRow(index, {
                          ...item,
                          options: event.target.value
                            .split("\n")
                            .map((value) => value.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </td>
                  <td>
                    <ActionButton
                      variant="danger"
                      className="!px-3 !py-1.5"
                      onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
                    >
                      Quitar
                    </ActionButton>
                  </td>
                </tr>
              ))}

              {items.length === 0 ? (
                <tr>
                  <td colSpan={3} className="text-center text-slate-500">
                    No hay categorías configuradas.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <ActionButton
        variant="secondary"
        onClick={() => onChange([...items, { category: "", options: [] }])}
      >
        Agregar categoría
      </ActionButton>
    </div>
  );
}

function ListEditor({ listKey, items, onChange }) {
  const updateRow = (index, nextRow) => {
    onChange(items.map((item, itemIndex) => (itemIndex === index ? nextRow : item)));
  };

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-[22px] border border-slate-200 bg-white/92">
        <div className="overflow-x-auto">
          <table className="tm-data-table min-w-full text-slate-900">
            <thead>
              <tr className="text-left">
                <th>Código</th>
                <th>Etiqueta</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={`${listKey}-${index}`}>
                  <td>
                    <SmallInput
                      value={item.code}
                      onChange={(value) => updateRow(index, { ...item, code: value })}
                      placeholder="Código"
                    />
                  </td>
                  <td>
                    <SmallInput
                      value={item.label}
                      onChange={(value) => updateRow(index, { ...item, label: value })}
                      placeholder="Etiqueta"
                    />
                  </td>
                  <td>
                    <ActionButton
                      variant="danger"
                      className="!px-3 !py-1.5"
                      onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
                    >
                      Quitar
                    </ActionButton>
                  </td>
                </tr>
              ))}

              {items.length === 0 ? (
                <tr>
                  <td colSpan={3} className="text-center text-slate-500">
                    Esta lista aun no tiene filas.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <ActionButton
        variant="secondary"
        onClick={() => onChange([...items, { code: "", label: "" }])}
      >
        Agregar fila
      </ActionButton>
    </div>
  );
}

export default function ProductionConfigPanel() {
  const [payload, setPayload] = useState(null);
  const [activeTab, setActiveTab] = useState("lists");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [listKey, setListKey] = useState("Cuadrilla");
  const [roleOptions, setRoleOptions] = useState(["admin", "admin_produccion"]);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      setLoading(true);
      const nextPayload = await loadProductionModulePayload();
      if (mounted) {
        setPayload(nextPayload);
        setLoading(false);
      }

      try {
        const response = await fetch("/api/users/", {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token") || ""}`,
          },
        });
        if (!response.ok) return;
        const users = await response.json();
        const roles = Array.from(
          new Set(
            (Array.isArray(users) ? users : [])
              .map((item) => String(item?.role || "").trim())
              .filter(Boolean)
              .concat(["admin_produccion"])
          )
        );
        if (mounted && roles.length) {
          setRoleOptions(roles);
        }
      } catch (_error) {
        // usamos defaults silenciosamente
      }
    }

    loadData();
    return () => {
      mounted = false;
    };
  }, []);

  const lists = payload?.referenceData?.lists || {};
  const listOptions = Object.keys(lists);
  const activeListRows = lists[listKey] || [];
  const cnc = payload?.referenceData?.cnc || { external: [], internal: [], cargosMineria: [], cargosOOCC: [] };
  const allowedRoles = useMemo(
    () => payload?.permissions?.allowedRoles || ["admin_produccion"],
    [payload]
  );

  useEffect(() => {
    if (listOptions.length && !listOptions.includes(listKey)) {
      setListKey(listOptions[0]);
    }
  }, [listKey, listOptions]);

  const updatePayload = (updater) => {
    setPayload((current) => {
      if (!current) return current;
      return updater(current);
    });
    setMessage("");
  };

  const handleSave = async () => {
    if (!payload) return;
    setSaving(true);
    setMessage("");
    try {
      const saved = await saveProductionModulePayload(payload);
      setPayload(saved);
      setMessage("Configuración de Producción guardada.");
    } catch (error) {
      setMessage(`No se pudo guardar: ${error.message || error}`);
    } finally {
      setSaving(false);
    }
  };

  const permissionItems = useMemo(
    () =>
      roleOptions.map((role) => ({
        role,
        enabled: allowedRoles.includes(role),
      })),
    [allowedRoles, roleOptions]
  );

  return (
    <SectionCard
      title="Producción"
      subtitle="Tablas maestras, CNC y visibilidad del nuevo módulo operativo."
      actions={
        <ActionButton onClick={handleSave} disabled={loading || saving}>
          {saving ? "Guardando..." : "Guardar cambios"}
        </ActionButton>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedTabs
            items={[
              { value: "lists", label: "Listas", icon: <FaTable className="text-sm" /> },
              { value: "cnc", label: "CNC", icon: <FaLink className="text-sm" /> },
              { value: "permissions", label: "Permisos", icon: <FaShieldAlt className="text-sm" /> },
            ]}
            value={activeTab}
            onChange={setActiveTab}
          />

          {message ? <StatusBadge tone="green">{message}</StatusBadge> : null}
        </div>

        {loading ? <div className="text-sm text-slate-500">Cargando configuración de Producción...</div> : null}

        {!loading && !payload ? (
          <EmptyState
            title="No fue posible cargar Producción"
            description="Revisa la conexión con el backend o vuelve a abrir esta pestaña."
          />
        ) : null}

        {!loading && payload && activeTab === "lists" ? (
          <div className="space-y-4">
            <div className="grid gap-3 lg:max-w-[360px]">
              <label className="block">
                <FieldShell label="Lista activa">
                  <select className="tm-control" value={listKey} onChange={(event) => setListKey(event.target.value)}>
                    {listOptions.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </FieldShell>
              </label>
            </div>

            <ListEditor
              listKey={listKey}
              items={activeListRows}
              onChange={(nextRows) =>
                updatePayload((current) => ({
                  ...current,
                  referenceData: {
                    ...current.referenceData,
                    lists: {
                      ...current.referenceData.lists,
                      [listKey]: nextRows,
                    },
                  },
                }))
              }
            />
          </div>
        ) : null}

        {!loading && payload && activeTab === "cnc" ? (
          <div className="grid gap-5 xl:grid-cols-2">
            <div className="space-y-3">
              <div className="text-sm font-semibold text-slate-900">CNC externas</div>
              <CategoryEditor
                items={cnc.external || []}
                onChange={(items) =>
                  updatePayload((current) => ({
                    ...current,
                    referenceData: {
                      ...current.referenceData,
                      cnc: {
                        ...current.referenceData.cnc,
                        external: items,
                      },
                    },
                  }))
                }
              />
            </div>

            <div className="space-y-3">
              <div className="text-sm font-semibold text-slate-900">CNC internas</div>
              <CategoryEditor
                items={cnc.internal || []}
                onChange={(items) =>
                  updatePayload((current) => ({
                    ...current,
                    referenceData: {
                      ...current.referenceData,
                      cnc: {
                        ...current.referenceData.cnc,
                        internal: items,
                      },
                    },
                  }))
                }
              />
            </div>
          </div>
        ) : null}

        {!loading && payload && activeTab === "permissions" ? (
          <div className="space-y-4">
            <div className="rounded-[22px] border border-slate-200 bg-slate-50/85 px-4 py-4 text-sm text-slate-600">
              El menú Producción se muestra solo a los roles habilitados. Por defecto queda visible para
              <span className="font-semibold text-slate-900"> admin_produccion </span>
              con clave <span className="font-semibold text-slate-900">123</span>.
            </div>

            <div className="overflow-hidden rounded-[22px] border border-slate-200 bg-white/92">
              <div className="overflow-x-auto">
                <table className="tm-data-table min-w-full text-slate-900">
                  <thead>
                    <tr className="text-left">
                      <th>Rol</th>
                      <th>Ver módulo Producción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {permissionItems.map((item) => (
                      <tr key={item.role}>
                        <td>{item.role}</td>
                        <td>
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={item.enabled}
                              onChange={(event) => {
                                const nextRoles = event.target.checked
                                  ? [...allowedRoles, item.role]
                                  : allowedRoles.filter((role) => role !== item.role);
                                updatePayload((current) => ({
                                  ...current,
                                  permissions: {
                                    ...current.permissions,
                                    allowedRoles: Array.from(new Set(nextRoles.filter(Boolean))),
                                  },
                                }));
                              }}
                            />
                            <span>{item.enabled ? "Habilitado" : "Oculto"}</span>
                          </label>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
