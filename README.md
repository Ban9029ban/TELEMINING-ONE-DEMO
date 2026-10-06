# TELEMINING ONE DEMO

Repositorio independiente para mostrar avances de NOCONE (Zenit Telemining) y del panel Sísmico. Es propiedad de `Ban9029ban`; no modifica los repositorios originales ni sus ramas `main`, `develop` o `staging`.

## Carpetas

- `NOCONE/`: aplicación Zenit Telemining y módulo Control de tráfico vial / barreras.
- `Sismico_new_code/`: panel sísmico y servicios auxiliares.

## Ramas

- `main`: base estable del demo.
- `develop`: integración de cambios.
- `demo`: versión que se conecta al despliegue público.

## Seguridad del demo

Este repositorio no debe conectarse a PLC, cámaras, lectores ni bases de datos de producción. Los `.env` locales, bases de datos y credenciales no se versionan. Configura servicios simulados y credenciales de prueba para cualquier despliegue público.

## Despliegue

Revisa `docs/DEMO_DEPLOY.md` antes de publicar. Los dos sistemas requieren backend y base de datos; GitHub aloja el código, no ejecuta por sí mismo los contenedores.
