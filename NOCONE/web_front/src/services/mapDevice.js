import api from "./index";

// obtener map_device para un pórtico
export async function getMapDevice(refId, mapCode) {
  const r = await api.get(`/map_device/by_ref/${refId}/${mapCode}`);
  return r.data || null;
}

// crear
export async function createMapDevice(data) {
  const r = await api.post(`/map_device`, data);
  return r.data;
}

// actualizar
export async function updateMapDevice(id, data) {
  const r = await api.patch(`/map_device/${id}`, data);
  return r.data;
}