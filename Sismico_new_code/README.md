# Dashboard Sísmico – TM One (Telemining)

Plataforma de monitoreo operacional e integración industrial para supervisión sísmica, visualización cartográfica, captura de fuentes externas y control de semáforos físicos mediante PLC.

Este proyecto corresponde a la evolución del ecosistema **TM One / Telemining**, modernizando una base legacy hacia una arquitectura desacoplada basada en:

- **Frontend React + Vite**
- **Backend FastAPI**
- **PostgreSQL**
- **Docker / Docker Compose**
- **Integración PLC / Modbus TCP**
- **Captura y emulación de fuentes legacy**
- **Base preparada para control industrial, pantallas, configuración y extensibilidad**

---

## 1. Objetivo del sistema

El sistema permite:

- monitorear estados sísmicos por sitio/faena
- visualizar mapas y polígonos operacionales
- recibir y procesar datos desde fuentes externas
- activar alertas operacionales
- controlar semáforos físicos y emulados
- administrar pantallas de monitoreo
- capturar y emular fuentes legacy
- preparar integración con automatización avanzada e IA

Está orientado a operación en contextos industriales críticos como:

- minería
- túneles
- accesos viales
- salas de monitoreo
- entornos OT / ICS

---

## 2. Componentes principales

### 2.1 Frontend
Aplicación web de operación y configuración.

#### Responsabilidades
- mostrar dashboard sísmico por sitio
- renderizar mapas y polígonos
- mostrar alertas y estados
- operar cambios manuales
- mostrar pantallas muro / vistas legacy
- administrar configuración del sistema

#### Stack
- React
- Vite
- JavaScript
- CSS
- Leaflet / overlays SVG

---

### 2.2 Backend
API principal del sistema.

#### Responsabilidades
- exponer contratos REST
- servir estado sísmico por sitio
- orquestar captura de fuentes
- persistir estados y configuraciones
- controlar semáforos
- exponer emuladores
- manejar heartbeats de pantallas
- centralizar lógica operacional

#### Stack
- Python 3.11
- FastAPI
- SQLAlchemy
- Uvicorn
- Pydantic

---

### 2.3 Base de datos
Persistencia del sistema.

#### Responsabilidades
- configuración de empresas, sitios y mapas
- objetos cartográficos
- fuentes externas
- estados
- alertas
- pantallas
- semáforos
- logs operacionales

#### Stack
- PostgreSQL 15

---

### 2.4 Servicios auxiliares
Procesos y servicios complementarios.

#### Incluye
- polling de endpoints remotos
- captura raw legacy
- emuladores
- control PLC
- procesos de heartbeat
- scheduler interno

---

### 2.5 Integración industrial
Capa encargada de interacción con hardware y simuladores.

#### Incluye
- PLC Delta / Modbus TCP
- control de señales Mxx
- emulador HTTP de semáforo
- integración futura con más perfiles PLC

---

## 3. Arquitectura general

### Vista lógica

```text
Frontend React/Vite
        |
        v
Backend FastAPI
        |
        v
PostgreSQL
        |
        +--> Poller de endpoints remotos
        +--> Captura legacy
        +--> Emulador de fuentes externas
        +--> Emulador de semáforo
        +--> Control PLC / plcctl.py
```

### Vista por capas

#### Capa de presentación
- React
- páginas sísmicas
- configuración
- pantallas muro
- login / sesión

#### Capa de aplicación
- routers FastAPI
- servicios
- contratos API
- lógica operacional

#### Capa de dominio
- sitios
- mapas
- polígonos
- estados
- alertas
- semáforos
- pantallas

#### Capa de infraestructura
- PostgreSQL
- Docker
- scripts
- herramientas PLC
- logs
- scheduler

---

## 4. Tecnologías utilizadas

### Backend
- Python 3.11
- FastAPI
- SQLAlchemy
- Uvicorn
- Pydantic

### Frontend
- React
- Vite
- JavaScript
- CSS
- Leaflet / SVG overlays

