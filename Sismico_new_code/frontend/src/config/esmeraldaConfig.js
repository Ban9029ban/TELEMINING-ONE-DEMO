const ESMERALDA_EXTERNAL_OBJECT_CODE = 'diamante_bajo_diamante_esmeralda'

const ESMERALDA_EXTERNAL_KEYS = [
  'diamante_bajo_diamante_esmeralda',
  'bajo_diamante_esmeralda',
  'bajo diamante esmeralda',
  'bde',
  'bda',
]

function esmeraldaKeys(...extra) {
  return [...extra, ...ESMERALDA_EXTERNAL_KEYS]
}

export const ESMERALDA_CONFIG = {
  siteCode: 'esmeralda',
  title: 'Poligonos Sismicidad - Esmeralda',
  mapTitle: 'Mapa - Esmeralda',
  projectTitle: 'Proyecto Esmeralda',

  projectLogo: '/legacy/esmeralda/IMG/codelco_logo.png',
  mapCornerLogo: '/legacy/esmeralda/IMG/codelco_logo.png',
  footerLogo: '/legacy/TELE.png',
  compassLogo: '/legacy/esmeralda/IMG/norte_logo.png',
  mapBase: '/legacy/esmeralda/assets/Fondo.png',

  refreshMs: 6500,

  groups: [
    {
      title: 'SECTOR NORTE',
      items: [
        {
          code: 'esm_bajo_diamante_esmeralda',
          backendObjectCode: ESMERALDA_EXTERNAL_OBJECT_CODE,
          name: 'BAJO DIAMANTE ESMERALDA',
          keys: esmeraldaKeys('esm_bajo_diamante_esmeralda'),
          assets: {
            centro: '/legacy/esmeralda/assets/bajo_diamante_esmeralda_v.png',
            inferior: '/legacy/esmeralda/assets/bajo_diamante_esmeralda_r.png',
            superior: '/legacy/esmeralda/assets/bajo_diamante_esmeralda_r.png',
          },
        },
        {
          code: 'esm_panel_2',
          backendObjectCode: ESMERALDA_EXTERNAL_OBJECT_CODE,
          name: 'PANEL 2',
          keys: esmeraldaKeys('panel 2', 'esm_panel_2'),
          assets: {
            centro: '/legacy/esmeralda/assets/panel_2_v.png',
            inferior: '/legacy/esmeralda/assets/panel_2_r.png',
            superior: '/legacy/esmeralda/assets/panel_2_r.png',
          },
        },
        {
          code: 'esm_ext_norte_bloque_2',
          backendObjectCode: ESMERALDA_EXTERNAL_OBJECT_CODE,
          name: 'EXT NORTE BLOQUE 2',
          keys: esmeraldaKeys('ext norte bloque 2', 'ext norte', 'esm_ext_norte_bloque_2'),
          assets: {
            centro: '/legacy/esmeralda/assets/ext_norte_bloque_2_v.png',
            inferior: '/legacy/esmeralda/assets/ext_norte_bloque_2_r.png',
            superior: '/legacy/esmeralda/assets/ext_norte_bloque_2_r.png',
          },
        },
      ],
    },
    {
      title: 'SECTOR CENTRAL',
      items: [
        {
          code: 'esm_interzanja_c49_c55',
          backendObjectCode: ESMERALDA_EXTERNAL_OBJECT_CODE,
          name: 'INTERZANJA C49 - C55',
          keys: esmeraldaKeys('interzanja c49 c55', 'interzanja', 'c49 c55', 'esm_interzanja_c49_c55'),
          assets: {
            centro: '/legacy/esmeralda/assets/interzanja_c49_c55_v.png',
            inferior: '/legacy/esmeralda/assets/interzanja_c49_c55_r.png',
            superior: '/legacy/esmeralda/assets/interzanja_c49_c55_r.png',
          },
        },
        {
          code: 'esm_bloque_6',
          backendObjectCode: ESMERALDA_EXTERNAL_OBJECT_CODE,
          name: 'BLOQUE 6',
          keys: esmeraldaKeys('bloque 6', 'esm_bloque_6'),
          assets: {
            centro: '/legacy/esmeralda/assets/bloque_6_v.png',
            inferior: '/legacy/esmeralda/assets/bloque_6_r.png',
            superior: '/legacy/esmeralda/assets/bloque_6_r.png',
          },
        },
        {
          code: 'esm_bloque_1',
          backendObjectCode: ESMERALDA_EXTERNAL_OBJECT_CODE,
          name: 'BLOQUE 1',
          keys: esmeraldaKeys('bloque 1', 'esm_bloque_1'),
          assets: {
            centro: '/legacy/esmeralda/assets/bloque_1_v.png',
            inferior: '/legacy/esmeralda/assets/bloque_1_r.png',
            superior: '/legacy/esmeralda/assets/bloque_1_r.png',
          },
        },
      ],
    },
    {
      title: 'SECTOR SUR / ORIENTE',
      items: [
        {
          code: 'esm_bloque_2',
          backendObjectCode: ESMERALDA_EXTERNAL_OBJECT_CODE,
          name: 'BLOQUE 2',
          keys: esmeraldaKeys('bloque 2', 'esm_bloque_2'),
          assets: {
            centro: '/legacy/esmeralda/assets/bloque_2_v.png',
            inferior: '/legacy/esmeralda/assets/bloque_2_r.png',
            superior: '/legacy/esmeralda/assets/bloque_2_r.png',
          },
        },
        {
          code: 'esm_esmeralda_sur',
          backendObjectCode: ESMERALDA_EXTERNAL_OBJECT_CODE,
          name: 'ESMERALDA SUR',
          keys: esmeraldaKeys('esmeralda sur', 'esm_esmeralda_sur'),
          assets: {
            centro: '/legacy/esmeralda/assets/esmeralda_sur_v.png',
            inferior: '/legacy/esmeralda/assets/esmeralda_sur_r.png',
            superior: '/legacy/esmeralda/assets/esmeralda_sur_r.png',
          },
        },
        {
          code: 'esm_ext_fw_bloque_2',
          backendObjectCode: ESMERALDA_EXTERNAL_OBJECT_CODE,
          name: 'EXT FW BLOQUE 2',
          keys: esmeraldaKeys('ext fw bloque 2', 'ext fw', 'esm_ext_fw_bloque_2'),
          assets: {
            centro: '/legacy/esmeralda/assets/ext_fw_bloque_2_v.png',
            inferior: '/legacy/esmeralda/assets/ext_fw_bloque_2_r.png',
            superior: '/legacy/esmeralda/assets/ext_fw_bloque_2_r.png',
          },
        },
      ],
    },
  ],
}
