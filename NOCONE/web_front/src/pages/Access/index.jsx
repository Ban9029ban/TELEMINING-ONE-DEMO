import React, { useEffect, useMemo, useState } from "react";
import { BsBroadcastPin, BsDoorOpenFill } from "react-icons/bs";
import { FaCar, FaUser } from "react-icons/fa";

import { API_URL } from "../../api-config";
import {
  EmptyState,
  FieldShell,
  PageShell,
  SectionCard,
  SegmentedTabs,
  StatusBadge } from
"../../components/SystemTheme";

const API = API_URL;

export default function AccessPage() {
  const [porticos, setPorticos] = useState([]);
  const [selectedPortico, setSelectedPortico] = useState("");
  const [upperTab, setUpperTab] = useState("resumen");
  const [porticoSummary, setPorticoSummary] = useState([]);
  const [porticoConfig, setPorticoConfig] = useState([]);
  const [lowerTab, setLowerTab] = useState("personas");
  const [dayPeople, setDayPeople] = useState([]);
  const [dayVehicles, setDayVehicles] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [loading, setLoading] = useState(false);
  const [backendDown, setBackendDown] = useState(false);

  async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function formatDate(dtString) {
    if (!dtString) return "";
    const d = new Date(dtString);
    if (Number.isNaN(d.getTime())) return dtString;
    return d.toLocaleString("es-CL", { timeZone: "America/Santiago" });
  }

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchJSON(`${API}/access/porticos`);
        setPorticos(Array.isArray(data) ? data : []);
        setBackendDown(false);
      } catch (err) {
        console.warn("Backend no disponible al cargar pórticos:", err);
        setBackendDown(true);
      }
    })();
  }, []);

  async function loadUpperTables(currentPorticoId) {
    try {
      const summaryParams = new URLSearchParams();
      if (currentPorticoId) summaryParams.set("portico_id", String(currentPorticoId));

      const summary = await fetchJSON(
        `${API}/access/portico-summary?${summaryParams.toString()}`
      );
      setPorticoSummary(Array.isArray(summary) ? summary : []);

      if (currentPorticoId) {
        const config = await fetchJSON(`${API}/access/portico-config/${currentPorticoId}`);
        setPorticoConfig(Array.isArray(config) ? config : []);
      } else {
        setPorticoConfig([]);
      }

      setBackendDown(false);
    } catch (err) {
      console.warn("Backend no disponible en resumen:", err.message);
      setBackendDown(true);
      setPorticoSummary([]);
      setPorticoConfig([]);
    }
  }

  async function loadDaySummary(currentPorticoId) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (currentPorticoId) params.set("portico_id", String(currentPorticoId));
      params.set("as_of", new Date().toISOString());

      const query = params.toString();
      const data = await fetchJSON(
        `${API}/access/current-summary${query ? `?${query}` : ""}`
      );
      setDayPeople(Array.isArray(data?.personas) ? data.personas : []);
      setDayVehicles(Array.isArray(data?.vehiculos) ? data.vehiculos : []);
      setBackendDown(false);
    } catch (err) {
      console.warn("Backend no disponible en current-summary:", err);
      setBackendDown(true);
      setDayPeople([]);
      setDayVehicles([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadUpperTables(selectedPortico);
    loadDaySummary(selectedPortico);

    const interval = setInterval(() => {
      loadUpperTables(selectedPortico);
      loadDaySummary(selectedPortico);
    }, 5000);

    return () => clearInterval(interval);
    // Las funciones capturan el contexto esperado para el refresco del módulo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPortico]);

  const q = searchText.trim().toLowerCase();

  const filteredPeople = useMemo(() => {
    if (!q) return dayPeople;
    return dayPeople.filter((p) => {
      const s = [
      p.rut,
      p.full_name,
      p.position,
      p.company_name,
      p.portico_name,
      p.zone].

      filter(Boolean).
      join(" ").
      toLowerCase();
      return s.includes(q);
    });
  }, [dayPeople, q]);

  const filteredVehicles = useMemo(() => {
    if (!q) return dayVehicles;
    return dayVehicles.filter((v) => {
      const s = [v.patente, v.type, v.company_name, v.portico_name, v.zone].
      filter(Boolean).
      join(" ").
      toLowerCase();
      return s.includes(q);
    });
  }, [dayVehicles, q]);

  const selectedPorticoLabel = useMemo(() => {
    if (!selectedPortico) return "";
    const found = porticos.find((p) => String(p.id) === String(selectedPortico));
    return found?.name || "";
  }, [porticos, selectedPortico]);

  const heroStats = [
  {
    label: "Pórticos monitoreados",
    value: porticos.length,
    meta: selectedPortico ? "Vista filtrada" : "Vista global",
    tone: "blue",
    icon: <BsDoorOpenFill />
  },
  {
    label: "Personas actuales",
    value: loading ? "..." : filteredPeople.length,
    meta: selectedPortico ? "Interior del pórtico activo" : "Interior total",
    tone: "green",
    icon: <FaUser />
  },
  {
    label: "Vehículos actuales",
    value: loading ? "..." : filteredVehicles.length,
    meta: selectedPortico ? "Flujo visible en el pórtico" : "Flota actual",
    tone: "amber",
    icon: <FaCar />
  },
  {
    label: "Resumen operativo",
    value: backendDown ? "Offline" : "Live",
    meta: backendDown ? "Esperando backend" : "Polling cada 5 segundos",
    tone: backendDown ? "red" : "indigo",
    icon: <BsBroadcastPin />
  }];


  const metricItems = [
  { label: "Filtro activo", value: selectedPorticoLabel || "Todos", meta: "Pórtico visible" },
  { label: "Personas visibles", value: loading ? "..." : filteredPeople.length, meta: "Lectura actual" },
  { label: "Vehículos visibles", value: loading ? "..." : filteredVehicles.length, meta: "Lectura actual" },
  { label: "Búsqueda", value: q ? "Activa" : "Libre", meta: q || "Sin filtro textual" }];


  return (
    <PageShell
      eyebrow="Acceso inteligente"
      title="Control de accesos"
      description="Una vista más limpia y operacional para revisar interior actual, resumen de pórticos y configuración del sistema tag sin perder trazabilidad."
      actions={
      <StatusBadge tone={backendDown ? "red" : "green"}>
          {backendDown ? "Backend no disponible" : "Streaming operativo"}
        </StatusBadge>
      }
      stats={heroStats}>
      
      <SectionCard
        title="Sistema Tag"
        subtitle="Conmuta entre el resumen de lecturas por pórtico y la configuración base del pórtico seleccionado."
        actions={
        <SegmentedTabs
          value={upperTab}
          onChange={setUpperTab}
          items={[
          { value: "resumen", label: "Resumen" },
          { value: "porticos", label: "Pórticos" }]
          } />

        }>
        
        {upperTab === "resumen" ?
        <UpperSummaryTable
          rows={porticoSummary}
          backendDown={backendDown}
          formatDate={formatDate} /> :


        <UpperPorticosTable rows={porticoConfig} backendDown={backendDown} />
        }
      </SectionCard>

      <SectionCard
        title="Interior actual"
        subtitle={
        selectedPortico ?
        `Mostrando interior actual del pórtico ${selectedPorticoLabel || selectedPortico}.` :
        "Mostrando ubicación actual de personas y vehículos en todos los pórticos."
        }>
        
        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="rounded-[24px] border border-slate-200 bg-slate-50/90 p-4">
              <FieldShell label="Pórtico">
                <select
                  className="tm-control"
                  value={selectedPortico}
                  onChange={(e) => setSelectedPortico(e.target.value)}>
                  
                  <option value="">Todos los pórticos</option>
                  {porticos.map((p) =>
                  <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  )}
                </select>
              </FieldShell>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-slate-50/90 p-4">
              <FieldShell
                label="Búsqueda contextual"
                hint="RUT, nombre, patente, empresa, zona o pórtico.">
                
                <input
                  className="tm-control"
                  placeholder="Buscar personas o vehículos..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)} />
                
              </FieldShell>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {metricItems.map((item) =>
              <div
                key={item.label}
                className="min-h-[98px] rounded-[18px] border border-white/80 bg-white/95 px-3 py-2.5 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
                
                  <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
                    {item.label}
                  </div>
                  <div className="mt-1.5 break-words text-[1.05rem] font-semibold leading-tight tracking-tight text-slate-900 sm:text-[1.15rem]">
                    {item.value}
                  </div>
                  <div className="mt-1 text-[11px] leading-snug text-slate-500">{item.meta}</div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="text-sm text-slate-500">
                Cambia entre la vista de personas y vehículos sin perder el filtro activo.
              </div>
              <SegmentedTabs
                value={lowerTab}
                onChange={setLowerTab}
                items={[
                { value: "personas", label: "Personas" },
                { value: "vehiculos", label: "Vehículos" }]
                } />
              
            </div>

            {lowerTab === "personas" ?
            <DayPeopleTable
              rows={filteredPeople}
              backendDown={backendDown}
              formatDate={formatDate} /> :


            <DayVehiclesTable
              rows={filteredVehicles}
              backendDown={backendDown}
              formatDate={formatDate} />

            }
          </div>
        </div>
      </SectionCard>
    </PageShell>);

}

function TableWrap({ children }) {
  return <div className="overflow-auto rounded-[22px] border border-slate-200/90">{children}</div>;
}

function EmptyRows({ title, description }) {
  return (
    <div className="p-4">
      <EmptyState title={title} description={description} />
    </div>);

}

function UpperSummaryTable({ rows, backendDown, formatDate }) {
  if (backendDown) {
    return (
      <EmptyRows
        title="Backend caido"
        description="La grilla de resumen queda en espera hasta que el servicio vuelva a responder." />);


  }

  if (!rows.length) {
    return (
      <EmptyRows
        title="Sin lecturas disponibles"
        description="Todavía no hay actividad para el rango del día actual." />);


  }

  return (
    <div className="space-y-4">
      <TableWrap>
        <table className="tm-data-table">
          <thead>
            <tr>
              <th>Pórtico</th>
              <th>Site</th>
              <th>Nivel</th>
              <th>Zona</th>
              <th>Lecturas</th>
              <th>IN</th>
              <th>OUT</th>
              <th>Total</th>
              <th>Último evento</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) =>
            <tr key={r.id}>
                <td>
                  <div className="font-semibold text-slate-900">{r.name}</div>
                </td>
                <td>{r.site}</td>
                <td>{r.nivel}</td>
                <td>{r.zone}</td>
                <td>{r.total_events ?? 0}</td>
                <td>{r.total_in ?? 0}</td>
                <td>{r.total_out ?? 0}</td>
                <td>{Number(r.total_in ?? 0) - Number(r.total_out ?? 0)}</td>
                <td>{r.last_event_at ? formatDate(r.last_event_at) : "-"}</td>
              </tr>
            )}
          </tbody>
        </table>
      </TableWrap>

      <div className="grid gap-3 md:grid-cols-3">
        <LegendCard
          title="Lecturas"
          text="Total de eventos registrados por pórtico, incluso si una entidad reporta varias veces." />
        
        <LegendCard
          title="IN / OUT / Total"
          text="Total representa la diferencia entre entradas y salidas registradas en el periodo visible." />
        
        <LegendCard
          title="Interior actual"
          text="Los totales inferiores representan Última ubicación válida, no solo histórico diario." />
        
      </div>
    </div>);

}

function UpperPorticosTable({ rows, backendDown }) {
  if (backendDown) {
    return (
      <EmptyRows
        title="Backend caido"
        description="La configuración de pórticos se mostrará en cuanto el servicio retome conexión." />);


  }

  if (!rows.length) {
    return (
      <EmptyRows
        title="Selecciona un pórtico"
        description="La configuración detallada aparece al elegir un pórtico específico." />);


  }

  return (
    <TableWrap>
      <table className="tm-data-table">
        <thead>
          <tr>
            <th>Pórtico</th>
            <th>Site</th>
            <th>Nivel</th>
            <th>Zona</th>
            <th>Tipo</th>
            <th>agentes ambientales</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) =>
          <tr key={r.id}>
              <td className="font-semibold">{r.name}</td>
              <td>{r.site}</td>
              <td>{r.nivel}</td>
              <td>{r.zone}</td>
              <td>{r.portico_type_name}</td>
              <td>
                <StatusBadge tone={r.has_climate ? "amber" : "neutral"}>
                  {r.has_climate ? "Si" : "No"}
                </StatusBadge>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </TableWrap>);

}

