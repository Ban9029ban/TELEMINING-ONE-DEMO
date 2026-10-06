@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\Install-ZenitIntegration.ps1"
if errorlevel 1 pause & exit /b 1
docker compose -f "%~dp0docker-compose.yml" up --build -d
if errorlevel 1 pause & exit /b 1
start "" http://localhost:8081/control-trafico-barreras
