import { ANDES_NORTE_CONFIG } from './andesNorteConfig'

const ALLOWED_CODES = new Set([
  'ann_monitoreo_post_evento_2025',
  'ann_bajo_footprint_an',
  'ann_inicio_caving',
  'ann_monitoreo_post_evento',
  'ann_monitoreo_post_evento_fw',
  'ann_cabecera_fw_norte',
  'ann_cabecera_hw',
  'ann_an_norte_hw',
  'ann_an_norte_fw',
  'ann_an_sur_hw',
])

const filteredGroups = (ANDES_NORTE_CONFIG.groups || [])
  .map((group) => ({
    ...group,
    items: (group.items || []).filter((item) => ALLOWED_CODES.has(item.code)),
  }))
  .filter((group) => group.items.length > 0)

export const DET_NP_ANDES_NORTE_CONFIG = {
  ...ANDES_NORTE_CONFIG,
  siteCode: 'det_np_andes_norte',
  title: 'Poligonos Sismicidad - DET NP Andes Norte',
  mapTitle: 'Proyecto DET NP Andes Norte',
  visibilityStorageKey: 'legacy-site-boxes:det_np_andes_norte',
  mapBrandLogos: ['/legacy/codelco.png', '/legacy/ME.svg'],
  mapBrandText: null,
  groups: filteredGroups,
}
