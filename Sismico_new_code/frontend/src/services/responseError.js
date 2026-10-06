export async function responseErrorMessage(response) {
  const status = response.status;
  if (status >= 500) return 'El servicio sísmico no está disponible temporalmente. Intenta nuevamente en unos momentos.';
  let body;
  try { body = await response.json(); } catch {}
  const detail = body?.detail || body?.message;
  if (typeof detail === 'string' && detail.length < 300 && !/[<>]/.test(detail)) return detail;
  return `No se pudo completar la solicitud (código ${status}).`;
}
