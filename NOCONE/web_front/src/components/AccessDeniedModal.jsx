import React from "react";
import { createPortal } from "react-dom";

import { ActionButton } from "./SystemTheme";

export default function AccessDeniedModal({
  open,
  resourceLabel = "este recurso",
  onClose,
}) {
  if (!open) return null;

  const content = (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/55 px-4 py-8 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-[28px] border border-white/75 bg-white/95 shadow-[0_30px_70px_rgba(15,23,42,0.22)]">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="text-lg font-semibold text-slate-900">Módulo / recurso no disponible</div>
          <div className="mt-1 text-sm text-slate-500">
            Este módulo o recurso no está habilitado para este usuario.
          </div>
        </div>

        <div className="px-5 py-5 text-sm text-slate-600">
          El perfil actual no tiene acceso a{" "}
          <span className="font-semibold text-slate-900">{resourceLabel}</span>. Solicita habilitación al
          administrador si necesitas usar esta sección.
        </div>

        <div className="flex justify-end border-t border-slate-200 px-5 py-4">
          <ActionButton onClick={onClose}>Entendido</ActionButton>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return content;
  }

  return createPortal(content, document.body);
}
