const dashboardPaths = new Set([
  'diamante', 'andesita', 'andes-norte', 'det-np-andes-norte',
  'det-ucl-andes-norte', 'andes-norte-tunel-correa', 'pilar-norte',
  'esmeralda', 'sala-sic',
].map(name => `/legacy-sismico/${name}`))

export function isSeismicDashboard(pathname) {
  return dashboardPaths.has(pathname.replace(/\/+$/, ''))
}
