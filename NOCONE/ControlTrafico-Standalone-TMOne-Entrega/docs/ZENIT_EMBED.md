# Embebido en Zenit

Control Vial se ejecuta como servicio separado en TCP 8090. Zenit solo lo presenta en un iframe: no comparte su base de datos, API ni autenticación.

```text
Zenit UI → iframe → Control Vial :8090 → Modbus TCP → Siemens LOGO!
```

## Integración recomendada

En la vista o componente de Zenit donde debe aparecer el módulo, agrega un iframe con la IP accesible para el navegador de los operadores. Indica además el origen exacto de Zenit para proteger el intercambio de mensajes.

```html
<iframe
  id="control-trafico"
  title="Control de tráfico"
  src="http://192.168.1.50:8090/embed?parentOrigin=https%3A%2F%2Fzenit.midominio.cl"
  style="width:100%; height:calc(100vh - 120px); border:0"
  allow="fullscreen">
</iframe>
```

Reemplaza `192.168.1.50` por la IP o DNS del host de Control Vial y `https://zenit.midominio.cl` por el origen real de Zenit (esquema, host y puerto, sin ruta final). Si ambas aplicaciones se sirven desde el mismo origen, el parámetro puede omitirse. Para un iframe desde otro PC, no uses `localhost`.

Si Zenit aplica una política CSP, incluye el origen de Control Vial en `frame-src`; en servidores que usen `frame-ancestors`, permite el origen de Zenit. El módulo requiere acceso del navegador a `cdn.jsdelivr.net` para cargar Driver.js, la biblioteca del recorrido inicial. Para entornos aislados, descarga esos dos archivos de Driver.js y sírvelos desde `/static/vendor/`.

## Mensajes opcionales

El iframe emite `postMessage` con `source: 'control-trafico'` y tipos `ready`, `status`, `barrier-selected`, `command` y `pong`. Zenit puede escuchar esos eventos así:

```js
window.addEventListener('message', (event) => {
  if (event.origin !== 'http://192.168.1.50:8090') return;
  const message = event.data;
  if (message?.source !== 'control-trafico') return;
  if (message.type === 'status') {
    // message.operational y message.alarms
  }
});
```

Para solicitar acciones desde Zenit, manda el mensaje al iframe, siempre indicando el origen del módulo:

```js
const frame = document.querySelector('#control-trafico');
const moduleOrigin = 'http://192.168.1.50:8090';
frame.contentWindow.postMessage({ source: 'zenit', type: 'refresh' }, moduleOrigin);
// También: { source: 'zenit', type: 'ping' } o { source: 'zenit', type: 'start-tour' }
```

La lógica de enclavamientos, finales de carrera y seguridad debe permanecer en Siemens LOGO! y en el circuito local; Zenit y el iframe solo solicitan apertura/cierre.
