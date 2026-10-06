import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export const PRODUCTION_GANTT_SLOTS = [
  "20 a 21",
  "21 a 22",
  "22 a 23",
  "23 a 00",
  "00 a 01",
  "01 a 02",
  "02 a 03",
  "03 a 04",
  "04 a 05",
  "05 a 06",
  "06 a 07",
  "07 a 08",
  "08 a 09",
];

function parseDate(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toBaseDate(value) {
  const parsed = parseDate(value) || new Date();
  const next = new Date(parsed);
  next.setHours(0, 0, 0, 0);
  return next;
}

function normalizeOperationalDateTime(value, operationDate) {
  const parsed = parseDate(value);
  if (!parsed) return null;

  const baseDate = toBaseDate(operationDate);
  const next = new Date(parsed);
  if (
    next.getFullYear() === baseDate.getFullYear() &&
    next.getMonth() === baseDate.getMonth() &&
    next.getDate() === baseDate.getDate() &&
    next.getHours() < 12
  ) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

function resolveTaskWindow(task, startKey, endKey) {
  const operationDate = task.date || task.operationDate;
  const start = normalizeOperationalDateTime(task[startKey], operationDate);
  let end = normalizeOperationalDateTime(task[endKey], operationDate);

  if (start && !end) {
    const fallbackMinutes = Number(task.plannedMinutes || task.realMinutes || 30);
    end = new Date(start.getTime() + Math.max(15, fallbackMinutes) * 60000);
  }

  if (start && end && end <= start) {
    end = new Date(end.getTime() + 24 * 60 * 60000);
  }

  return { start, end };
}

export function slotWindow(operationDate, slotLabel) {
  const baseDate = toBaseDate(operationDate);
  const [fromLabel, toLabel] = slotLabel.split(" a ").map((item) => item.trim());
  const start = new Date(baseDate);
  const end = new Date(baseDate);
  const fromHour = Number(fromLabel);
  const toHour = Number(toLabel);

  start.setHours(fromHour, 0, 0, 0);
  end.setHours(toHour, 0, 0, 0);

  if (fromHour < 12) {
    start.setDate(start.getDate() + 1);
  }
  if (toHour <= fromHour || toHour < 12) {
    end.setDate(end.getDate() + 1);
  }

  return { start, end };
}

function overlapsSlot(task, slotLabel, startKey, endKey) {
  const { start, end } = resolveTaskWindow(task, startKey, endKey);
  if (!start || !end) return false;
  const slot = slotWindow(task.date || task.operationDate, slotLabel);
  return start < slot.end && end > slot.start;
}

function composeResource(task, planKey, crewKey) {
  return [task[planKey], task[crewKey]].filter(Boolean).join(" / ");
}

function normalizeEntries(entries) {
  return entries.filter((item) => item.label).sort((left, right) => left.startMs - right.startMs);
}

function buildObservationText(tasks) {
  const seen = new Set();
  return tasks
    .map((task) => String(task.observation || "").trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    })
    .map((item) => `- ${item}`)
    .join("\n");
}

function taskSortKey(task) {
  const { start: plannedStart } = resolveTaskWindow(task, "plannedStart", "plannedEnd");
  const { start: realStart } = resolveTaskWindow(task, "realStart", "realEnd");
  return (plannedStart || realStart || toBaseDate(task.date || task.operationDate)).getTime();
}

function buildLineEntries(tasks, slotLabel, lineKey) {
  if (lineKey === "program") {
    return normalizeEntries(
      tasks
        .filter((task) => overlapsSlot(task, slotLabel, "plannedStart", "plannedEnd"))
        .map((task) => ({
          taskId: task.id,
          label: task.activity || task.type || "-",
          meta: task.type || "",
          status: task.status || "planned",
          startMs: taskSortKey(task),
        }))
    );
  }

  if (lineKey === "resourcePlan") {
    return normalizeEntries(
      tasks
        .filter((task) => overlapsSlot(task, slotLabel, "plannedStart", "plannedEnd"))
        .map((task) => ({
          taskId: task.id,
          label: composeResource(task, "equipmentPlanned", "crewPlanned"),
          meta: task.activity || "",
          status: task.status || "planned",
          startMs: taskSortKey(task),
        }))
    );
  }

  if (lineKey === "real") {
    return normalizeEntries(
      tasks
        .filter((task) => overlapsSlot(task, slotLabel, "realStart", "realEnd"))
        .map((task) => ({
          taskId: task.id,
          label: task.activity || task.type || "-",
          meta: task.type || "",
          status: task.status || "planned",
          startMs: taskSortKey(task),
        }))
    );
  }

  return normalizeEntries(
    tasks
      .filter((task) => overlapsSlot(task, slotLabel, "realStart", "realEnd"))
      .map((task) => ({
        taskId: task.id,
        label: composeResource(task, "equipmentReal", "crewReal"),
        meta: task.activity || "",
        status: task.status || "planned",
        startMs: taskSortKey(task),
      }))
  );
}

export function buildProductionGanttRows(tasks, slotLabels = PRODUCTION_GANTT_SLOTS) {
  const grouped = new Map();

  [...tasks]
    .sort((left, right) => taskSortKey(left) - taskSortKey(right))
    .forEach((task) => {
      const key = task.waypointId || `${task.nivel || "-"}::${task.postura || "-"}`;
      const current = grouped.get(key) || {
        waypointId: task.waypointId || key,
        postura: task.postura || "",
        nivel: task.nivel || "",
        mapCode: task.mapCode || "",
        turno: task.turno || "",
        operationDate: task.date || task.operationDate,
        tasks: [],
      };
      current.tasks.push(task);
      grouped.set(key, current);
    });

  return Array.from(grouped.values())
    .map((row) => ({
      ...row,
      observations: buildObservationText(row.tasks),
      firstStartMs: Math.min(...row.tasks.map((task) => taskSortKey(task))),
      slots: slotLabels.map((slotLabel) => ({
        slot: slotLabel,
        program: buildLineEntries(row.tasks, slotLabel, "program"),
        resourcePlan: buildLineEntries(row.tasks, slotLabel, "resourcePlan"),
        real: buildLineEntries(row.tasks, slotLabel, "real"),
        resourceReal: buildLineEntries(row.tasks, slotLabel, "resourceReal"),
      })),
    }))
    .sort((left, right) => {
      if (left.firstStartMs !== right.firstStartMs) {
        return left.firstStartMs - right.firstStartMs;
      }
      return `${left.nivel}-${left.postura}`.localeCompare(`${right.nivel}-${right.postura}`, "es");
    });
}

export function formatOperationDateLabel(value) {
  const parsed = parseDate(value);
  if (!parsed) return "Sin fecha";
  return parsed.toLocaleDateString("es-CL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Santiago",
  });
}