### Base de datos
- PostgreSQL 15

### Infraestructura
- Docker
- Docker Compose

### Integración industrial
- Modbus TCP
- PLC Delta
- scripts Python auxiliares para control

### IA / extensibilidad futura
- Ollama
- MCP Agent

---

## 5. Estructura del proyecto

```text
.
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   └── routes/
│   │   ├── models/
│   │   ├── services/
│   │   ├── schemas/
│   │   ├── db/
│   │   └── main.py
│   ├── tools/
│   │   └── plcctl.py
│   ├── requirements.txt
│   └── Dockerfile
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── context/
│   │   ├── services/
│   │   ├── utils/
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── public/
│   ├── package.json
│   └── vite.config.js
│
├── db/
│   ├── init.sql
│   └── scripts_sql/
│
├── scripts/
│   └── windows/
│
├── logs/
├── docker-compose.yml
└── README.md
```

---

## 6. Modelo conceptual

### 6.1 Organización
Entidad empresa o cliente.

### 6.2 Site
Faena, proyecto o ubicación operacional.

### 6.3 Map
Plano visual asociado a un sitio.

### 6.4 Map Object
Objeto geográfico del mapa.

#### Ejemplos
- polígono sísmico
- acceso
- semáforo
- zona segura
- portal
- área crítica

### 6.5 Endpoint remoto
Fuente de datos externa consultada periódicamente.

### 6.6 Evento operacional
Cambio de estado detectado.

### 6.7 Alerta
Condición crítica o relevante generada desde reglas o estados.

### 6.8 Dispositivo semafórico
Elemento físico o emulado para control de señalización.

### 6.9 Pantalla
Cliente visualizador de una vista sísmica o muro de operación.

---

## 7. Funcionalidades principales

### 7.1 Monitoreo sísmico
Visualización de estados por sitio y polígono.

#### Estados típicos
- Normal
- Advertencia
- Crítico
- Inferior
- Centro
- Superior
- Emergencia

---

### 7.2 Visualización cartográfica
Cada sitio puede mostrar:
- mapa principal
- polígonos
- overlays
- etiquetas
- último registro
- estado de fuentes externas

---

### 7.3 Lectura de fuentes externas
El sistema puede consultar fuentes tipo:
- APIs REST
- HTML legacy
- CSV
- imágenes
- payloads capturados
- emuladores internos

---

### 7.4 Captura legacy
Permite capturar respuestas raw desde sistemas antiguos para:
- análisis
- persistencia
- emulación
- desacople del origen real

---

### 7.5 Emulación de fuentes externas
Una fuente remota puede apuntarse al backend para devolver el último payload capturado y simular una fuente operativa.

---

### 7.6 Control de semáforos
El sistema soporta:
- emulador HTTP
- control PLC
- dry-run
- integración futura con matrices más avanzadas

---

### 7.7 Monitoreo de pantallas
Registro de estado de pantallas:
- online/offline
- última URL
- heartbeat

---

### 7.8 Administración
Pantalla de configuración para gestionar:
- usuarios
- empresas
- pantallas
- semáforos
- fuentes externas
- polígonos
- parámetros del sistema

---

## 8. Núcleo sísmico reusable

El proyecto incluye un contrato reusable backend/frontend para minas sísmicas.

### Endpoints expuestos
- `GET /api/sismico/sites`
- `GET /api/sismico/sites/{site_code}`
- `GET /api/sismico/sites/{site_code}/state`

### Objetivo
Evitar hardcode excesivo por pantalla o por mina y centralizar el consumo desde una API uniforme.

### Sitios base considerados
- Diamante
- Andesita
- Andes Norte

---

## 9. Captura raw legacy y emuladores

### Activación de captura legacy

Editar `docker-compose.yml` en el servicio correspondiente y activar:

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

### Logs
- `./logs/legacy_capture.log`
- `./logs/legacy_capture/<batch_id>/*`

