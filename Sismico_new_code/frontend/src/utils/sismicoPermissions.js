export function canManageSismicoManualState(user) {
  const role = String(user?.role_code || user?.roleCode || '')
    .trim()
    .toLowerCase()

  const username = String(user?.username || '').trim().toLowerCase()
  return role === 'admin' || role === 'operator' || username === 'sala_cic'
}
