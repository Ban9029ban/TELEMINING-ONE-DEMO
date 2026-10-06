# Demo público: preparación de despliegue

## Plataforma recomendada

Propongo Railway para el primer despliegue porque permite importar servicios desde Docker Compose y vincular el repositorio a una rama para desplegar cambios automáticamente. Cada servicio requiere configurar sus propias variables; los archivos `.env` locales no se suben. La guía oficial describe el mapeo de Compose, variables y dominios: https://docs.railway.com/guides/docker-compose

## Pendiente para publicar el enlace de aplicación

1. Crear una cuenta/proyecto Railway de la titular de este repositorio y vincular GitHub.
2. Crear los servicios de ambos sistemas desde la rama `demo` y configurar bases de datos de demostración.
3. Configurar cada panel web para usar las URL de su API.
4. Mantener PLC desactivados y usar únicamente el emulador.
5. Generar dominios públicos y verificar el acceso sin enviar órdenes físicas.

Railway puede generar dominios públicos para servicios web. El despliegue consume recursos y el costo depende del plan y uso. No hay una cuenta Railway autenticada en este equipo, por lo que todavía no existe una URL ejecutable.
