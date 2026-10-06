// src/services/api/pórticos.js
import api from "./index";

export async function getPorticos() {
  const r = await api.get("/access_portico");
  return r.data;
}

export async function updatePortico(id, data) {
  const r = await api.put(`/access_portico/${id}`, data);
  return r.data;
}