function DayPeopleTable({ rows, backendDown, formatDate }) {
  if (backendDown) {
    return (
      <EmptyRows
        title="Sin conexión con el backend"
        description="La vista de interior actual para personas quedo temporalmente en pausa." />);


  }

  if (!rows.length) {
    return (
      <EmptyRows
        title="No se encontraron personas"
        description="Prueba otro pórtico o elimina el filtro de búsqueda para ampliar la vista." />);


  }

  return (
    <TableWrap>
      <table className="tm-data-table">
        <thead>
          <tr>
            <th>RUT</th>
            <th>Nombre</th>
            <th>Cargo</th>
            <th>Empresa</th>
            <th>Pórtico actual</th>
            <th>Zona</th>
            <th>Última lectura</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) =>
          <tr key={`${p.id}-${p.last_seen_at || ""}`}>
              <td>{p.rut || "-"}</td>
              <td className="font-semibold">{p.full_name || "-"}</td>
              <td>{p.position || "-"}</td>
              <td>{p.company_name || "-"}</td>
              <td>
                <div className="font-medium text-slate-800">{p.portico_name || "-"}</div>
              </td>
              <td>{p.zone || "-"}</td>
              <td>{p.last_seen_at ? formatDate(p.last_seen_at) : "-"}</td>
            </tr>
          )}
        </tbody>
      </table>
    </TableWrap>);

}

