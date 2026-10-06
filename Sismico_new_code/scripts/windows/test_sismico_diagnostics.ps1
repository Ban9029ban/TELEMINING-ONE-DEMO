# Ejemplos PowerShell para diagnóstico en entorno Codelco
curl "http://localhost:18000/api/sismico/diagnostics/diamante?live_fetch=true&persist=false"
curl "http://localhost:18000/api/sismico/diagnostics/andes_norte?live_fetch=true&persist=false"
curl "http://localhost:18000/api/sismico/diagnostics/andesita?live_fetch=true&persist=false"

# Persistir una corrida diagnóstica y luego revisar el estado funcional
curl "http://localhost:18000/api/sismico/diagnostics/andes_norte?live_fetch=true&persist=true"
curl "http://localhost:18000/api/sismico/sites/andes_norte/state"
