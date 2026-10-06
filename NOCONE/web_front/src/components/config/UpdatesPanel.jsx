import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FaDownload, FaEyeSlash, FaExternalLinkAlt, FaSyncAlt, FaTrashAlt } from "react-icons/fa";

const CATALOG_URL = "/api/config/updates";

async function readCatalog() {
  const token = localStorage.getItem("token");
  const response = await fetch(CATALOG_URL, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.detail || "No se pudieron cargar las actualizaciones.");
  }
  return Array.isArray(body?.items) ? body.items : [];
}

export default function UpdatesPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [confirmUninstall, setConfirmUninstall] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setItems(await readCatalog());
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const visibleItems = useMemo(
    () => items.filter((item) => showHidden || !item.hidden),
    [items, showHidden],
  );
  const hiddenCount = items.filter((item) => item.hidden).length;

  async function runAction(item, action) {
    if (action === "uninstall" && confirmUninstall !== item.id) {
      setConfirmUninstall(item.id);
      return;
    }
    setBusyId(item.id);
    setError("");
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${CATALOG_URL}/${encodeURIComponent(item.id)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.detail || "No se pudo actualizar el estado.");
      }
      await refresh();
      setConfirmUninstall("");
      window.dispatchEvent(new Event("zenit-updates-changed"));
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Actualizaciones</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Consulta los módulos añadidos a Zenit y administra su visibilidad e instalación.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hiddenCount > 0 ? (
            <button
              type="button"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              onClick={() => setShowHidden((value) => !value)}
            >
              {showHidden ? "Ocultar archivadas" : `Ver ocultas (${hiddenCount})`}
            </button>
          ) : null}
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            onClick={refresh}
            disabled={loading || Boolean(busyId)}
          >
            <FaSyncAlt className={loading ? "animate-spin" : ""} /> Actualizar lista
          </button>
        </div>
      </div>

      {error ? (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      {loading ? <div className="text-sm text-slate-500">Cargando actualizaciones…</div> : null}
      {!loading && visibleItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-8 text-center text-sm text-slate-500">
          No hay actualizaciones para mostrar.
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {visibleItems.map((item) => (
          <article key={item.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                    <FaDownload />
                  </span>
                  <div>
                    <h3 className="font-semibold text-slate-900">{item.name}</h3>
                    <div className="text-xs text-slate-500">Versión {item.version}</div>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-600">{item.description}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${item.installed ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                {item.installed ? "Instalada" : "No instalada"}
              </span>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
              {item.installed ? (
                <>
                  <a
                    href={item.route}
                    className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                  >
                    <FaExternalLinkAlt /> Abrir módulo
                  </a>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100"
                    onClick={() => runAction(item, "hide")}
                    disabled={busyId === item.id}
                  >
                    <FaEyeSlash /> Ocultar actualización
                  </button>
                  {confirmUninstall === item.id ? (
                    <>
                      <button
                        type="button"
                        className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100"
                        onClick={() => runAction(item, "uninstall")}
                        disabled={busyId === item.id}
                      >
                        Confirmar desinstalación
                      </button>
                      <button type="button" className="px-2 py-2 text-sm text-slate-500" onClick={() => setConfirmUninstall("")}>Cancelar</button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
                      onClick={() => runAction(item, "uninstall")}
                      disabled={busyId === item.id}
                    >
                      <FaTrashAlt /> Desinstalar
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                  onClick={() => runAction(item, "install")}
                  disabled={busyId === item.id}
                >
                  <FaDownload /> Instalar
                </button>
              )}
              {item.hidden ? (
                <button
                  type="button"
                  className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                  onClick={() => runAction(item, "unhide")}
                  disabled={busyId === item.id}
                >
                  Mostrar actualización
                </button>
              ) : null}
              {busyId === item.id ? <span className="text-xs text-slate-500">Guardando…</span> : null}
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Desinstalar quita el acceso del menú lateral; conserva el paquete local y sus datos para permitir una reinstalación.
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
