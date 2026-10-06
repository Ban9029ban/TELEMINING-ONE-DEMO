# Reporting de pruebas

## Logs humanos
- logs/tests/backend_unit.log
- logs/tests/backend_security.log
- logs/tests/frontend_build.log
- logs/tests/frontend_security.log
- logs/tests/smoke.log
- logs/tests/summary.log

## Artefactos estructurados
- artifacts/test-results/backend-unit-junit.xml
- artifacts/test-results/backend-unit-ruff.txt
- artifacts/test-results/backend-bandit.json
- artifacts/test-results/backend-pip-audit.json
- artifacts/test-results/frontend-npm-audit.json
- artifacts/test-results/smoke.json
- artifacts/test-results/summary.json

## Nota
Eliminar del docker-compose cualquier servicio viejo:
- test_backend
- test_frontend
- test_smoke (versión antigua)