### APIs disponibles
- `GET /api/sismico/capture/endpoints`
- `POST /api/sismico/capture/store`
- `GET /api/sismico/capture/captures`
- `GET /api/sismico/capture/emulator/{endpoint_code}`

### Emulador de fuente externa
Puede configurarse un `remote_endpoint.endpoint_url` apuntando a una ruta como:

```text
http://backend:8000/api/sismico/capture/emulator/andes_norte_legacy_main
```

Con eso el sistema leerá desde el payload capturado más reciente.

### Emulador gráfico de semáforo
- API: `http://localhost:19090/api/emulator/semaforo/state`
- Front: `http://localhost:19091`

Configuración del dispositivo para usar emulador:
- `ip = semaforo_emulator_api`
- `port = 19090`
- `plc_type = http_emulator`
- `profile = http_emulator`

---

## 10. Entornos y perfiles de despliegue

### Local
- Frontend: `localhost:15173`
- Backend: `localhost:18000`
- PostgreSQL: `localhost:15432`
- PLC en dry-run por defecto

### QA
- mismo stack Docker Compose
- variables CORS y `PUBLIC_API_BASE_URL` propias del entorno QA

### On-premise
- backend habla directo con PLC usando `backend/tools/plcctl.py`
- cambiar `PLC_DRY_RUN=false` solo en entorno controlado

### Cloud
- mantener PLC en dry-run salvo que exista conectividad segura con red OT

---

## 11. Cómo compilar y ejecutar

### 11.1 Opción recomendada: Docker Compose

#### Levantar todo el sistema
```bash
docker compose up --build
```

#### Levantar en background
```bash
docker compose up --build -d
```

#### Detener
```bash
docker compose down
```

#### Reconstruir completamente
```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

---

### 11.2 Backend local sin Docker

Entrar a `backend/` e instalar dependencias:

```bash
pip install -r requirements.txt
```

Levantar API:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

---

### 11.3 Frontend local sin Docker

Entrar a `frontend/`:

```bash
npm install
npm run dev
```

Build productivo:

```bash
npm run build
```

Preview local:

```bash
npm run preview
```

---

## 12. Servicios y puertos

### Puertos típicos
| Servicio | Puerto |
|---------|--------|
| Frontend | 5173 |
| Backend API | 8000 |
| PostgreSQL | 5432 |
| Ollama | 11434 |
| Emulador semáforo API | 19090 |
| Emulador semáforo Front | 19091 |

### En perfil local alternativo
| Servicio | Puerto |
|---------|--------|
| Frontend | 15173 |
| Backend | 18000 |
| PostgreSQL | 15432 |

---

## 13. Accesos principales

### Frontend
`http://localhost:5173`

o según perfil local:
`http://localhost:15173`

### Backend
`http://localhost:8000/docs`

---

## 14. Endpoints REST del backend

> Nota: algunos endpoints pueden variar según el estado de la rama o patches aplicados, pero esta es la base principal del proyecto y de su evolución reciente.

### 14.1 API sísmica
- `GET /api/sismico/sites`
- `GET /api/sismico/sites/{site_code}`
- `GET /api/sismico/sites/{site_code}/state`

### 14.2 Captura legacy
- `GET /api/sismico/capture/endpoints`
- `POST /api/sismico/capture/store`
- `GET /api/sismico/capture/captures`
- `GET /api/sismico/capture/emulator/{endpoint_code}`

### 14.3 Semáforos / control
- `POST /api/semaforos/execute-all`
- `GET /api/semaforos/devices`
- `GET /api/semaforos/logs`

### 14.4 Operación sísmica manual
- `POST /api/sismico-operator/state`
- `GET /api/sismico-operator/current-state`

