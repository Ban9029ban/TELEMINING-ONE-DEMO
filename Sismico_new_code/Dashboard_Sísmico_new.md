
# Dashboard_Sísmico_new

## Descripción general

**Dashboard_Sísmico_new** es una plataforma de monitoreo operacional diseñada para supervisar estados sísmicos, eventos operacionales y sistemas de control vial en tiempo real dentro de entornos industriales como minería o infraestructura crítica.

El sistema fue diseñado como evolución del sistema legado **TM One**, permitiendo:

- Monitoreo de múltiples **empresas**
- Gestión de múltiples **sites / faenas**
- Visualización de **mapas con polígonos operacionales**
- Cambio de estados visuales en tiempo real
- Generación automática de **alertas**
- Activación automática de **semaforización vial**
- Integración futura con **Agentes IA (MCP + Ollama)**
- Arquitectura moderna **API REST + React + PostgreSQL**
- Despliegue completo mediante **Docker**

---

# Arquitectura del sistema

El sistema se divide en cuatro capas principales.

```
React Frontend
        |
FastAPI Backend (API REST)
        |
PostgreSQL Database
        |
Servicios auxiliares
   ├── Polling de endpoints remotos
   ├── Motor de alertas
   ├── Control semáforos
   └── Integración IA (Ollama / MCP)
```

---

# Tecnologías utilizadas

## Backend
- Python 3.11
- FastAPI
- SQLAlchemy
- Uvicorn

## Frontend
- React
- Vite
- Leaflet / SVG overlays para mapas

## Base de datos
- PostgreSQL 15

## Inteligencia artificial
- Ollama (LLM local)
- MCP Agent (futuro)

## Infraestructura
- Docker
- Docker Compose

---

# Estructura del proyecto

```
Dashboard_Sísmico_new
│
├── backend
│   ├── app
│   │   ├── api
│   │   ├── models
│   │   ├── services
│   │   └── main.py
│   ├── requirements.txt
│   └── Dockerfile
│
├── frontend
│   ├── src
│   │   ├── pages
│   │   ├── components
│   │   └── services
│   └── index.html
│
├── db
│   └── init.sql
│
├── docker-compose.yml
│
└── README.md
```

---

# Modelo conceptual del sistema

## Entidades principales

### Organización
Representa una empresa o cliente.

### Site
Ubicación o faena operacional.

### Map
Plano visual del site.

### Map Object
Objeto geográfico dentro del mapa.

Ejemplos:

- Polígonos sísmicos
- Portales
- Zonas de seguridad
- Accesos
- Semáforos

### Endpoint remoto
Fuente de datos externa que se consulta periódicamente.

### Evento operacional
Cambio de estado detectado en un objeto del mapa.

### Alerta
Evento crítico generado automáticamente por reglas.

### Dispositivo semafórico
Controlador físico de señalización vial.

---

# Funcionalidades principales

## 1 Monitoreo de polígonos

Cada polígono del mapa puede cambiar de estado:

| Estado | Color |
|------|------|
| Normal | Verde |
| Advertencia | Amarillo |
| Crítico | Rojo |

Estos estados provienen de:

- endpoints remotos
- análisis automático
- operadores manuales

---

# 2 Lectura de endpoints remotos

El sistema consulta múltiples fuentes de datos:

- APIs REST
- HTML scraping
- archivos CSV
- imágenes con estados
- PLC / sensores

El polling es realizado por un scheduler interno.

---

# 3 Generación de alertas

Cuando se detecta una condición crítica se genera:

- alerta operacional
- registro histórico
- notificación en dashboard

Opcionalmente puede activar acciones automáticas.

---

# 4 Control automático de semáforos

El sistema puede ejecutar comandos del tipo:

```
ipsemaforo <ip> <accion>
```

Ejemplo:

```
ipsemaforo 192.168.1.10 rojo
```

Esto permite:

- bloquear accesos
- activar evacuación
- cambiar señalización vial

---

# 5 Monitoreo de pantallas

Cada pantalla del sistema envía un **heartbeat**.

El servidor puede detectar:

- pantallas online
- pantallas offline
- URL activa
- estado del navegador

Esto permite administrar centros de monitoreo.

---

# 6 Dashboard central

El panel principal incluye:

- estado por site
- estado de polígonos
- alertas activas
- endpoints conectados
- pantallas activas
- gráficos operacionales

---

# 7 Integración futura con IA

El sistema integrará un **Agente IA** basado en:

- MCP
- Ollama

Capacidades previstas:

- análisis de eventos
- interpretación de estados sísmicos
- generación automática de reportes
- consultas en lenguaje natural

Ejemplo:

"¿Qué zonas tienen mayor tiempo en estado crítico hoy?"

---

# Despliegue del sistema

## Requisitos

- Docker
- Docker Compose

---

## Levantar el sistema

Desde la carpeta raíz:

```
docker compose up --build
```

---

# Servicios levantados

| Servicio | Puerto |
|------|------|
Frontend | 5173 |
Backend API | 8000 |
PostgreSQL | 5432 |
Ollama | 11434 |

---

# Acceso

Frontend:

```
http://localhost:5173
```

Backend:

```
http://localhost:8000/docs
```

---

# Roadmap

Fases futuras del sistema:

1️⃣ Migración completa del sistema legado  
2️⃣ Implementación completa de mapas interactivos  
3️⃣ Motor de reglas operacionales  
4️⃣ Control real de semáforos  
5️⃣ Integración completa con MCP Agent  
6️⃣ Análisis IA sobre eventos históricos  

---

# Autor

Proyecto desarrollado para evolución del sistema **TM One / Telemining** hacia una plataforma moderna de monitoreo operacional.
