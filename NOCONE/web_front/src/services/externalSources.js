export const DEFAULT_EXTERNAL_SOURCES = {
  control_vial_url: "http://devtm.denial.cl:19091/"
};

export const EXTERNAL_SOURCE_DEFINITIONS = [
{
  key: "control_vial_url",
  label: "Semáforos control vial",
  description: "Panel externo del control vial operacional."
}];


async function parseResponseBody(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => null);
  }
  return response.text().catch(() => "");
}

export function normalizeExternalSources(payload = {}) {
  const merged = {
    ...DEFAULT_EXTERNAL_SOURCES,
    ...(payload || {})
  };

  return {
    ...merged,
    items: EXTERNAL_SOURCE_DEFINITIONS.map((definition) => ({
      ...definition,
      url: merged[definition.key] || DEFAULT_EXTERNAL_SOURCES[definition.key],
      updated_at:
      Array.isArray(payload?.items) ?
      payload.items.find((item) => item?.key === definition.key)?.updated_at || null :
      null
    }))
  };
}

export async function fetchExternalSources() {
  try {
    const response = await fetch("/api/config/external-sources");
    const body = await parseResponseBody(response);

    if (!response.ok) {
      const detail =
      typeof body === "object" && body ?
      body.detail || JSON.stringify(body) :
      String(body || "Error");
      throw new Error(detail);
    }

    return normalizeExternalSources(body || {});
  } catch (error) {
    return {
      ...normalizeExternalSources(),
      _error: String(error?.message || error)
    };
  }
}
