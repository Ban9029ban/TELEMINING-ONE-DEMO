export function slugifyFilename(value) {
  return String(value || "export")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "export";
}

export async function captureElementAsPng(el) {
  if (!el) return null;

  const canvas = el.querySelector("canvas");
  if (canvas && typeof canvas.toDataURL === "function") {
    try {
      return canvas.toDataURL("image/png", 1.0);
    } catch {
      return null;
    }
  }

  const svg = el.querySelector("svg");
  if (!svg) return null;

  try {
    const bbox = svg.getBoundingClientRect();
    const width = Math.max(1, Math.floor(bbox.width));
    const height = Math.max(1, Math.floor(bbox.height));
    const serialized = new XMLSerializer().serializeToString(svg);
    const encoded = window.btoa(unescape(encodeURIComponent(serialized)));
    const src = `data:image/svg+xml;base64,${encoded}`;

    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const target = document.createElement("canvas");
        target.width = width;
        target.height = height;
        const ctx = target.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(target.toDataURL("image/png", 1.0));
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  } catch {
    return null;
  }
}

export function downloadDataUrl(filename, dataUrl) {
  if (!dataUrl) return;
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function downloadCsv(filename, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;

  const headers = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row || {}).forEach((key) => set.add(key));
      return set;
    }, new Set())
  );

  const csv = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => {
          const raw = row?.[header] ?? "";
          const cell = String(raw).replace(/"/g, '""');
          return `"${cell}"`;
        })
        .join(",")
    ),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}
