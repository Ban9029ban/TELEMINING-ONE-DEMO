import { API_ROOT } from './apiBase'

export const API_URL = API_ROOT

export async function postSemaforoEstado(estado) {
  await fetch(`${API_URL}/api/semaforos/estado/${estado}`, { method: 'POST' })
}
