# Arquitectura y perfiles de despliegue

## Local
- Frontend en `localhost:15173`
- Backend en `localhost:18000`
- PostgreSQL en `localhost:15432`
- PLC en dry-run por defecto

## QA
- Mismo stack Docker Compose
- CORS y `PUBLIC_API_BASE_URL` específicos del dominio QA

## On-premise
- Backend habla directo con PLC usando `backend/tools/plcctl.py`
- Cambiar `PLC_DRY_RUN=false` solo en entorno controlado

## Cloud
- Mantener PLC en dry-run salvo que exista conectividad segura a la red OT
- Reutilizar la misma capa de settings
