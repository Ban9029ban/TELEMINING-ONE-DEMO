import React, { useState } from "react";
import { FaFileExcel, FaFilePdf } from "react-icons/fa";

import {
  ActionButton,
  EmptyState,
  SectionCard,
  StatusBadge,
  joinClasses,
} from "../SystemTheme";

const LINE_DEFINITIONS = [
  {
    key: "program",
    label: "Programa",
    chipClass: "border-sky-400 bg-sky-500 text-white shadow-[0_10px_20px_rgba(37,99,235,0.18)]",
  },
  {
    key: "resourcePlan",
    label: "Recurso Prog",
    chipClass: "border-sky-100 bg-sky-50 text-slate-800",
  },
  {
    key: "real",
    label: "Real",
    chipClass: "border-slate-800 bg-slate-900 text-white shadow-[0_10px_20px_rgba(15,23,42,0.18)]",
  },
  {
    key: "resourceReal",
    label: "Recurso Real",
    chipClass: "border-slate-200 bg-slate-100 text-slate-700",
  },
];

export default function WorkbookGanttBoard({
  title,
  subtitle,
  rows,
  slotLabels,
  completionLabel,
  operationDateLabel,
  turno,
  mapLabel,
  onEditTask,
  onQuickCreateTask,
  onInlineRowUpdate,
  onExportPdf,
  onExportExcel,
  canManageTasks = true,
  onBlockedTaskAction,
}) {
  const [inlineEdit, setInlineEdit] = useState(null);

  const inlineMatches = (row, field) =>
    inlineEdit && inlineEdit.rowId === row.waypointId && inlineEdit.field === field;

  const commitInlineEdit = async (row) => {
    if (!inlineEdit || inlineEdit.rowId !== row.waypointId) return;
    if (!canManageTasks) {
      onBlockedTaskAction?.("Producción / Gestión de tareas");
      setInlineEdit(null);
      return;
    }
    const nextValue = String(inlineEdit.value || "").trim();
    await onInlineRowUpdate(row, inlineEdit.field, nextValue);
    setInlineEdit(null);
  };
  const handleTaskAction = (callback, resourceLabel = "Producción / Gestión de tareas") => {
    if (!canManageTasks) {
      onBlockedTaskAction?.(resourceLabel);
      return;
    }
    callback();
  };

  return (
    <SectionCard
      title={title}
      subtitle={subtitle}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="indigo">{operationDateLabel}</StatusBadge>
          <StatusBadge tone="blue">{mapLabel || "Mapa"}</StatusBadge>
          <StatusBadge tone="amber">Turno {turno || "-"}</StatusBadge>
          <StatusBadge tone="green">Cumplimiento {completionLabel}</StatusBadge>
          <ActionButton variant="secondary" className="!px-3 !py-1.5" onClick={onExportPdf}>
            <FaFilePdf />
            PDF
          </ActionButton>
          <ActionButton variant="secondary" className="!px-3 !py-1.5" onClick={onExportExcel}>
            <FaFileExcel />
            Excel
          </ActionButton>
        </div>
      }
      bodyClassName="space-y-4"
    >
      {rows.length === 0 ? (
        <EmptyState
          title="Sin filas para este filtro"
          description="Ajusta fecha, turno, nivel o mapa para ver el control horario."
        />
      ) : (
        <div className="overflow-hidden rounded-[26px] border border-slate-700 bg-slate-950 shadow-[0_22px_48px_rgba(15,23,42,0.18)]">
          <div className="border-b border-slate-800 bg-[linear-gradient(135deg,#0f172a_0%,#172554_100%)] px-4 py-3 text-white">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold tracking-tight">Vista tipo libro operacional</div>
                <div className="mt-1 text-xs text-slate-300">
                  Misma lógica de programa, recurso programado, real y recurso real, con paleta azul y negro del sistema.
                </div>
              </div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-200">
                {rows.length} posturas visibles
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[1880px] w-full border-collapse text-[11px] text-slate-900">
              <thead>
                <tr className="bg-slate-900 text-sky-100">
                  <th className="border border-slate-700 px-2 py-2 text-center">#</th>
                  <th className="border border-slate-700 px-2 py-2 text-center">Nivel</th>
                  <th className="border border-slate-700 px-2 py-2 text-center">Postura</th>
                  <th className="border border-slate-700 px-2 py-2 text-center">Plan</th>
                  <th className="border border-slate-700 px-2 py-2 text-center">Observaciones</th>
                  {slotLabels.map((slot) => (
                    <th key={`slot-${slot}`} className="border border-slate-700 px-2 py-2 text-center">
                      {slot}
                    </th>
                  ))}
                  <th className="border border-slate-700 px-2 py-2 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {rows.map((row, rowIndex) =>
                  LINE_DEFINITIONS.map((line, lineIndex) => {
                    const slotMap = new Map(row.slots.map((slot) => [slot.slot, slot]));
                    const notes = row.observations || "";

                    return (
                      <tr
                        key={`${row.waypointId}-${line.key}`}
                        className={lineIndex % 2 === 0 ? "bg-white" : "bg-slate-50"}
                      >
                        {lineIndex === 0 ? (
                          <>
                            <td
                              rowSpan={LINE_DEFINITIONS.length}
                              className="border border-slate-200 px-2 py-2 text-center font-semibold align-top"
                            >
                              {rowIndex + 1}
                            </td>
                            <td
                              rowSpan={LINE_DEFINITIONS.length}
                              className="border border-slate-200 px-2 py-2 text-center font-semibold align-top"
                            >
                              {row.nivel}
                            </td>
                            <td
                              rowSpan={LINE_DEFINITIONS.length}
                              className="border border-slate-200 bg-[linear-gradient(135deg,#1d4ed8_0%,#2563eb_65%,#38bdf8_100%)] px-3 py-2 align-top text-white"
                            >
                              {inlineMatches(row, "postura") ? (
                                <input
                                  autoFocus
                                  className="w-full rounded-lg border border-white/60 bg-white/20 px-2 py-1 text-sm font-semibold text-white outline-none placeholder:text-white/70"
                                  value={inlineEdit.value}
                                  onChange={(event) =>
                                    setInlineEdit((current) => ({ ...current, value: event.target.value }))
                                  }
                                  onBlur={() => commitInlineEdit(row)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault();
                                      commitInlineEdit(row);
                                    }
                                    if (event.key === "Escape") {
                                      setInlineEdit(null);
                                    }
                                  }}
                                />
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleTaskAction(() =>
                                      setInlineEdit({
                                        rowId: row.waypointId,
                                        field: "postura",
                                        value: row.postura,
                                      })
                                    )
                                  }
                                  className="w-full rounded-lg px-1 py-1 text-left font-semibold transition hover:bg-white/10"
                                >
                                  {row.postura}
                                </button>
                              )}
                            </td>
                          </>
                        ) : null}

                        <td className="border border-slate-200 px-2 py-2 text-center font-semibold text-slate-700">
                          {line.label}
                        </td>

                        {lineIndex === 0 ? (
                          <td
                            rowSpan={LINE_DEFINITIONS.length}
                            className="border border-slate-200 px-3 py-2 align-top"
                          >
                            {inlineMatches(row, "notes") ? (
                              <textarea
                                autoFocus
                                rows={5}
                                className="w-full rounded-lg border border-sky-200 bg-sky-50 px-2 py-2 text-sm text-slate-900 outline-none"
                                value={inlineEdit.value}
                                onChange={(event) =>
                                  setInlineEdit((current) => ({ ...current, value: event.target.value }))
                                }
                                onBlur={() => commitInlineEdit(row)}
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  handleTaskAction(() =>
                                    setInlineEdit({
                                      rowId: row.waypointId,
                                      field: "notes",
                                      value: notes,
                                    })
                                  )
                                }
                                className="min-h-[76px] w-full rounded-lg px-2 py-1 text-left whitespace-pre-line text-slate-600 transition hover:bg-sky-50"
                              >
                                {notes || "Haz click para agregar observaciones a la fila."}
                              </button>
                            )}
                          </td>
                        ) : null}

                        {slotLabels.map((slot) => {
                          const entries = slotMap.get(slot)?.[line.key] || [];
                          return (
                            <td
                              key={`${row.waypointId}-${line.key}-${slot}`}
                              className="border border-slate-200 px-1 py-1 align-top"
                            >
                              <div className="flex min-h-[42px] flex-col gap-1">
                                {entries.length ? (
                                  entries.map((entry) => (
                                    <button
                                      key={`${entry.taskId}-${line.key}-${slot}-${entry.label}`}
                                      type="button"
                                      onClick={() => {
                                        const task = row.tasks.find(
                                          (currentTask) => String(currentTask.id) === String(entry.taskId)
                                        );
                                        if (task) {
                                          handleTaskAction(() => onEditTask(task));
                                        }
                                      }}
                                      className={joinClasses(
                                        "rounded-[10px] border px-1.5 py-1 text-left transition hover:translate-y-[-1px] hover:shadow-sm",
                                        line.chipClass
                                      )}
                                    >
                                      <div className="truncate font-semibold">{entry.label}</div>
                                      {entry.meta ? (
                                        <div className="truncate text-[10px] opacity-80">{entry.meta}</div>
                                      ) : null}
                                    </button>
                                  ))
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleTaskAction(() =>
                                        onQuickCreateTask({ row, lineKey: line.key, slotLabel: slot })
                                      )
                                    }
                                    className="flex min-h-[42px] w-full items-center justify-center rounded-[10px] border border-dashed border-slate-300 bg-white text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
                                  >
                                    +
                                  </button>
                                )}
                              </div>
                            </td>
                          );
                        })}

                        {lineIndex === 0 ? (
                          <td
                            rowSpan={LINE_DEFINITIONS.length}
                            className="border border-slate-200 px-2 py-2 align-top"
                          >
                            <div className="flex flex-col gap-2">
                              {row.tasks.slice(0, 3).map((task) => (
                                <ActionButton
                                  key={`${task.id}-edit`}
                                  variant="secondary"
                                  className="!px-3 !py-1.5"
                                  onClick={() => handleTaskAction(() => onEditTask(task))}
                                >
                                  Editar
                                </ActionButton>
                              ))}
                              <ActionButton
                                variant="secondary"
                                className="!px-3 !py-1.5"
                                onClick={() =>
                                  handleTaskAction(() =>
                                    onQuickCreateTask({ row, lineKey: "program", slotLabel: "" })
                                  )
                                }
                              >
                                Agregar
                              </ActionButton>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
