import { normalizeSiteCode } from '../utils/siteNormalizer'

export const SISMICO_LEGACY_SITE_CONFIGS = {
  diamante: {
    siteCode: 'diamante',
    title: 'Polígonos Sismicidad — Diamante',
    mapTitle: 'Mapa — Visualización',
    pageClass: 'diamante-site',
    projectTitle: 'Proyecto Diamante',
    projectImage: '/assets/legacy/DIAMANTE.png',
    mapFallbacks: ['/legacy/diamante/map.png', '/assets/legacy/map.png', '/assets/legacy/d.jpg'],
    refreshMs: 6500,
    objects: [
      {
        code: 'diamante_pipa',
        name: 'Diamante PIPA',
        stateMode: 'dual',
        group: 'Polígonos Sismicidad',
        keys: ['diamante_pipa', 'pipa', 'diamante pipa'],
        overlayAssets: { normal: '/legacy/diamante/VPIPA.png', critical: '/legacy/diamante/PIPA.png' },
      },
      {
        code: 'diamante_footprint_hw',
        name: 'FootPrint HW',
        stateMode: 'dual',
        group: 'Polígonos Sismicidad',
        keys: ['diamante_footprint_hw', 'footprint_hw', 'footprint hw', 'hw'],
        overlayAssets: { normal: '/legacy/diamante/VHW.png', critical: '/legacy/diamante/HW.png' },
      },
      {
        code: 'diamante_footprint_fw',
        name: 'FootPrint FW',
        stateMode: 'dual',
        group: 'Polígonos Sismicidad',
        keys: ['diamante_footprint_fw', 'footprint_fw', 'footprint fw', 'fw'],
        overlayAssets: { normal: '/legacy/diamante/VFW.png', critical: '/legacy/diamante/FW.png' },
      },
      {
        code: 'diamante_bajo_diamante_esmeralda',
        name: 'Bajo Diamante Esmeralda',
        stateMode: 'tri',
        group: 'Polígonos Sismicidad',
        keys: ['diamante_bajo_diamante_esmeralda', 'bajo_diamante_esmeralda', 'bajo diamante esmeralda', 'bde', 'bda'],
        overlayAssets: { normal: '/legacy/diamante/VBDA.png', critical: '/legacy/diamante/BDA.png' },
      },
    ],
  },
  andesita: {
    siteCode: 'andesita',
    title: 'Tabla de Polígonos – ANDESITA',
    mapTitle: 'Mapas – ANDESITA',
    pageClass: 'andesita-site',
    projectTitle: 'Proyecto Andesita',
    projectImage: '/assets/legacy/ANDESITA.png',
    mapFallbacks: ['/legacy/andesita/ANDESITAMAP.jpg', '/assets/legacy/ANDESITAMAP.jpg'],
    refreshMs: 6500,
    objects: [
      {
        code: 'andesita_norte_hw',
        name: 'Andesita Norte HW',
        stateMode: 'tri',
        group: 'Polígonos Sismicidad',
        keys: ['andesita_norte_hw', 'andesita norte hw', 'norte hw'],
        overlayAssets: { normal: '/legacy/andesita/ANDESITA NORTE HW V.png', critical: '/legacy/andesita/ANDESITA NORTE HW R.png' },
      },
      {
        code: 'andesita_norte_fw',
        name: 'Andesita Norte FW',
        stateMode: 'tri',
        group: 'Polígonos Sismicidad',
        keys: ['andesita_norte_fw', 'andesita norte fw', 'norte fw'],
        overlayAssets: { normal: '/legacy/andesita/ANDESITA NORTE FW V.png', critical: '/legacy/andesita/ANDESITA NORTE FW R.png' },
      },
      {
        code: 'andesita_sur_hw',
        name: 'Andesita Sur HW',
        stateMode: 'tri',
        group: 'Polígonos Sismicidad',
        keys: ['andesita_sur_hw', 'andesita sur hw', 'sur hw'],
        overlayAssets: { normal: '/legacy/andesita/ANDESITA SUR HW V.png', critical: '/legacy/andesita/ANDESITE SUR HW R.png' },
      },
      {
        code: 'andesita_sur_fw',
        name: 'Andesita Sur FW',
        stateMode: 'tri',
        group: 'Polígonos Sismicidad',
        keys: ['andesita_sur_fw', 'andesita sur fw', 'sur fw'],
        overlayAssets: { normal: '/legacy/andesita/ANDESITA SUR FW V.png', critical: '/legacy/andesita/ANDESITA SUR FW R.png' },
      },
    ],
  },
  andes_norte: {
    siteCode: 'andes_norte',
    title: 'Polígonos Sismicidad — Andes Norte',
    mapTitle: 'Proyecto Andes Norte',
    pageClass: 'andes-norte-site',
    projectTitle: 'Proyecto Andes Norte',
    projectImage: '/assets/legacy/ANLOGO.png',
    mapFallbacks: ['/legacy/andesnorte/ANNI/ANNI.jpg', '/assets/legacy/ANNI/ANNI.jpg', '/assets/legacy/ANNI.jpg'],
    refreshMs: 6500,
    objects: [
      { code: 'ann_monitoreo_post_evento_2025', name: 'MONITOREO POST EVENTO 2025', stateMode: 'tri', group: 'POLÍGONO PROFUNDO', keys: ['monitoreo post evento 2025', 'monitoreo_post_evento_2025', 'ann_monitoreo_post_evento_2025'], overlayAssets: { normal: '/legacy/andesnorte/ANNI/MONITOREO POST EVENTO 2025_v.png', critical: '/legacy/andesnorte/ANNI/MONITOREO POST EVENTO 2025.png' } },
      { code: 'ann_adit_74_75', name: 'ADIT 74 - 75', stateMode: 'tri', group: 'POLÍGONO PROFUNDO', keys: ['adit 74 75', 'adit_74_75', 'adit 74 - 75', 'poligono adit 74 75 profundo', '7475', 'ann_adit_74_75', 'ann_adit_74_75_profundo', 'ann_7475'], overlayAssets: { normal: '/legacy/andesnorte/ANNI/7475_v.png', critical: '/legacy/andesnorte/ANNI/7475.png' } },
      { code: 'ann_pilar_2', name: 'POLIGONO PILAR 2', stateMode: 'tri', group: 'POLÍGONO PROFUNDO', keys: ['pilar 2', 'poligono pilar 2', 'poligono pilar 2 profundo', 'ann_pilar_2', 'ann_pilar_2_profundo', 'poligono_pilar_2'], overlayAssets: { normal: '/legacy/andesnorte/ANNI/Pilar 2_v.png', critical: '/legacy/andesnorte/ANNI/Pilar 2.png' } },
      { code: 'ann_inicio_caving', name: 'INICIO CAVING', stateMode: 'tri', group: 'POLÍGONO PRODUCCIÓN', keys: ['inicio caving', 'inicio_caving', 'ann_inicio_caving'], overlayAssets: { normal: '/legacy/andesnorte/ANNI/INICIO CAVING_v.png', critical: '/legacy/andesnorte/ANNI/INICIO CAVING.png' } },
      { code: 'ann_p4600', name: 'P 4600', stateMode: 'dual', group: 'POLÍGONOS LOCALES', keys: ['p 4600', 'p4600', 'ann_p4600', 'p_4600'], overlayAssets: { normal: '/legacy/andesnorte/ANNI/P 4600_v.png', critical: '/legacy/andesnorte/ANNI/P 4600.png' } },
      { code: 'ann_tc_oim', name: 'TC OIM', stateMode: 'dual', group: 'POLÍGONOS LOCALES', keys: ['tc oim', 'ann_tc_oim', 'tc_oim', 'tc_tc_oim'], overlayAssets: { normal: '/legacy/andesnorte/ANNI/TC OIM_v.png', critical: '/legacy/andesnorte/ANNI/TC OIM.png' } },
      { code: 'ann_pacifico', name: 'PACÍFICO', stateMode: 'dual', group: 'POLÍGONOS LOCALES', keys: ['pacifico', 'pacífico', 'ann_pacifico'], overlayAssets: { normal: '/legacy/andesnorte/ANNI/PAC#U2553FICO_v.png', critical: '/legacy/andesnorte/ANNI/PAC#U2553FICO.png' } },
      { code: 'ann_cab_hw', name: 'CABECERA HW', stateMode: 'dual', group: 'POLÍGONOS LOCALES', keys: ['cabecera hw', 'ann_cab_hw', 'ann_cabecera_hw', 'cabecera_hw'], overlayAssets: { normal: '/legacy/andesnorte/ANNI/CABECERA HW_v.png', critical: '/legacy/andesnorte/ANNI/CABECERA HW.png' } },
      { code: 'ann_an_norte_hw', name: 'AN NORTE HW', stateMode: 'dual', group: 'POLÍGONOS LOCALES', keys: ['an norte hw', 'ann_an_norte_hw', 'an_norte_hw'], overlayAssets: { normal: '/legacy/andesnorte/ANNI/AN NORTE HW_v.png', critical: '/legacy/andesnorte/ANNI/AN NORTE HW.png' } },
      { code: 'ann_an_norte_fw', name: 'AN NORTE FW', stateMode: 'dual', group: 'POLÍGONOS LOCALES', keys: ['an norte fw', 'ann_an_norte_fw', 'an_norte_fw'], overlayAssets: { normal: '/legacy/andesnorte/ANNI/AN NORTE FW_v.png', critical: '/legacy/andesnorte/ANNI/AN NORTE FW.png' } },
      { code: 'ann_an_sur_hw', name: 'AN SUR HW', stateMode: 'dual', group: 'POLÍGONOS LOCALES', keys: ['an sur hw', 'ann_an_sur_hw', 'an_sur_hw'], overlayAssets: { normal: '/legacy/andesnorte/ANNI/AN SUR HW_v.png', critical: '/legacy/andesnorte/ANNI/AN SUR HW.png' } },
      { code: 'ann_cab_fw_norte', name: 'CABECERA FW NORTE', stateMode: 'dual', group: 'POLÍGONOS LOCALES', keys: ['cabecera fw norte', 'ann_cab_fw_norte', 'ann_cabecera_fw_norte', 'cabecera_fw_norte'], overlayAssets: { normal: '/legacy/andesnorte/ANNI/CABECERA FW NORTE_v.png', critical: '/legacy/andesnorte/ANNI/CABECERA FW NORTE.png' } },
      { code: 'ann_monitoreo_post_evento_fw', name: 'MONITOREO POST EVENTO FW', stateMode: 'dual', group: 'POLÍGONOS LOCALES', keys: ['monitoreo post evento fw', 'ann_monitoreo_post_evento_fw', 'monitoreo_post_evento_fw'], overlayAssets: { normal: '/legacy/andesnorte/ANNI/MONITOREO POST EVENTO FW_v.png', critical: '/legacy/andesnorte/ANNI/MONITOREO POST EVENTO FW.png' } },
    ],
  },
  andes_norte_tunel_correa: {
    siteCode: 'andes_norte_tunel_correa',
    title: 'Polígonos Sismicidad — Andes Norte Túnel Correa',
    mapTitle: 'Mapa — Túnel Correa',
    pageClass: 'tunel-correa-site',
    projectTitle: 'Proyecto Andes Norte Túnel Correa',
    projectImage: '/legacy/updates-20260911/tunnelcorrea/ANDN.png',
    mapFallbacks: ['/legacy/updates-20260911/tunnelcorrea/TC.jpg', '/legacy/andesnorte/ANNI/ANNI.jpg'],
    refreshMs: 6500,
    objects: [
      {
            "code": "bajo_andesita_profundo",
            "backendObjectCode": "tc_bajo_andesita_profundo",
            "name": "BAJO ANDESITA PROFUNDO",
            "stateMode": "tri",
            "group": "POLÍGONO PROFUNDO",
            "automaticSource": true,
            "keys": [
                  "tc_bajo_andesita_profundo",
                  "bajo_andesita_profundo",
                  "poligono bajo andesita profundo"
            ],
            "overlayAssets": {
                  "normal": "/legacy/updates-20260911/tunnelcorrea/BAJO ANDESITA PROFUNDO_v.png",
                  "inferior": "/legacy/updates-20260911/tunnelcorrea/BAJO ANDESITA PROFUNDO_r.png",
                  "superior": "/legacy/updates-20260911/tunnelcorrea/BAJO ANDESITA PROFUNDO_r.png"
            }
      },
      {
            "code": "bajo_andesita_under",
            "backendObjectCode": "tc_bajo_andesita_under",
            "name": "BAJO ANDESITA UNDER",
            "stateMode": "tri",
            "group": "POLÍGONO PROFUNDO",
            "automaticSource": true,
            "keys": [
                  "tc_bajo_andesita_under",
                  "bajo_andesita_under",
                  "poligono bajo andesita under"
            ],
            "overlayAssets": {
                  "normal": "/legacy/updates-20260911/tunnelcorrea/BAJO ANDESITA UNDER_v.png",
                  "inferior": "/legacy/updates-20260911/tunnelcorrea/BAJO ANDESITA UNDER_r.png",
                  "superior": "/legacy/updates-20260911/tunnelcorrea/BAJO ANDESITA UNDER_r.png"
            }
      },
      {
            "code": "pilar_2_profundo",
            "backendObjectCode": "tc_pilar_2_profundo",
            "name": "PILAR 2",
            "stateMode": "tri",
            "group": "POLÍGONO PROFUNDO",
            "automaticSource": true,
            "keys": [
                  "tc_pilar_2_profundo",
                  "pilar_2_profundo",
                  "poligono pilar 2 profundo"
            ],
            "overlayAssets": {
                  "normal": "/legacy/updates-20260911/tunnelcorrea/PILAR 2_v.png",
                  "inferior": "/legacy/updates-20260911/tunnelcorrea/PILAR 2_r.png",
                  "superior": "/legacy/updates-20260911/tunnelcorrea/PILAR 2_r.png"
            }
      },
      {
            "code": "tc_oim",
            "backendObjectCode": "tc_tc_oim",
            "name": "TC OIM",
            "stateMode": "traffic",
            "group": "POLÍGONOS LOCALES",
            "keys": [
                  "tc_oim",
                  "tc_tc_oim"
            ],
            "overlayAssets": {
                  "verde": "/legacy/updates-20260911/tunnelcorrea/TC OIM_v.png",
                  "amarillo": "/legacy/updates-20260911/tunnelcorrea/TC OIM_a.png",
                  "rojo": "/legacy/updates-20260911/tunnelcorrea/TC OIM_r.png"
            }
      },
      {
            "code": "p_4600",
            "backendObjectCode": "tc_p_4600",
            "name": "P 4600",
            "stateMode": "traffic",
            "group": "POLÍGONOS LOCALES",
            "keys": [
                  "p_4600",
                  "tc_p_4600"
            ],
            "overlayAssets": {
                  "verde": "/legacy/updates-20260911/tunnelcorrea/P 4600_v.png",
                  "amarillo": "/legacy/updates-20260911/tunnelcorrea/P 4600_a.png",
                  "rojo": "/legacy/updates-20260911/tunnelcorrea/P 4600_r.png"
            }
      }
],
  },
  pilar_norte: {
    siteCode: 'pilar_norte',
    title: 'Polígonos Sismicidad — Pilar Norte',
    mapTitle: 'Mapa — Pilar Norte',
    pageClass: 'pilar-norte-site',
    projectTitle: 'Proyecto Pilar Norte',
    projectImage: '/assets/legacy/ANLOGO.png',
    mapFallbacks: ['/legacy/andesnorte/ANNI/ANNI.jpg'],
    refreshMs: 6500,
    objects: [
      { code: 'ann_pilar_2', name: 'POLIGONO PILAR 2', stateMode: 'tri', group: 'POLÍGONO PROFUNDO', keys: ['pilar 2', 'poligono pilar 2', 'poligono pilar 2 profundo', 'ann_pilar_2', 'ann_pilar_2_profundo', 'poligono_pilar_2'], overlayAssets: { normal: '/legacy/andesnorte/ANNI/Pilar 2_v.png', critical: '/legacy/andesnorte/ANNI/Pilar 2.png' } },
    ],
  },
  esmeralda: {
    siteCode: 'esmeralda',
    title: 'Polígonos Sismicidad — Esmeralda',
    mapTitle: 'Mapa — Esmeralda',
    pageClass: 'esmeralda-site',
    projectTitle: 'Proyecto Esmeralda',
    projectImage: '/assets/legacy/DIAMANTE.png',
    mapFallbacks: ['/legacy/diamante/map.png', '/assets/legacy/map.png', '/assets/legacy/d.jpg'],
    refreshMs: 6500,
    objects: [
      { code: 'diamante_bajo_diamante_esmeralda', name: 'Bajo Diamante Esmeralda', stateMode: 'tri', group: 'Polígonos Sismicidad', keys: ['diamante_bajo_diamante_esmeralda', 'bajo_diamante_esmeralda', 'bajo diamante esmeralda', 'bde', 'bda'], overlayAssets: { normal: '/legacy/diamante/VBDA.png', critical: '/legacy/diamante/BDA.png' } },
    ],
  },
}

export function getSismicoLegacySiteConfig(siteCode) {
  const normalized = normalizeSiteCode(siteCode)
  return SISMICO_LEGACY_SITE_CONFIGS[normalized] || null
}