export function buildProductionWorkbookExportUrl({ domain, filters }) {
  const params = new URLSearchParams();
  if (domain) params.set("domain", domain);
  if (filters?.date) params.set("date", filters.date);
  if (filters?.turno) params.set("turno", filters.turno);
  if (filters?.nivel) params.set("nivel", filters.nivel);
  if (filters?.mapCode) params.set("map_code", filters.mapCode);
  if (filters?.search) params.set("search", filters.search);
  return `/api/config/production-module/export.xlsx?${params.toString()}`;
}

export function exportProductionGanttPdf({
  title,
  rows,
  slotLabels = PRODUCTION_GANTT_SLOTS,
  operationDate,
  turno,
  mapLabel,
}) {
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: "a3",
  });

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 72, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.text(title, 36, 42);
  doc.setFontSize(9);
  doc.text(
    `Fecha: ${formatOperationDateLabel(operationDate)}   Turno: ${turno || "-"}   Mapa: ${mapLabel || "-"}`,
    36,
    60
  );

  const head = [["#", "Nivel", "Postura", "Plan", "Observaciones", ...slotLabels]];
  const body = [];

  rows.forEach((row, rowIndex) => {
    const rowValues = {
      number: String(rowIndex + 1),
      nivel: row.nivel || "",
      postura: row.postura || "",
      observations: row.observations || "",
    };

    [
      ["Programa", "program"],
      ["Recurso Prog", "resourcePlan"],
      ["Real", "real"],
      ["Recurso Real", "resourceReal"],
    ].forEach(([label, lineKey], lineIndex) => {
      body.push([
        lineIndex === 0 ? rowValues.number : "",
        lineIndex === 0 ? rowValues.nivel : "",
        lineIndex === 0 ? rowValues.postura : "",
        label,
        lineIndex === 0 ? rowValues.observations : "",
        ...row.slots.map((slot) =>
          (slot[lineKey] || [])
            .map((entry) => (entry.meta && lineKey !== "program" && lineKey !== "real" ? `${entry.label}` : entry.label))
            .join("\n")
        ),
      ]);
    });
  });

  autoTable(doc, {
    startY: 88,
    head,
    body,
    theme: "grid",
    styles: {
      fontSize: 5.5,
      cellPadding: 2,
      lineColor: [203, 213, 225],
      lineWidth: 0.5,
      overflow: "linebreak",
      valign: "middle",
      halign: "center",
      textColor: [15, 23, 42],
    },
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    columnStyles: {
      0: { cellWidth: 18 },
      1: { cellWidth: 26 },
      2: { cellWidth: 70 },
      3: { cellWidth: 44 },
      4: { cellWidth: 100, halign: "left" },
    },
    didParseCell(data) {
      if (data.section !== "body") return;
      const lineLabel = data.row.raw[3];

      if (lineLabel === "Programa") {
        data.cell.styles.fillColor = [37, 99, 235];
        data.cell.styles.textColor = [255, 255, 255];
      } else if (lineLabel === "Recurso Prog") {
        data.cell.styles.fillColor = [219, 234, 254];
        data.cell.styles.textColor = [15, 23, 42];
      } else if (lineLabel === "Real") {
        data.cell.styles.fillColor = [17, 24, 39];
        data.cell.styles.textColor = [255, 255, 255];
      } else if (lineLabel === "Recurso Real") {
        data.cell.styles.fillColor = [226, 232, 240];
        data.cell.styles.textColor = [15, 23, 42];
      }

      if (data.column.index === 2 && data.row.raw[2]) {
        data.cell.styles.fillColor = [29, 78, 216];
        data.cell.styles.textColor = [255, 255, 255];
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  const safeTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  doc.save(`${safeTitle}_${String(operationDate || "").slice(0, 10) || "operacion"}.pdf`);
}
