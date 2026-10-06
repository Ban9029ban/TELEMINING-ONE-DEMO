Fixtures offline para validar lectura legacy sin red Codelco.

Objetivo
- Permitir pruebas de parser, diagnóstico y fallback sin conectividad a 10.18.18.83.
- El sistema intentará usar fixture cuando falle el fetch remoto.
- También puedes precargar fixtures en external_source_capture con scripts/seed_fixture_captures.py.

Estructura soportada
fixtures/legacy/
  andes_norte/
    andes_norte_legacy_main.html
    andes_norte_legacy_inicio_caving.html
  diamante/
    diamante_legacy_resumen.html
  andesita/
    andesita_legacy_json.json

Reglas
- El nombre del archivo debe coincidir con endpoint_code.
- Se busca primero en fixtures/legacy/<site_code>/<endpoint_code>.html|json
- Luego en fixtures/legacy/<endpoint_code>.html|json
- HTML se usa para fuentes legacy web.
- JSON se usa para fuentes modernas o legacy JSON.

Flujo recomendado
1) Guardar snapshot real de la página legacy cuando vuelva la red.
2) Copiar el archivo al path del fixture correspondiente.
3) Ejecutar:
   python scripts/seed_fixture_captures.py
4) Validar:
   docker compose exec db psql -U admin -d dashboard_sismico -c "
   SELECT endpoint_code, source_origin, count(*)
   FROM external_source_capture
   GROUP BY endpoint_code, source_origin
   ORDER BY endpoint_code, source_origin;
   "

Observaciones
- linked assets (imágenes estado) se capturan automáticamente solo desde fuente remota externa.
- Si el fixture HTML referencia imágenes locales, deja esas imágenes dentro del mismo snapshot o usa capturas previas en DB.
