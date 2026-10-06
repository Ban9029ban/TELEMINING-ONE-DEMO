import { API_ROOT } from './services/apiBase'

export const API = API_ROOT
export const REMOTE_HTML = `${API}/proxy/resumen`
export const REMOTE_JSON = `${API}/api/poligonos`

export const DIAMANTE_OVERLAYS = {
  'Diamante PIPA': {
    normal: '/legacy/diamante/VPIPA.png',
    alerta: '/legacy/diamante/PIPA.png',
  },
  'FootPrint HW': {
    normal: '/legacy/diamante/VHW.png',
    alerta: '/legacy/diamante/HW.png',
  },
  'FootPrint FW': {
    normal: '/legacy/diamante/VFW.png',
    alerta: '/legacy/diamante/FW.png',
  },
  'Bajo Diamante Esmeralda': {
    inferior: '/legacy/diamante/BDA.png',
    centro: '/legacy/diamante/VBDA.png',
    superior: '/legacy/diamante/BDA.png',
  },
}
