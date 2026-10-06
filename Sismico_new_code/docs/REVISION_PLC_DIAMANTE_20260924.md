# Revisión PLC Diamante — 24 de septiembre de 2026

Alcance: configuración y código en el entorno local NOCONE, contenedor zenit-sismico-api. No verifica los servidores Linux ni la programación física del PLC.

## Configuración comprobada

- PLC_ENABLED=true, PLC_DRY_RUN=false; script /app/tools/plcctl.py presente; pymodbus 3.6.9 instalado.
- Dispositivos de la matriz: diamante_cd1_tablero_1 (192.168.1.10) y diamante_cd1_tablero_2 (192.168.1.30), habilitados, Delta, Modbus TCP 502, unit-id 1.
- PIPA: normal M1 / alerta M2.
- FootPrint FW: normal M3 / alerta M4.
- FootPrint HW: normal M5 / alerta M6.
- Bajo Diamante Esmeralda: inferior M7 / centro M8 / superior M9.
- Cada cambio manual genera las escrituras para ambos tableros y desactiva las otras señales del mismo polígono.

## Verificación realizada

Se consultó la matriz con una transacción de solo lectura. Se verificaron 9 transiciones y 42 comandos a través del orquestador, SemaforoService y PlcScriptRunner, sustituyendo las conexiones, subprocesos y escrituras de auditoría por mocks. No se accionó ningún PLC ni se cambiaron estados de polígonos.

Las conexiones TCP de solo diagnóstico a ambos destinos, puerto 502, agotaron el plazo de 2 segundos. No se pudo validar respuesta Modbus ni salidas físicas desde esta red.

## Límites encontrados

1. PlcScriptRunner intenta conectar por cada orden; no hay cola ni reenvío automático de órdenes manuales fallidas al recuperar la red.
2. El polling invoca SemaforoService.evaluate_from_rules, pero esa función devuelve una lista vacía. La actualización automática sísmica no propaga estados al PLC por ese recorrido. Esto importa para Bajo Diamante Esmeralda.
3. El controlador usa el mapeo Delta M[n] = coil 2048+n. El código lo describe como mapeo de ejemplo/típico: debe contrastarse con el modelo y programa reales antes de confirmar compatibilidad física.
4. La interfaz confirma el guardado del polígono con HTTP exitoso; eso no equivale a confirmación de escritura PLC. El resultado detallado de PLC está en semaforoResult.

Conclusión: el envío manual tiene destinos y señales configurados y su recorrido se comprobó con simulación. No se certifica activación física, resincronización automática al reconectar ni propagación automática de Bajo Diamante Esmeralda.
