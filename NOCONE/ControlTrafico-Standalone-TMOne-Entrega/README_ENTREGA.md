# Entrega: Control de Tráfico Standalone para TM One

Esta carpeta contiene el código completo del módulo de Control de Tráfico, la interfaz, el backend FastAPI, Docker Compose y el instalador que agrega el acceso al frontend de Zenit.

No contiene bases de datos operativas, imágenes cargadas ni credenciales. Antes de usar la API con el Agente IA, copie `.env.example` como `.env` y reemplace `INTEGRATION_API_KEY` por un token aleatorio largo. Configure el mismo token como `CONTROL_TRAFFIC_API_KEY` en el backend de Zenit.

## Instalación

1. Copie esta carpeta junto al directorio raíz de Zenit, o ejecute el instalador indicando explícitamente la ruta a Zenit.
2. Ejecute `INICIAR_CONTROL_TRAFICO.cmd`. Este inicia el módulo y agrega la opción **Control de tráfico vial / barreras** en la barra lateral de Zenit.
3. Si la detección automática no encuentra Zenit, ejecute en PowerShell:

```powershell
.\installer\Install-ZenitIntegration.ps1 -ZenitRoot "C:\ruta\a\Zenit_teleminig-main"
docker compose up --build -d
```

El instalador respalda los archivos que toca en `web_front\.controltrafico-backups` y usa codificación UTF-8 sin BOM, compatible con Windows PowerShell 5.1.

## URLs

- Zenit integrado: `http://localhost:8081/control-trafico-barreras`
- Módulo directo: `http://localhost:8091/`
- API de integración de solo lectura: `http://localhost:8091/api/integration/summary`

La API de integración exige `X-Integration-Key` y no permite comandos sobre barreras.

## Contenido principal

- `app/`: backend, interfaz y API.
- `installer/Install-ZenitIntegration.ps1`: aplica únicamente la integración visual/ruta/permisos en Zenit.
- `INICIAR_CONTROL_TRAFICO.cmd`: ejecuta el instalador e inicia Docker.
- `DESINSTALAR_INTEGRACION_ZENIT.cmd`: revierte la integración visual mediante el respaldo.
