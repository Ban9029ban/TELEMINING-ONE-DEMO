param(
  [ValidateSet("sender", "receiver")]
  [string]$Target = "receiver",

  [string]$Port = "",

  [string]$Fqbn = "esp32:esp32:esp32s3",

  [switch]$Upload
)

$ErrorActionPreference = "Stop"

$cli = "C:\Program Files\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe"
if (-not (Test-Path $cli)) {
  throw "No se encontro arduino-cli en: $cli"
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$sketchPath = if ($Target -eq "sender") {
  Join-Path $PSScriptRoot "ZENIT_portico_v7_prod_sender"
} else {
  Join-Path $PSScriptRoot "ZENIT_portico_v7_prod_receiver"
}

if (-not (Test-Path $sketchPath)) {
  throw "No se encontro el sketch: $sketchPath"
}

Write-Host "Usando CLI : $cli"
Write-Host "Sketch     : $sketchPath"
Write-Host "FQBN       : $Fqbn"

& $cli compile --fqbn $Fqbn $sketchPath
if ($LASTEXITCODE -ne 0) {
  throw "Fallo la compilacion."
}

if ($Upload) {
  if ([string]::IsNullOrWhiteSpace($Port)) {
    throw "Para subir a la placa debes indicar -Port COMx junto con -Upload"
  }

  Write-Host "Subiendo a : $Port"
  & $cli upload -p $Port --fqbn $Fqbn $sketchPath
  if ($LASTEXITCODE -ne 0) {
    throw "Fallo el upload."
  }
}

