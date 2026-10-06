import React from "react";
import { FaExternalLinkAlt } from "react-icons/fa";

export default function ControlTraficoBarreras() {
  const configuredUrl = process.env.REACT_APP_CONTROL_TRAFICO_BARRERAS_URL;
  const url =
    window.__ENV?.CONTROL_TRAFICO_BARRERAS_URL ||
    configuredUrl ||
    `${window.location.protocol}//${window.location.hostname}:8091/embed`;

  return (
    <main className="flex h-[calc(100vh-1px)] min-h-[620px] flex-col overflow-hidden bg-slate-950">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 bg-slate-900 px-4 py-2 text-white">
        <div>
          <h1 className="text-sm font-semibold">Control de tráfico vial / barreras</h1>
          <p className="text-xs text-slate-300">
            Si el panel no carga, inicia el servicio desde ControlTrafico-Standalone-TMOne-Entrega.
          </p>
        </div>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
        >
          <FaExternalLinkAlt /> Abrir en otra ventana
        </a>
      </div>
      <iframe
        title="Control de tráfico vial / barreras"
        src={url}
        className="min-h-0 w-full flex-1 border-0"
        allow="autoplay; fullscreen"
      />
    </main>
  );
}
