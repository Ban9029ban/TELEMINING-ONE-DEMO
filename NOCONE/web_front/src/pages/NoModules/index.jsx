import React, { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import useUserPermissions from "../../hooks/useUserPermissions";
import { getFirstAccessiblePath, syncStoredUserPermissions } from "../../utils/accessControl";

export default function NoModules() {
  const { permissions, roles, ready } = useUserPermissions();
  const [refreshing, setRefreshing] = useState(false);
  const target = getFirstAccessiblePath({ permissions, roles });

  if (ready && target) return <Navigate to={target} replace />;

  return (
    <section className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-slate-800">
      <h1 className="text-xl font-semibold">Sesión iniciada</h1>
      <p className="mt-3">
        Tu cuenta todavía no tiene módulos asignados. Solicita al administrador que configure tus permisos de acceso.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button
          type="button"
          className="rounded-lg bg-slate-900 px-4 py-2 text-white"
          disabled={!ready || refreshing}
          onClick={async () => {
            setRefreshing(true);
            try { await syncStoredUserPermissions(); }
            finally { setRefreshing(false); }
          }}
        >
          {refreshing ? "Actualizando…" : "Actualizar permisos"}
        </button>
        <Link to="/logout">Cerrar sesión</Link>
      </div>
    </section>
  );
}
