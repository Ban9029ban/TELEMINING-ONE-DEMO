
# TMOne Suite (Listener + Backend + Web + GUI + Firmware + Simulator)

## Rápido
```bash
docker compose up --build
# Front:    http://localhost:8081
# Backend:  http://localhost:8000/health
# Listener: http://localhost:8080/health  (TCP :7070)
# DB:       localhost:5432  zenit/zenit/zenitpass
```

## IA liviana
- El stack usa por defecto `qwen2.5:3b-instruct`, un modelo más capaz que sigue siendo viable para entornos con recursos limitados.
- La configuracion base deja `OLLAMA_NUM_CTX=512`, `OLLAMA_NUM_PREDICT=128`, `OLLAMA_LIST_TIMEOUT_SECONDS=30` y `OLLAMA_CHAT_TIMEOUT_SECONDS=60` para funcionar con poco CPU/RAM y limitar la espera del modelo a un minuto.
- Se usa un solo modelo y `OLLAMA_MAX_MODEL_ATTEMPTS=1`, sin fallback a modelos alternativos para evitar respuestas raras por cambios de modelo.
- Si quieres cambiarlo por un modelo más capaz, puedes sobreescribir `OLLAMA_MODEL` antes de levantar Docker.

## Simulador
```bash
cd simulator
python -m pip install -r requirements.txt
python simulator.py --mode http --rate 15 --entities 20
```

## Listener GUI (Windows)
```bat
cd listener_gui
run_gui.bat
```

## Firmware ESP32
- Abrir `firmware_arduino/zenit_ur_tcp_ble/zenit_ur_tcp_ble.ino` en Arduino IDE (ESP32).
- Configurar WiFi y HOST/PORT del listener, compilar y cargar.


## comandos docker

- docker compose down -v
- docker compose up --build
- docker compose logs backend --tail=100
- docker compose logs web --tail=100
- docker compose logs bd --tail=100

- docker compose restart backend
