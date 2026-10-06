# Captura raw legacy + emuladores

## Activar captura raw por 120 minutos
Editar `docker-compose.yml` en el servicio `sismico_poller` y cambiar:

```yaml
ENABLE_LEGACY_CAPTURE: "true"
LEGACY_CAPTURE_INTERVAL_SECONDS: 30
LEGACY_CAPTURE_DURATION_MINUTES: 120
LEGACY_CAPTURE_FETCH_LINKED_IMAGES: "true"
```

Luego reconstruir:

```bash
docker compose down
docker compose up --build -d
```

## Logs
- `./logs/legacy_capture.log`
- `./logs/legacy_capture/<batch_id>/*`

## APIs nuevas
- `GET /api/sismico/capture/endpoints`
- `POST /api/sismico/capture/store`
- `GET /api/sismico/capture/captures`
- `GET /api/sismico/capture/emulator/{endpoint_code}`

## Emulador de fuente externa
Puedes apuntar un `remote_endpoint.endpoint_url` a una URL como:

```
http://backend:8000/api/sismico/capture/emulator/andes_norte_legacy_main
```

Así el sistema leerá el último payload capturado desde la base de datos.

## Emulador gráfico de semáforo
- API: `http://localhost:19090/api/emulator/semaforo/state`
- Front: `http://localhost:19091`

Para que TM One envíe al emulador, configura el dispositivo con:
- `ip = semaforo_emulator_api` (dentro de Docker) o la IP/host correspondiente
- `port = 19090`
- `plc_type = http_emulator`
- `profile = http_emulator`
