import React, { useMemo, useState } from "react";

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function buildSummary(values, options, placeholder) {
  if (!values.length) return placeholder;

  const labels = values
    .map((value) => options.find((item) => String(item.value) === String(value))?.label || value)
    .filter(Boolean);

  if (!labels.length) return placeholder;
  if (labels.length <= 2) return labels.join(", ");
  return `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
}

export default function ProductivityMultiSelect({
  value = [],
  onChange,
  options = [],
  placeholder = "Todos",
  disabled = false,
}) {
  const [search, setSearch] = useState("");

  const filteredOptions = useMemo(() => {
    const pattern = normalizeText(search);
    if (!pattern) return options;
    return options.filter((option) => normalizeText(option.label).includes(pattern));
  }, [options, search]);

  const summary = useMemo(
    () => buildSummary(value, options, placeholder),
    [options, placeholder, value]
  );

  return (
    <details className="relative">
      <summary
        className={`flex min-h-11 cursor-pointer list-none items-center justify-between rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 transition hover:border-slate-300 ${
          disabled ? "pointer-events-none bg-slate-100 text-slate-400" : ""
        }`}
      >
        <span className="truncate">{summary}</span>
        <span className="ml-3 text-xs font-semibold text-slate-400">
          {value.length ? `${value.length} sel.` : "Abrir"}
        </span>
      </summary>

      <div className="absolute left-0 z-20 mt-2 w-full rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_22px_48px_rgba(15,23,42,0.14)]">
        <div className="space-y-3">
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar opcion..."
            className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700"
          />

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                onChange(options.map((item) => String(item.value)));
              }}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Seleccionar todo
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                onChange([]);
              }}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Limpiar
            </button>
          </div>

          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {filteredOptions.length ? (
              filteredOptions.map((option) => {
                const checked = value.includes(String(option.value));
                return (
                  <label
                    key={`${option.value}-${option.label}`}
                    className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        const next = event.target.checked
                          ? [...value, String(option.value)]
                          : value.filter((item) => String(item) !== String(option.value));
                        onChange(next);
                      }}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-500 focus:ring-indigo-500"
                    />
                    <span>{option.label}</span>
                  </label>
                );
              })
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">
                No hay opciones para este filtro.
              </div>
            )}
          </div>
        </div>
      </div>
    </details>
  );
}