function DayVehiclesTable({ rows, backendDown, formatDate }) {
  if (backendDown) {
    return (
      <EmptyRows
        title="Sin conexión con el backend"
        description="La vista de interior actual para vehículos quedó temporalmente en pausa." />);


  }

  if (!rows.length) {
    return (
      <EmptyRows
        title="No se encontraron vehículos"
        description="Prueba otro pórtico o elimina el filtro de búsqueda para ampliar la vista." />);


  }

  return (
    <TableWrap>
      <table className="tm-data-table">
        <thead>
          <tr>
            <th>Patente</th>
            <th>Tipo</th>
            <th>Empresa</th>
            <th>Pórtico actual</th>
            <th>Zona</th>
            <th>Última lectura</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) =>
          <tr key={`${v.id}-${v.last_seen_at || ""}`}>
              <td className="font-semibold">{v.patente || "-"}</td>
              <td>{v.type || "-"}</td>
              <td>{v.company_name || "-"}</td>
              <td>
                <div className="font-medium text-slate-800">{v.portico_name || "-"}</div>
              </td>
              <td>{v.zone || "-"}</td>
              <td>{v.last_seen_at ? formatDate(v.last_seen_at) : "-"}</td>
            </tr>
          )}
        </tbody>
      </table>
    </TableWrap>);

}

function LegendCard({ title, text }) {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-slate-50/85 px-4 py-4">
      <div className="text-sm font-semibold text-slate-800">{title}</div>
      <div className="mt-2 text-sm leading-6 text-slate-500">{text}</div>
    </div>);

}
