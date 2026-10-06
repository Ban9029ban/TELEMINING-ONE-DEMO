import React, { useEffect, useMemo, useState } from "react";
import { FaCarSide, FaCloudSunRain, FaTools, FaUser } from "react-icons/fa";

import { EmptyState, SegmentedTabs, StatusBadge, joinClasses } from "./SystemTheme";

const climateLevelClass = (level) => {
  switch ((level || "").toLowerCase()) {
    case "green":
      return "bg-emerald-500";
    case "yellow":
      return "bg-amber-400";
    case "red":
      return "bg-rose-500";
    default:
      return "bg-slate-300";
  }
};

const AMBIENT_SENSOR_ORDER = {
  CO2: 0,
  CO: 1,
  H2S: 2,
  CH4: 3,
  TEMP: 4,
  WIND: 5,
  HUM: 9,
};

const formatDateTime = (dateString) => {
  if (!dateString) return "N/A";
  try {
    const date = new Date(dateString);
    return date.toLocaleString("es-CL", {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone: "America/Santiago",
    });
  } catch (_error) {
    return "N/A";
  }
};

const normalizeRows = (rowsRaw = []) =>
  rowsRaw.map((row) => {
    const name =
      row.name ||
      row.full_name ||
      row.display_name ||
      row.patente ||
      row.vehicle_patente ||
      "";

    const client =
      row.client ||
      row.company_name ||
      row.equipment_company_name ||
      row.person_company_name ||
      row.vehicle_company_name ||
      "";

    const lastUpdated =
      row.last_updated || row.last_seen_at || row.last_event_at || row.ts_last || null;

    const entityId =
      row.entity_id ?? row.entityId ?? row.id ?? row.equipment_id ?? null;

    return {
      name,
      client,
      lastUpdated,
      entityId,
      raw: row,
    };
  });

const getUrName = (deviceDetails) => {
  if (!deviceDetails || Array.isArray(deviceDetails)) return "esta ubicación";
  return deviceDetails.ur_name || "esta ubicación";
};

const matchesSearch = (values, search) => {
  if (!search) return true;
  return values
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(search);
};

const isRecentActiveReading = (value) => {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp <= 2 * 60 * 60 * 1000;
};

