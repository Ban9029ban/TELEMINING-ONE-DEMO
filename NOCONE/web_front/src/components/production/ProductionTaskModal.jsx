import React, { useEffect, useMemo, useState } from "react";

import { ActionButton, StatusBadge, joinClasses } from "../SystemTheme";

const DARK_CONTROL_CLASS = joinClasses(
  "tm-control",
  "!border-slate-700/80 !bg-slate-800/90 !text-slate-100 !shadow-none placeholder:!text-slate-500"
);

function InputShell({ label, hint, children }) {
  return (
    <label className="block space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-300">
        {label}
      </div>
      {children}
      {hint ? <div className="text-xs text-slate-500">{hint}</div> : null}
    </label>
  );
}

function TextInput({ label, value, onChange, placeholder = "", type = "text" }) {
  return (
    <InputShell label={label}>
      <input
        type={type}
        className={DARK_CONTROL_CLASS}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </InputShell>
  );
}

function SelectInput({ label, value, onChange, options, placeholder = "Selecciona" }) {
  return (
    <InputShell label={label}>
      <select className={DARK_CONTROL_CLASS} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={`${label}-${option.value}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </InputShell>
  );
}

function MultiSelectInput({ label, values, onChange, options, hint }) {
  return (
    <div className="block">
      <InputShell label={label} hint={hint}>
        <div className="rounded-[22px] border border-slate-700/80 bg-slate-900/90 px-3 py-3">
          <div className="mb-3 flex flex-wrap gap-2">
            {(values || []).length ? (
              values.map((value) => {
                const option = options.find((item) => String(item.value) === String(value));
                return (
                  <span
                    key={`${label}-chip-${value}`}
                    className="inline-flex rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-200"
                  >
                    {option?.label || value}
                  </span>
                );
              })
            ) : (
              <span className="text-sm text-slate-500">Sin elementos seleccionados.</span>
            )}
          </div>

          <div className="grid max-h-[180px] gap-2 overflow-y-auto pr-1">
            {options.map((option) => {
              const checked = values.includes(String(option.value));
              return (
                <label
                  key={`${label}-${option.value}`}
                  className="flex items-center gap-3 rounded-[16px] border border-slate-700/80 bg-slate-800/75 px-3 py-2 text-sm text-slate-100"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...values, String(option.value)]
                        : values.filter((item) => String(item) !== String(option.value));
                      onChange(next);
                    }}
                    className="h-4 w-4 rounded border-slate-500 bg-slate-900 text-sky-500 focus:ring-sky-500"
                  />
                  <span>{option.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      </InputShell>
    </div>
  );
}

function ModalShell({ open, title, subtitle, children, onClose }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-8 backdrop-blur-sm">
      <div className="w-full max-w-5xl overflow-hidden rounded-[30px] border border-slate-700/60 bg-slate-900 shadow-[0_32px_80px_rgba(15,23,42,0.28)]">
        <div className="flex items-start justify-between gap-4 border-b border-slate-700/50 px-5 py-4">
          <div>
            <div className="text-lg font-semibold tracking-tight text-slate-100">{title}</div>
            {subtitle ? <div className="mt-1 text-sm text-slate-400">{subtitle}</div> : null}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
          >
            x
          </button>
        </div>

        <div className="max-h-[82vh] overflow-y-auto px-5 py-5 text-slate-100">{children}</div>
      </div>
    </div>
  );
}

function extractSelectedEntities(values, sourceMap) {
  return values
    .map((value) => sourceMap.get(String(value)))
    .filter(Boolean)
    .map((item) => ({
      id: item.id,
      name: item.name,
      label: item.label,
      type: item.type,
    }));
}

function buildTaskDraft(task, defaults, waypoints) {
  const selectedWaypoint = waypoints.find((item) => item.id === defaults.waypointId) || null;
  const posture = task?.postura || defaults.postura || selectedWaypoint?.postura || "";
  const level = task?.nivel || defaults.nivel || selectedWaypoint?.nivel || "";
  const mapCode = task?.mapCode || defaults.mapCode || selectedWaypoint?.mapCode || "NP_dia";

  return {
    id: task?.id || null,
    domain: task?.domain || defaults.domain || "mineria",
    date: String(task?.date || defaults.date || "").slice(0, 10),
    turno: task?.turno || defaults.turno || "B",
    nivel: level,
    postura: posture,
    mapCode,
    waypointId: task?.waypointId || defaults.waypointId || selectedWaypoint?.id || "",
    type: task?.type || defaults.type || "",
    activity: task?.activity || defaults.activity || "",
    priority: String(task?.priority ?? "1"),
    plannedStart: String(task?.plannedStart || defaults.plannedStart || "").slice(0, 16),
    plannedEnd: String(task?.plannedEnd || defaults.plannedEnd || "").slice(0, 16),
    realStart: String(task?.realStart || defaults.realStart || "").slice(0, 16),
    realEnd: String(task?.realEnd || defaults.realEnd || "").slice(0, 16),
    equipmentPlanned: task?.equipmentPlanned || defaults.equipmentPlanned || "",
    crewPlanned: task?.crewPlanned || defaults.crewPlanned || "",
    equipmentReal: task?.equipmentReal || defaults.equipmentReal || "",
    crewReal: task?.crewReal || defaults.crewReal || "",
    progress: String(task?.progress ?? "0"),
    cncExternalCategory: task?.cncExternalCategory || "",
    cncExternalSubcategory: task?.cncExternalSubcategory || "",
    cncExternalDetail: task?.cncExternalDetail || "",
    cncInternalCategory: task?.cncInternalCategory || "",
    cncInternalSubcategory: task?.cncInternalSubcategory || "",
    cncInternalDetail: task?.cncInternalDetail || "",
    observation: task?.observation || "",
    trackingPorticoId: task?.trackingPorticoId != null ? String(task.trackingPorticoId) : "",
    linkedPeopleIds: (task?.linkedPeople || []).map((item) => String(item.id)),
    linkedVehicleIds: (task?.linkedVehicles || []).map((item) => String(item.id)),
  };
}

export default function ProductionTaskModal({
  open,
  task,
  defaults,
  referenceData,
  masters,
  waypoints,
  onClose,
  onSave,
  onDelete,
}) {
  const [draft, setDraft] = useState(() => buildTaskDraft(task, defaults, waypoints));
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(buildTaskDraft(task, defaults, waypoints));
    setError("");
  }, [task, defaults, waypoints]);

  const crewOptions = referenceData?.lists?.Cuadrilla || [];
  const equipmentOptions = referenceData?.lists?.Equipos || [];
  const levelOptions = referenceData?.lists?.Niveles || [];
  const shiftOptions = referenceData?.lists?.Turnos || [];
  const typeOptions = useMemo(
    () =>
      (draft.domain === "mineria"
        ? referenceData?.lists?.Mineria || []
        : referenceData?.lists?.OOCC || []
      ).map((item) => ({
        value: item.code,
        label: `${item.code} - ${item.label}`,
      })),
    [draft.domain, referenceData]
  );

  const externalCategoryOptions = (referenceData?.cnc?.external || []).map((item) => ({
    value: item.category,
    label: item.category,
  }));
  const internalCategoryOptions = (referenceData?.cnc?.internal || []).map((item) => ({
    value: item.category,
    label: item.category,
  }));
  const externalSubcategoryOptions = (referenceData?.cnc?.external || [])
    .find((item) => item.category === draft.cncExternalCategory)
    ?.options?.map((item) => ({ value: item, label: item })) || [];
  const internalSubcategoryOptions = (referenceData?.cnc?.internal || [])
    .find((item) => item.category === draft.cncInternalCategory)
    ?.options?.map((item) => ({ value: item, label: item })) || [];

  const waypointOptions = waypoints.map((item) => ({
    value: item.id,
    label: `${item.nivel} - ${item.postura}`,
  }));
  const porticoOptions = masters.porticos.map((item) => ({
    value: String(item.id),
    label: `${item.name}${item.zone ? ` · ${item.zone}` : ""}`,
  }));
  const personOptions = masters.persons.map((item) => ({
    value: String(item.id),
    label: `${item.full_name}${item.company_name ? ` · ${item.company_name}` : ""}`,
  }));
  const vehicleOptions = masters.vehicles.map((item) => ({
    value: String(item.id),
    label: `${item.patente}${item.company_name ? ` · ${item.company_name}` : ""}`,
  }));

  const personMap = useMemo(
    () =>
      new Map(
        masters.persons.map((item) => [
          String(item.id),
          { id: item.id, name: item.full_name, label: item.full_name, type: "person" },
        ])
      ),
    [masters.persons]
  );
  const vehicleMap = useMemo(
    () =>
      new Map(
        masters.vehicles.map((item) => [
          String(item.id),
          { id: item.id, name: item.patente, label: item.patente, type: "vehicle" },
        ])
      ),
    [masters.vehicles]
  );

  const updateDraft = (key, value) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleWaypointChange = (value) => {
    const selectedWaypoint = waypoints.find((item) => item.id === value);
    setDraft((current) => ({
      ...current,
      waypointId: value,
      postura: selectedWaypoint?.postura || current.postura,
      nivel: selectedWaypoint?.nivel || current.nivel,
      mapCode: selectedWaypoint?.mapCode || current.mapCode,
    }));
  };

  const handleDelete = () => {
    if (!task?.id || !onDelete) return;
    if (window.confirm("¿Eliminar esta tarea de producción? Esta acción no se puede deshacer.")) {
      onDelete(task);
    }
  };

  const handleSubmit = () => {
    if (!draft.date || !draft.postura || !draft.activity) {
      setError("Completa fecha, postura y actividad para guardar la tarea.");
      return;
    }

    const payload = {
      ...task,
      id: draft.id,
      domain: draft.domain,
      date: draft.date,
      turno: draft.turno,
      nivel: draft.nivel,
      postura: draft.postura,
      mapCode: draft.mapCode,
      waypointId: draft.waypointId || `wp-${draft.nivel}-${draft.postura}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      type: draft.type,
      activity: draft.activity,
      priority: Number(draft.priority || 1),
      plannedStart: draft.plannedStart ? `${draft.plannedStart}:00` : null,
      plannedEnd: draft.plannedEnd ? `${draft.plannedEnd}:00` : null,
      realStart: draft.realStart ? `${draft.realStart}:00` : null,
      realEnd: draft.realEnd ? `${draft.realEnd}:00` : null,
      equipmentPlanned: draft.equipmentPlanned || null,
      crewPlanned: draft.crewPlanned || null,
      equipmentReal: draft.equipmentReal || null,
      crewReal: draft.crewReal || null,
      progress: Number(draft.progress || 0),
      cncExternalCategory: draft.cncExternalCategory || null,
      cncExternalSubcategory: draft.cncExternalSubcategory || null,
      cncExternalDetail: draft.cncExternalDetail || null,
      cncInternalCategory: draft.cncInternalCategory || null,
      cncInternalSubcategory: draft.cncInternalSubcategory || null,
      cncInternalDetail: draft.cncInternalDetail || null,
      observation: draft.observation || null,
      trackingPorticoId: draft.trackingPorticoId ? Number(draft.trackingPorticoId) : null,
      trackingPorticoName:
        masters.porticos.find((item) => String(item.id) === String(draft.trackingPorticoId))?.name || "",
      linkedPeople: extractSelectedEntities(draft.linkedPeopleIds, personMap),
      linkedVehicles: extractSelectedEntities(draft.linkedVehicleIds, vehicleMap),
    };

    onSave(payload);
  };

  return (
    <ModalShell
      open={open}
      title={task?.id ? `Editar tarea ${task.id}` : "Nueva tarea de producción"}
      subtitle="Actualiza la planificación, vincula personas y vehículos, y deja lista la validación con Tracking."
      onClose={onClose}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="indigo">{draft.domain === "mineria" ? "Minería" : "OO.CC"}</StatusBadge>
          <StatusBadge tone="blue">{draft.nivel || "Sin nivel"}</StatusBadge>
          <StatusBadge tone="green">{draft.postura || "Sin postura"}</StatusBadge>
        </div>

        {error ? (
          <div className="rounded-[18px] border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SelectInput
            label="Dominio"
            value={draft.domain}
            onChange={(value) => updateDraft("domain", value)}
            options={[
              { value: "mineria", label: "Minería" },
              { value: "oocc", label: "OO.CC" },
            ]}
          />
          <TextInput label="Fecha" type="date" value={draft.date} onChange={(value) => updateDraft("date", value)} />
          <SelectInput
            label="Turno"
            value={draft.turno}
            onChange={(value) => updateDraft("turno", value)}
            options={shiftOptions.map((item) => ({ value: item.code, label: item.label }))}
          />
          <SelectInput
            label="Waypoint / postura"
            value={draft.waypointId}
            onChange={handleWaypointChange}
            options={waypointOptions}
            placeholder="Selecciona postura"
          />
          <SelectInput
            label="Nivel"
            value={draft.nivel}
            onChange={(value) => updateDraft("nivel", value)}
            options={levelOptions.map((item) => ({ value: item.code, label: item.label }))}
          />
          <TextInput
            label="Postura"
            value={draft.postura}
            onChange={(value) => updateDraft("postura", value)}
            placeholder="Ej: Z14 C9/10"
          />
          <SelectInput
            label="Tipo"
            value={draft.type}
            onChange={(value) => updateDraft("type", value)}
            options={typeOptions}
            placeholder="Selecciona tipo"
          />
          <TextInput
            label="Actividad"
            value={draft.activity}
            onChange={(value) => updateDraft("activity", value)}
            placeholder="Ej: SH / FE / TOP"
          />
          <TextInput
            label="Prioridad"
            type="number"
            value={draft.priority}
            onChange={(value) => updateDraft("priority", value)}
          />
          <TextInput
            label="Avance"
            type="number"
            value={draft.progress}
            onChange={(value) => updateDraft("progress", value)}
            placeholder="0 - 1"
          />
          <TextInput
            label="Inicio plan"
            type="datetime-local"
            value={draft.plannedStart}
            onChange={(value) => updateDraft("plannedStart", value)}
          />
          <TextInput
            label="Término plan"
            type="datetime-local"
            value={draft.plannedEnd}
            onChange={(value) => updateDraft("plannedEnd", value)}
          />
          <TextInput
            label="Inicio real"
            type="datetime-local"
            value={draft.realStart}
            onChange={(value) => updateDraft("realStart", value)}
          />
          <TextInput
            label="Término real"
            type="datetime-local"
            value={draft.realEnd}
            onChange={(value) => updateDraft("realEnd", value)}
          />
          <SelectInput
            label="Equipo plan"
            value={draft.equipmentPlanned}
            onChange={(value) => updateDraft("equipmentPlanned", value)}
            options={equipmentOptions.map((item) => ({ value: item.code, label: `${item.code} - ${item.label}` }))}
            placeholder="Selecciona equipo"
          />
          <SelectInput
            label="Cuadrilla plan"
            value={draft.crewPlanned}
            onChange={(value) => updateDraft("crewPlanned", value)}
            options={crewOptions.map((item) => ({ value: item.code, label: item.label }))}
            placeholder="Selecciona cuadrilla"
          />
          <SelectInput
            label="Equipo real"
            value={draft.equipmentReal}
            onChange={(value) => updateDraft("equipmentReal", value)}
            options={equipmentOptions.map((item) => ({ value: item.code, label: `${item.code} - ${item.label}` }))}
            placeholder="Selecciona equipo"
          />
          <SelectInput
            label="Cuadrilla real"
            value={draft.crewReal}
            onChange={(value) => updateDraft("crewReal", value)}
            options={crewOptions.map((item) => ({ value: item.code, label: item.label }))}
            placeholder="Selecciona cuadrilla"
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-[24px] border border-slate-700/80 bg-slate-950/55 px-4 py-4">
            <div className="mb-4 text-sm font-semibold text-slate-100">CNC</div>
            <div className="grid gap-3 md:grid-cols-2">
              <SelectInput
                label="Categoría CNC externa"
                value={draft.cncExternalCategory}
                onChange={(value) => {
                  updateDraft("cncExternalCategory", value);
                  updateDraft("cncExternalSubcategory", "");
                }}
                options={externalCategoryOptions}
              />
              <SelectInput
                label="Subcategoría CNC externa"
                value={draft.cncExternalSubcategory}
                onChange={(value) => updateDraft("cncExternalSubcategory", value)}
                options={externalSubcategoryOptions}
              />
              <SelectInput
                label="Categoría CNC interna"
                value={draft.cncInternalCategory}
                onChange={(value) => {
                  updateDraft("cncInternalCategory", value);
                  updateDraft("cncInternalSubcategory", "");
                }}
                options={internalCategoryOptions}
              />
              <SelectInput
                label="Subcategoría CNC interna"
                value={draft.cncInternalSubcategory}
                onChange={(value) => updateDraft("cncInternalSubcategory", value)}
                options={internalSubcategoryOptions}
              />
              <div className="md:col-span-2">
                <TextInput
                  label="Detalle CNC externa"
                  value={draft.cncExternalDetail}
                  onChange={(value) => updateDraft("cncExternalDetail", value)}
                  placeholder="Detalle o causa externa"
                />
              </div>
              <div className="md:col-span-2">
                <TextInput
                  label="Detalle CNC interna"
                  value={draft.cncInternalDetail}
                  onChange={(value) => updateDraft("cncInternalDetail", value)}
                  placeholder="Detalle o causa interna"
                />
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-700/80 bg-slate-950/55 px-4 py-4">
            <div className="mb-4 text-sm font-semibold text-slate-100">Cruce con Tracking</div>
            <div className="grid gap-3">
              <SelectInput
                label="Pórtico de validación"
                value={draft.trackingPorticoId}
                onChange={(value) => updateDraft("trackingPorticoId", value)}
                options={porticoOptions}
                placeholder="Selecciona pórtico"
              />
              <MultiSelectInput
                label="Personas vinculadas"
                values={draft.linkedPeopleIds}
                onChange={(value) => updateDraft("linkedPeopleIds", value)}
                options={personOptions}
                hint="Se validan contra el historial de Tracking del día."
              />
              <MultiSelectInput
                label="Vehículos vinculados"
                values={draft.linkedVehicleIds}
                onChange={(value) => updateDraft("linkedVehicleIds", value)}
                options={vehicleOptions}
                hint="Puedes vincular uno o varios vehículos para contrastar tiempos de permanencia."
              />
            </div>
          </div>
        </div>

        <InputShell label="Observación">
          <textarea
            className={joinClasses(DARK_CONTROL_CLASS, "min-h-[120px] py-3")}
            rows={4}
            value={draft.observation}
            onChange={(event) => updateDraft("observation", event.target.value)}
            placeholder="Observaciones operativas, comentarios del plan o notas de control."
          />
        </InputShell>

        <div className="flex flex-wrap justify-between gap-2">
          {task?.id ? (
            <ActionButton
              variant="secondary"
              className="!bg-rose-600 !text-white hover:!bg-rose-700"
              onClick={handleDelete}
            >
              Eliminar
            </ActionButton>
          ) : (
            <div />
          )}

          <div className="flex flex-wrap gap-2">
            <ActionButton variant="secondary" onClick={onClose}>
              Cancelar
            </ActionButton>
            <ActionButton onClick={handleSubmit}>
              {task?.id ? "Guardar cambios" : "Crear tarea"}
            </ActionButton>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
