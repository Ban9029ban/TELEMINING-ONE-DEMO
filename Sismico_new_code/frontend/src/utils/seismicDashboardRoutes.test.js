import { test, expect } from 'vitest'
import { isSeismicDashboard } from './seismicDashboardRoutes'

test.each(['diamante','andesita','andes-norte','det-np-andes-norte','det-ucl-andes-norte','andes-norte-tunel-correa','pilar-norte','esmeralda','sala-sic'])('license allowed in dashboard %s', name => {
  expect(isSeismicDashboard(`/legacy-sismico/${name}`)).toBe(true)
  expect(isSeismicDashboard(`/legacy-sismico/${name}/`)).toBe(true)
})
test.each(['/','/login','/legacy-sismico','/legacy-sismico/','/legacy-sismico/diagnostico','/configuracion','/cameras','/tracking'])('license hidden in menu %s', path => {
  expect(isSeismicDashboard(path)).toBe(false)
})
