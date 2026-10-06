# Arquitectura

Zenit (opcional, sólo enlace/iframe)
            |
            | HTTP URL
            v
Control de Tráfico Standalone :8090
  - FastAPI
  - HMI web estática
  - SQLite independiente
  - almacenamiento de plano/evidencias
            |
            | Modbus TCP
            v
       Siemens LOGO!

No hay importaciones, tablas, rutas ni servicios compartidos con Zenit.
