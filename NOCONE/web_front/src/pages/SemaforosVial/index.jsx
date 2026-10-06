import React, { useEffect, useState } from "react";
import { BsArrowUpRight, BsSignIntersectionSide, BsSpeedometer2 } from "react-icons/bs";

import { PageShell, SectionCard, StatusBadge } from "../../components/SystemTheme";
import { fetchExternalSources, normalizeExternalSources } from "../../services/externalSources";

const SemaforosVial = () => {
  const [sourceConfig, setSourceConfig] = useState(() => normalizeExternalSources());
  const [sourceError, setSourceError] = useState("");

  useEffect(() => {
    let active = true;

    fetchExternalSources().then((data) => {
      if (!active) return;
      setSourceConfig(normalizeExternalSources(data));
      setSourceError(data?._error || "");
    });

    return () => {
      active = false;
    };
  }, []);

  return (
    <PageShell
      eyebrow="Control vial"
      title="Semáforos control vial"
      description="La app operacional se muestra embebida dentro de TM One usando una fuente externa configurable, manteniendo una experiencia continua y sin salir del sistema."
      actions={<StatusBadge tone="amber">Vista operacional</StatusBadge>}
      stats={[
      {
        label: "Panel",
        value: "Embebido",
        meta: "Aplicación externa integrada en TM One",
        tone: "amber",
        icon: <BsSpeedometer2 />
      },
      {
        label: "Contexto",
        value: "Circulación",
        meta: "Fuente configurable hacia la app vial",
        tone: "blue",
        icon: <BsSignIntersectionSide />
      }]
      }>
      
      <SectionCard
        title="Vista principal"
        subtitle={`La aplicación de control vial corre en su origen operativo y se presenta aquí a través de un iframe apuntando a ${sourceConfig.control_vial_url}.`}
        bodyClassName="p-0">
        
        <div className="tm-muted-grid p-4">
          {sourceError ?
          <div className="mb-4 rounded-[22px] border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-800">
              No se pudo leer la configuración remota y se está usando la URL por defecto.
            </div> :
          null}

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-slate-200 bg-white/80 px-4 py-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Origen embebido
              </div>
              <div className="mt-1 text-sm font-medium text-slate-900">
                App dockerizada disponible en {sourceConfig.control_vial_url}
              </div>
            </div>

            <a
              href={sourceConfig.control_vial_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700">
              
              <span>Abrir vista directa</span>
              <BsArrowUpRight />
            </a>
          </div>

          <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-slate-950 shadow-[0_20px_42px_rgba(15,23,42,0.18)]">
            <iframe
              title="Semáforos control vial"
              src={sourceConfig.control_vial_url}
              className="h-[76vh] w-full border-0 bg-white"
              referrerPolicy="no-referrer" />
            
          </div>
        </div>
      </SectionCard>
    </PageShell>);

};

export default SemaforosVial;
