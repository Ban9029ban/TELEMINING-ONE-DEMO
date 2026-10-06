# Control de Tráfico Standalone V2 - Zenit Embed

## Inicio con un clic

Ejecuta `INICIAR_CONTROL_TRAFICO.cmd`. Detecta Zenit, crea un respaldo del frontend, incorpora el menú **Control de tráfico vial / barreras** y levanta el módulo en el puerto 8091. Zenit conserva su módulo `Semáforos control vial` sin cambios.

Para retirar solamente la integración visual, usa `DESINSTALAR_INTEGRACION_ZENIT.cmd`. No elimina la base SQLite, evidencias ni configuración del módulo.

La ruta integrada es `http://localhost:8081/control-trafico-barreras`; para otros operadores usa la IP o DNS del servidor en lugar de `localhost`.

Aplicación de control vial completamente independiente. **No modifica Zenit y no depende de su base de datos ni backend.**

## URLs

- Aplicación independiente completa: `http://localhost:8091/`
- Vista preparada para iframe/Zenit: `http://localhost:8091/embed`
- Salud API: `http://localhost:8091/api/health`

## Arranque

```powershell
docker compose up --build -d
```

Abrir primero `http://localhost:8090/` para configurar plano y barreras.

## Cómo mostrarlo dentro de Zenit sin acoplar código

Zenit solo debe apuntar su iframe/aplicación externa a la URL del módulo.

Si Zenit y Control Vial corren en Docker Desktop en el mismo PC, una URL habitual desde el navegador del usuario es:

`http://IP_DEL_PC:8090/embed`

Ejemplo:

`http://192.168.1.50:8090/embed`

Si el iframe es resuelto por el navegador local en el mismo PC también puede usarse `http://localhost:8090/embed`.

> `host.docker.internal` es útil para tráfico originado desde un contenedor, pero un iframe se carga en el navegador del operador; por eso para otros PCs usa la IP real del host.

## Modo embed

Al abrir `/embed` o `?embed=1`:

- se oculta la cabecera propia del módulo;
- el plano ocupa todo el alto disponible;
- el panel lateral es más compacto;
- siguen disponibles mando, cámara, eventos, ubicación y configuración;
- si se abre directamente sigue funcionando como aplicación independiente.

## Integración opcional por postMessage

El iframe publica mensajes al contenedor padre:

- `ready`
- `status` con número de barreras operativas y alarmas
- `barrier-selected`
- `command`

No son necesarios para operar; permiten una integración futura sin compartir base de datos ni código.

## Seguridad funcional

Zenit solo solicita abrir/cerrar. La lógica de enclavamientos, finales de carrera, cortina IR y seguridad debe permanecer en el Siemens LOGO! y en el circuito local.
