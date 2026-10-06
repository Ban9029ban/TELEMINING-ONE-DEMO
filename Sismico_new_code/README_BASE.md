# Entregables 1, 2 y 3 — Núcleo sísmico reusable

Este paquete deja implementado un primer contrato backend/frontend reutilizable para minas sísmicas.

## Incluye

### Backend
- `backend/app/api/routes/sismico.py`
- `backend/app/schemas/sismico_contract.py`
- `backend/app/services/sismico_service.py`
- `backend/app/main.py` (modificado para registrar el router)

### Frontend
- `frontend/src/services/sismicoApi.js`
- `frontend/src/hooks/useSismicoSite.js`
- `frontend/src/pages/SismicoSitePage.jsx`
- `frontend/src/components/sismico/SismicoLegend.jsx`
- `frontend/src/components/sismico/SismicoSourceStatus.jsx`
- `frontend/src/components/sismico/SismicoLastSync.jsx`
- `frontend/src/components/sismico/SismicoAlertsPanel.jsx`
- `frontend/src/components/sismico/SismicoStateTable.jsx`
- `frontend/src/pages/DiamantePage.jsx` (wrapper)
- `frontend/src/pages/AndesitaPage.jsx` (wrapper)
- `frontend/src/pages/AndesNortePage.jsx` (wrapper)
- `frontend/src/App.jsx` (ajuste mínimo para mantener rutas actuales)

## Contrato nuevo expuesto
- `GET /api/sismico/sites`
- `GET /api/sismico/sites/{site_code}`
- `GET /api/sismico/sites/{site_code}/state`

## Notas
- Este entregable **no reemplaza todavía** el polling real productivo. La estructura queda preparada para eso.
- La definición de minas usa un **registro base controlado** en backend para Diamante, Andesita y Andes Norte.
- Si existen datos en BD para `site`, `site_map` y `map_object`, se incorporan automáticamente.
- El frontend deja de depender del hardcode de cada pantalla y usa una sola página genérica por mina.

## Instalación sugerida
1. Respaldar archivos actuales.
2. Copiar cada archivo del ZIP sobre la misma ruta en tu proyecto.
3. Reiniciar backend y frontend con rebuild.

## Siguiente paso recomendado
Después de validar estas pantallas:
1. conectar polling real a `sismico_service.py`
2. persistir histórico de estados
3. agregar `Pilar Norte` al registro unificado
