const PILAR_EXTERNAL_OBJECT_CODE = 'ann_pilar_2'

const PILAR_EXTERNAL_KEYS = [
  'ann_pilar_2',
  'ann_pilar_2_profundo',
  'poligono_pilar_2',
  'poligono pilar 2',
  'poligono pilar 2 profundo',
  'pilar 2',
]

function pilarKeys(...extra) {
  return [...extra, ...PILAR_EXTERNAL_KEYS]
}

export const PILAR_NORTE_CONFIG = {
  siteCode: 'pilar_norte',
  title: 'Poligonos Sismicidad - Pilar Norte',
  mapTitle: 'Mapa - Pilar Norte',
  projectTitle: 'Dashboard Sismico Mina Pilar Norte',

  projectLogo: '/legacy/pilarnorte/IMG/codelco_logo.png',
  footerLogo: '/legacy/TELE.png',
  compassLogo: '/legacy/pilarnorte/IMG/norte_logo.png',
  mapBase: '/legacy/pilarnorte/assets/mapa_pilar_norte - copia (2).png',

  refreshMs: 6500,

  groups: [
    {
      title: 'POLIGONO PROFUNDO',
      items: [
        {
          code: 'pn_pilar_norte',
          backendObjectCode: PILAR_EXTERNAL_OBJECT_CODE,
          name: 'PILAR NORTE',
          mode: 'tri',
          keys: pilarKeys('pilar norte', 'pn_pilar_norte'),
          assets: {
            centro: '/legacy/pilarnorte/assets/PILAR NORTE_v.png',
            superior: '/legacy/pilarnorte/assets/PILAR NORTE_r.png',
            inferior: '/legacy/pilarnorte/assets/PILAR NORTE_r.png',
          },
        },
        {
          code: 'pn_panel_reno',
          backendObjectCode: PILAR_EXTERNAL_OBJECT_CODE,
          name: 'PANEL RENO',
          mode: 'tri',
          keys: pilarKeys('panel reno', 'pn_panel_reno'),
          assets: {
            centro: '/legacy/pilarnorte/assets/PANEL RENO_v.png',
            superior: '/legacy/pilarnorte/assets/PANEL RENO_r.png',
            inferior: '/legacy/pilarnorte/assets/PANEL RENO_r.png',
          },
        },
        {
          code: 'pn_extension_norte_panel_reno',
          backendObjectCode: PILAR_EXTERNAL_OBJECT_CODE,
          name: 'EXTENSION NORTE PANEL RENO',
          mode: 'tri',
          keys: pilarKeys('extension norte panel reno', 'pn_extension_norte_panel_reno'),
          assets: {
            centro: '/legacy/pilarnorte/assets/EXTENSION NORTE PANEL RENO_v.png',
            superior: '/legacy/pilarnorte/assets/EXTENSION NORTE PANEL RENO_r.png',
            inferior: '/legacy/pilarnorte/assets/EXTENSION NORTE PANEL RENO_r.png',
          },
        },
      ],
    },
  ],
}
