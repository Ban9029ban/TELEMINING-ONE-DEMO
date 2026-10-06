# Configuración visual de dashboards sísmicos

Disponible en los ocho mapas de `/legacy-sismico` y Sala SIC.

1. Iniciar sesión y abrir el mapa.
2. Pulsar **Configurar vista**. Se abre el editor y se solicita pantalla completa.
3. Arrastrar la barra del mapa o del panel de botones. Redimensionar desde la esquina inferior derecha, o elegir un recuadro y escribir X, Y, Ancho y Alto en porcentajes.
4. Pulsar **Guardar vista**. **Cancelar** descarta el borrador. **Restablecer vista** prepara la distribución inicial; requiere Guardar para persistirla.

User, operator y viewer editan únicamente su propia distribución. Admin puede elegir cualquier usuario activo antes de editar y guardar su vista, sin cambiar su propia distribución. Los cambios de Admin se recuperan en la pantalla del destinatario en un máximo de 15 segundos mientras no esté editando. La distribución se aplica en pantalla completa o modo `?pantalla=1`.

Además del mapa y botones, el editor incluye los recuadros de proyecto, conexión, controles, mapa 3D y alertas que estén presentes. En Sala SIC se ajustan los recuadros de los mapas seleccionados y sus controles. Los controles existentes de selección de proyectos siguen determinando qué recuadros se muestran. El editor no cambia los permisos de operación de semáforos ni los estados sísmicos.

## Persistencia y actualización

Las tablas `sismico_visual_layout` y `sismico_visual_session` se crean mediante `Base.metadata.create_all` al iniciar el backend. La clave de la vista es usuario + mapa. Las sesiones nuevas son aleatorias, expiran a los 30 días y se almacena únicamente su hash. Las sesiones antiguas `demo-token-*` requieren volver a iniciar sesión para acceder al editor. Las credenciales actuales se conservan.

Para aplicar los cambios en el servidor donde corre este proyecto, actualizar backend y frontend con el archivo Compose correspondiente al ambiente. Para el Compose base:

```sh
docker compose build backend frontend
docker compose up -d --no-deps backend frontend
```

La integración NOCONE incorpora `allowFullScreen` en su iframe sísmico; también debe actualizarse su frontend para permitir pantalla completa desde la vista embebida. Estos cambios locales no actualizan automáticamente `devtm.denial.cl`.

## Verificación

```sh
cd backend
python -m pytest tests/test_visual_layout.py -q
cd ../frontend
npm run test:visual
npm run build
```

Las pruebas cubren guardado/recarga en los nueve tableros, aislamiento por usuario y mapa, asignación Admin, sesiones falsas/expiradas, usuarios desactivados, límites de geometría, cancelación, selección de destinatario y reintento de guardado.

La suite general también presenta tres fallos previos (filtro del agente, inventario de rutas con la versión instalada de FastAPI y alias de polígonos), reproducidos sobre HEAD sin estos cambios. En Windows, otra prueba encuentra un permiso denegado en el directorio temporal compartido de pytest. No hay navegador conectado para la revisión visual; la validación del editor se hizo con pruebas de DOM, geometría y API.


## Integración activa en NOCONE

NOCONE sirve la interfaz actualizada en `/legacy-sismico/` cuando la fuente configurada es el dashboard `devtm.denial.cl:15173/legacy-sismico`. Su nginx mantiene el flujo operacional mediante `/sismico-source-api/` hacia el backend remoto existente. Las credenciales de NOCONE no se reenvían a ese servidor.

Las preferencias y el selector Admin usan las cuentas de NOCONE a través de `/api/sismico-ui/`. Se guardan en `app_setting` con clave estable `sismico_visual:<id_usuario>:<mapa>`; el servidor valida la sesión y el rol. La apertura en `localhost:8081` no necesita desplegar el servidor remoto ni una segunda cuenta sísmica.

Para reconstruir la integración después de modificar este proyecto:

```powershell
python scripts/bundle_nocone.py "C:/Users/Ban Albrecht/Desktop/Desarrollo/NOCONE"
```

Luego, desde NOCONE: `docker compose build backend web` y `docker compose up -d --no-deps backend web`.

El archivo independiente sigue funcionando con el backend propio de Sismico_new_code; la integración usa variables de compilación y no sustituye su modo normal.

El botón Configurar vista se integra en el encabezado junto al usuario. En pantalla completa el encabezado conserva su espacio y los porcentajes se calculan sobre el área disponible debajo. Los paneles conservan sus nodos al entrar y salir de edición; las barras de movimiento no alteran su altura interna.