### 14.5 Configuración / administración
- `GET /api/config-admin/companies`
- `GET /api/config-admin/sites`
- `GET /api/config-admin/maps`
- `GET /api/config-admin/map-objects`
- `GET /api/config-admin/polygons`
- `GET /api/config-admin/semaforos`
- `POST /api/config-admin/semaforos`
- `PUT /api/config-admin/semaforos/{id}`
- `DELETE /api/config-admin/semaforos/{id}`
- `GET /api/config-admin/screens`
- `POST /api/config-admin/screens`
- `PUT /api/config-admin/screens/{id}`
- `DELETE /api/config-admin/screens/{id}`
- `GET /api/config-admin/external-sources`
- `POST /api/config-admin/external-sources`
- `PUT /api/config-admin/external-sources/{id}`
- `DELETE /api/config-admin/external-sources/{id}`

### 14.6 Pantallas / heartbeat
- `POST /api/screens/heartbeat`
- `GET /api/screens/status`
- `GET /api/screens/{screen_code}`

### 14.7 Autenticación
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`

### 14.8 Diagnóstico
- `GET /api/diagnostico/health`
- `GET /api/diagnostico/plc`
- `GET /api/diagnostico/screens`

### 14.9 Emulador de semáforo
- `POST /api/emulator/semaforo/state`
- `GET /api/emulator/semaforo/state`

---

## 15. Flujo operativo general

1. el sistema consulta fuentes externas
2. procesa estados por sitio y polígono
3. persiste estado resultante
4. muestra cambios en dashboard y mapas
5. genera alertas si corresponde
6. opcionalmente activa semáforos o emuladores
7. registra heartbeats de pantallas

---

## 16. Control de semáforos y operación industrial

### Modos soportados
- dry-run
- emulador HTTP
- PLC real

### Consideraciones
- no activar PLC real fuera de entorno controlado
- validar conectividad antes de salir de dry-run
- revisar logs y timeouts
- mantener separación clara entre prueba y terreno

### Flujo conceptual
```text
Frontend -> Backend -> Servicio semáforo -> plcctl.py / emulador -> PLC o simulador
```

---

## 17. Logs y observabilidad

### Ejemplos de logs relevantes
- captura legacy
- polling remoto
- actualización de estados
- heartbeats de pantallas
- ejecución de semáforos
- errores API

### Rutas típicas
- `./logs/legacy_capture.log`
- `./logs/legacy_capture/<batch_id>/`

---

## 18. Desarrollo y extensibilidad

Preparado para crecer hacia:
- más minas / sitios
- más mapas
- más fuentes externas
- más tipos de semáforo
- matrices avanzadas de control PLC
- roles y permisos más granulares
- licenciamiento y control de pantallas
- integración IA

---

## 19. Roadmap

Fases previstas:
1. migración completa del legado TM One
2. consolidación de mapas interactivos
3. motor de reglas operacionales
4. control real de semáforos PLC
5. integración con MCP Agent
6. analítica histórica e IA

---

## 20. Buenas prácticas de operación

- usar Docker Compose como forma principal de despliegue
- mantener `PLC_DRY_RUN=true` fuera de terreno controlado
- respaldar configuración antes de aplicar cambios
- separar ambientes local / QA / on-premise
- revisar logs después de cambios en polling o emulación
- validar puertos y CORS por ambiente

---

## 21. Comandos Git útiles

### Igualar ramas a `test`
```bash
git checkout test
git pull origin test

git checkout master
git reset --hard test
git push origin master --force

git checkout develop
git reset --hard test
git push origin develop --force

git checkout staging
git reset --hard test
git push origin staging --force

git checkout test
```

### Crear tag de control
```bash
git checkout test
git tag -a control-dashboard-sismico -m "Punto de control Dashboard Sísmico"
git push origin control-dashboard-sismico
```

---

## 22. Próximos pasos recomendados

1. conectar polling real a la capa sísmica principal
2. persistir histórico de estados
3. incorporar más sitios al registro unificado
4. formalizar matrices de control PLC
5. reforzar seguridad de pantallas y acceso por dispositivo

---

## 23. Autor y contexto

Proyecto desarrollado como evolución de **TM One / Telemining** hacia una plataforma moderna de monitoreo operacional, visualización sísmica e integración industrial.
