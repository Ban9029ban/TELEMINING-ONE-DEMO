export function normalizeSiteCode(site) {
  if (!site) return '';
  return String(site)
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
    .replace(/\s+/g, '_');
}