function MetricChip({ label, value, tone = "blue", icon }) {
  const toneClasses = {
    blue: "bg-sky-500/10 text-sky-700 ring-sky-500/15",
    green: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/15",
    amber: "bg-amber-500/12 text-amber-700 ring-amber-500/15",
    rose: "bg-rose-500/12 text-rose-700 ring-rose-500/15",
  };

  return (
    <div className="rounded-[20px] border border-white/70 bg-white/90 px-3.5 py-3.5 shadow-[0_14px_28px_rgba(15,23,42,0.06)] sm:rounded-[22px] sm:px-4 sm:py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            {label}
          </div>
          <div className="mt-2 text-[1.55rem] font-semibold tracking-tight text-slate-900 sm:text-2xl">
            {value}
          </div>
        </div>
        <div
          className={joinClasses(
            "flex h-11 w-11 items-center justify-center rounded-2xl ring-1",
            toneClasses[tone] || toneClasses.blue
          )}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

function TableWrapper({ children }) {
  return (
    <div className="overflow-hidden rounded-[22px] border border-slate-200/80 bg-white/92">
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

function TableSearchInput({ value, onChange, placeholder }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[13px] text-slate-700 outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-100"
    />
  );
}

function EntityRowsTable({
  title,
  icon,
  tone = "green",
  rows,
  nameHeader,
  emptyLabel,
  highlightEquipmentEntityId,
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredRows = useMemo(
    () =>
      rows.filter((row) =>
        matchesSearch(
          [row.name, row.client, formatDateTime(row.lastUpdated)],
          normalizedSearch
        )
      ),
    [normalizedSearch, rows]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div
          className={joinClasses(
            "flex h-10 w-10 items-center justify-center rounded-2xl ring-1",
            tone === "green"
              ? "bg-emerald-500/10 text-emerald-700 ring-emerald-500/15"
              : tone === "blue"
              ? "bg-sky-500/10 text-sky-700 ring-sky-500/15"
              : "bg-amber-500/12 text-amber-700 ring-amber-500/15"
          )}
        >
          {icon}
        </div>
        <div>
          <h4 className="text-base font-semibold tracking-tight text-slate-900">{title}</h4>
          <p className="text-sm text-slate-500">
            Vista operativa en tiempo real de la ubicación seleccionada.
          </p>
        </div>
      </div>

      <TableSearchInput
        value={searchTerm}
        onChange={setSearchTerm}
        placeholder={`Buscar en ${emptyLabel}...`}
      />

      {filteredRows.length === 0 ? (
        <EmptyState
          title={`Sin ${emptyLabel} visibles`}
          description={
            normalizedSearch
              ? "No hay coincidencias para el texto ingresado."
              : "No hay registros activos para este filtro en la ubicación actual."
          }
        />
      ) : (
        <TableWrapper>
          <table className="tm-data-table min-w-full">
            <thead>
              <tr className="text-left">
                <th>{nameHeader}</th>
                <th>Empresa</th>
                <th>Última lectura</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, index) => {
                const isAlerted =
                  highlightEquipmentEntityId != null &&
                  row.entityId != null &&
                  String(row.entityId) === String(highlightEquipmentEntityId);

                return (
                  <tr
                    key={`${row.name || "row"}-${row.entityId ?? index}`}
                    className={joinClasses(
                      isAlerted && "bg-rose-50/90 shadow-[inset_3px_0_0_0_rgba(244,63,94,0.9)]"
                    )}
                  >
                    <td>
                      <div className="flex items-center gap-3">
                        <div
                          title={isRecentActiveReading(row.lastUpdated) ? "Lectura activa" : "Sin lectura activa reciente"}
                          className={joinClasses(
                            "h-2.5 w-2.5 rounded-full",
                            isRecentActiveReading(row.lastUpdated) ? "bg-emerald-500" : "bg-slate-300"
                          )}
                        />
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-800">{row.name || "-"}</span>
                          {isAlerted ? (
                            <StatusBadge tone="red" className="tracking-[0.14em]">
                              Alerta
                            </StatusBadge>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td>{row.client || "-"}</td>
                    <td>{formatDateTime(row.lastUpdated)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrapper>
      )}

      {highlightEquipmentEntityId != null && tone === "amber" ? (
        <p className="text-xs text-slate-500">
          La alerta de equipos marca en rojo el activo específico detectado en ese pórtico.
        </p>
      ) : null}
    </div>
  );
}

function ClimateTable({ rows, urName }) {
  const [searchTerm, setSearchTerm] = useState("");
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const prioritizedRows = useMemo(
    () =>
      [...rows].sort((left, right) => {
        const leftCode = String(left?.code || "").toUpperCase();
        const rightCode = String(right?.code || "").toUpperCase();
        const leftPriority = AMBIENT_SENSOR_ORDER[leftCode] ?? 50;
        const rightPriority = AMBIENT_SENSOR_ORDER[rightCode] ?? 50;
        if (leftPriority !== rightPriority) return leftPriority - rightPriority;
        return String(left?.name || leftCode).localeCompare(String(right?.name || rightCode), "es");
      }),
    [rows]
  );
  const filteredRows = useMemo(
    () =>
      prioritizedRows.filter((row) =>
        matchesSearch(
          [
            row.name,
            row.code,
            row.last_level,
            row.unit,
            row.last_value != null ? String(row.last_value) : "",
            row.last_ts ? formatDateTime(row.last_ts) : "",
          ],
          normalizedSearch
        )
      ),
    [normalizedSearch, prioritizedRows]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-700 ring-1 ring-rose-500/15">
          <FaCloudSunRain />
        </div>
        <div>
          <h4 className="text-base font-semibold tracking-tight text-slate-900">
            Agentes ambientales
          </h4>
          <p className="text-sm text-slate-500">
            Estado instantaneo de gases, temperatura, viento y otras variables ambientales en {urName}.
          </p>
        </div>
      </div>

      <TableSearchInput
        value={searchTerm}
        onChange={setSearchTerm}
        placeholder="Buscar en agentes ambientales..."
      />

      {filteredRows.length === 0 ? (
        <EmptyState
          title="Sin lecturas ambientales"
          description={
            normalizedSearch
              ? "No hay coincidencias para el filtro aplicado."
              : "Este portico no tiene sensores activos o todavia no reporta mediciones."
          }
        />
      ) : (
        <TableWrapper>
          <table className="tm-data-table min-w-full">
            <thead>
              <tr className="text-left">
                <th>Sensor</th>
                <th>Valor</th>
                <th>Estado</th>
                <th>Actualizado</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, index) => (
                <tr key={`${row.code || row.name || "sensor"}-${index}`}>
                  <td>{row.name || row.code || "Sensor"}</td>
                  <td>
                    {row.last_value != null
                      ? `${Number(row.last_value).toFixed(2)} ${row.unit || ""}`.trim()
                      : "-"}
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-2">
                      <span
                        className={joinClasses("h-2.5 w-2.5 rounded-full", climateLevelClass(row.last_level))}
                      />
                      <span className="capitalize">{row.last_level || "sin dato"}</span>
                    </span>
                  </td>
                  <td>{row.last_ts ? formatDateTime(row.last_ts) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrapper>
      )}
    </div>
  );
}

function DetailCard({ title, subtitle, badge, metrics, children }) {
  return (
    <section className="mt-5 overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.96)_100%)] shadow-[0_26px_50px_rgba(15,23,42,0.08)] sm:mt-6 sm:rounded-[30px]">
      <div className="border-b border-slate-200/80 px-4 py-4 sm:px-5 sm:py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            {badge}
            <div>
              <h3 className="text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">
                {title}
              </h3>
              {subtitle ? <p className="mt-1 text-[13px] text-slate-500 sm:text-sm">{subtitle}</p> : null}
            </div>
          </div>
        </div>

        {metrics?.length ? (
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <MetricChip key={metric.label} {...metric} />
            ))}
          </div>
        ) : null}
      </div>

      <div className="px-4 py-4 sm:px-5 sm:py-5">{children}</div>
    </section>
  );
}

function TabsDetails({ deviceDetails, highlightEquipmentEntityId }) {
  const peopleRows = useMemo(() => normalizeRows(deviceDetails.personas || deviceDetails.people || []), [deviceDetails]);
  const vehicleRows = useMemo(() => normalizeRows(deviceDetails.vehiculos || deviceDetails.vehicles || []), [deviceDetails]);
  const equipmentRows = useMemo(
    () => normalizeRows(deviceDetails.equipos || deviceDetails.equipments || deviceDetails.equips || []),
    [deviceDetails]
  );

  const hasClimate = Boolean(deviceDetails.has_climate);
  const climateRows = hasClimate ? deviceDetails.climate || deviceDetails.climate_raw || [] : [];
  const urName = getUrName(deviceDetails);
  const [activeTab, setActiveTab] = useState("people");

  useEffect(() => {
    if (peopleRows.length > 0) setActiveTab("people");
    else if (vehicleRows.length > 0) setActiveTab("vehicles");
    else if (equipmentRows.length > 0) setActiveTab("equipments");
    else if (hasClimate && climateRows.length > 0) setActiveTab("climate");
    else setActiveTab("people");
  }, [peopleRows.length, vehicleRows.length, equipmentRows.length, hasClimate, climateRows.length]);

  const tabItems = [
    {
      value: "people",
      label: `Personas (${peopleRows.length})`,
      icon: <FaUser className="text-sm" />,
    },
    {
      value: "vehicles",
      label: `Vehículos (${vehicleRows.length})`,
      icon: <FaCarSide className="text-sm" />,
    },
    {
      value: "equipments",
      label: `Equipos (${equipmentRows.length})`,
      icon: <FaTools className="text-sm" />,
    },
    ...(hasClimate
      ? [
          {
            value: "climate",
            label: `Agentes Ambientales (${climateRows.length})`,
            icon: <FaCloudSunRain className="text-sm" />,
          },
        ]
      : []),
  ];

  return (
    <DetailCard
      title={urName}
      subtitle="Panel operativo del portico seleccionado con lectura en vivo por tipo de activo."
      badge={<StatusBadge tone="indigo">Tracking operativo</StatusBadge>}
      metrics={[
        { label: "Personas", value: peopleRows.length, tone: "green", icon: <FaUser /> },
        { label: "Vehículos", value: vehicleRows.length, tone: "blue", icon: <FaCarSide /> },
        { label: "Equipos", value: equipmentRows.length, tone: "amber", icon: <FaTools /> },
        { label: "Sensores", value: climateRows.length, tone: "rose", icon: <FaCloudSunRain /> },
      ]}
    >
      <div className="space-y-5">
        <SegmentedTabs items={tabItems} value={activeTab} onChange={setActiveTab} />

        {activeTab === "people" ? (
          <EntityRowsTable
            title={`Personas en ${urName}`}
            icon={<FaUser />}
            tone="green"
            rows={peopleRows}
            nameHeader="Nombre"
            emptyLabel="personas"
          />
        ) : null}

        {activeTab === "vehicles" ? (
          <EntityRowsTable
            title={`Vehículos en ${urName}`}
            icon={<FaCarSide />}
            tone="blue"
            rows={vehicleRows}
            nameHeader="Vehículo / patente"
            emptyLabel="vehículos"
          />
        ) : null}

        {activeTab === "equipments" ? (
          <EntityRowsTable
            title={`Equipos en ${urName}`}
            icon={<FaTools />}
            tone="amber"
            rows={equipmentRows}
            nameHeader="Equipo"
            emptyLabel="equipos"
            highlightEquipmentEntityId={highlightEquipmentEntityId}
          />
        ) : null}

        {activeTab === "climate" && hasClimate ? <ClimateTable rows={climateRows} urName={urName} /> : null}
      </div>
    </DetailCard>
  );
}

function SimpleEntityCard({ deviceDetails, mode }) {
  const isPeople = mode === "people";
  const rowsSource = Array.isArray(deviceDetails)
    ? deviceDetails
    : isPeople
    ? deviceDetails.people || deviceDetails.personas || []
    : deviceDetails.vehicles || deviceDetails.vehiculos || [];

  const rows = normalizeRows(rowsSource);
  const urName = getUrName(deviceDetails);

  return (
    <DetailCard
      title={`${isPeople ? "Personas" : "Vehículos"} en ${urName}`}
      subtitle="Resultado detallado del buscador y la operación diaria en el punto consultado."
      badge={
        <StatusBadge tone={isPeople ? "green" : "blue"}>
          {isPeople ? "Vista de personas" : "Vista de vehículos"}
        </StatusBadge>
      }
      metrics={[
        {
          label: isPeople ? "Personas" : "Vehículos",
          value: rows.length,
          tone: isPeople ? "green" : "blue",
          icon: isPeople ? <FaUser /> : <FaCarSide />,
        },
      ]}
    >
      <EntityRowsTable
        title={`${isPeople ? "Personas" : "Vehículos"} en ${urName}`}
        icon={isPeople ? <FaUser /> : <FaCarSide />}
        tone={isPeople ? "green" : "blue"}
        rows={rows}
        nameHeader={isPeople ? "Nombre" : "Vehículo / patente"}
        emptyLabel={isPeople ? "personas" : "vehículos"}
      />
    </DetailCard>
  );
}

export default function DeviceDetails({ deviceDetails, detailType, highlightEquipmentEntityId }) {
  if (!deviceDetails) return null;

  if (detailType === "tabs") {
    return (
      <TabsDetails
        deviceDetails={deviceDetails}
        highlightEquipmentEntityId={highlightEquipmentEntityId}
      />
    );
  }

  if (detailType === "vehicles") {
    return <SimpleEntityCard deviceDetails={deviceDetails} mode="vehicles" />;
  }

  if (detailType === "people") {
    return <SimpleEntityCard deviceDetails={deviceDetails} mode="people" />;
  }

  return null;
}
