param([string]$ZenitRoot = "")

$ErrorActionPreference = 'Stop'
$moduleRoot = Split-Path -Parent $PSScriptRoot

function Set-Utf8NoBom([string]$Path, [string]$Content) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Add-Once([string]$Path, [string]$Detection, [string]$Anchor, [string]$Addition) {
  $text = Get-Content -LiteralPath $Path -Raw
  if ($text -match $Detection) { return }
  if (-not $text.Contains($Anchor)) { throw "No se encontró el punto de integración esperado en $Path" }
  Set-Utf8NoBom $Path ($text.Replace($Anchor, "$Anchor`r`n$Addition"))
}

if (-not $ZenitRoot) {
  $candidate = Get-ChildItem (Split-Path -Parent $moduleRoot) -Directory -Recurse -Depth 3 -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName 'web_front\src\components\Sidebar.jsx') } |
    Select-Object -First 1
  if ($candidate) { $ZenitRoot = $candidate.FullName }
}

if (-not $ZenitRoot -or -not (Test-Path (Join-Path $ZenitRoot 'web_front\src\components\Sidebar.jsx'))) {
  throw 'No fue posible encontrar Zenit. Ejecute: .\installer\Install-ZenitIntegration.ps1 -ZenitRoot "C:\ruta\a\Zenit_teleminig-main"'
}

$front = Join-Path $ZenitRoot 'web_front'
$marker = Join-Path $front '.control-trafico-barreras-installed.json'
if (Test-Path $marker) { Write-Host 'La integración de Control de Tráfico ya está instalada.'; exit 0 }

$files = @('src\components\Sidebar.jsx','src\routes\General.jsx','src\utils\accessControl.js','src\pages\ControlTraficoBarreras\index.jsx')
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$backup = Join-Path $front ".controltrafico-backups\$stamp"
New-Item -ItemType Directory -Force -Path $backup | Out-Null
foreach ($file in $files) {
  $src = Join-Path $front $file
  if (Test-Path $src) {
    $dst = Join-Path $backup $file
    New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
    Copy-Item -LiteralPath $src -Destination $dst -Force
  }
}

$sidebar = Join-Path $front 'src\components\Sidebar.jsx'
Add-Once $sidebar 'FaRoadBarrier' 'import { FaTrafficLight } from "react-icons/fa";' 'import { FaRoadBarrier } from "react-icons/fa6";'
Add-Once $sidebar 'path: "/control-trafico-barreras"' '  { path: "/productividad"' '  { path: "/control-trafico-barreras", label: "Control de tráfico vial / barreras", icon: <FaRoadBarrier size={11} />, multiline: true },'

$routes = Join-Path $front 'src\routes\General.jsx'
Add-Once $routes 'ControlTraficoBarreras' 'import SemaforosVial from "../pages/SemaforosVial";' 'import ControlTraficoBarreras from "../pages/ControlTraficoBarreras";'
Add-Once $routes 'path="/control-trafico-barreras"' '      </Route>' '        <Route path="/control-trafico-barreras" element={<ProtectedModuleRoute path="/control-trafico-barreras"><ControlTraficoBarreras /></ProtectedModuleRoute>} />'

$access = Join-Path $front 'src\utils\accessControl.js'
Add-Once $access 'path: "/control-trafico-barreras"' '{ path: "/semaforos-control-vial", label: "Semáforos control vial", permissionKeys: ["control_vial:control_vial"] },' '{ path: "/control-trafico-barreras", label: "Control de tráfico vial / barreras", permissionKeys: ["control_vial:control_vial"] },'

$page = Join-Path $front 'src\pages\ControlTraficoBarreras\index.jsx'
New-Item -ItemType Directory -Force -Path (Split-Path $page) | Out-Null
if (-not (Test-Path $page)) {
  Set-Utf8NoBom $page @'
import React from "react";

export default function ControlTraficoBarreras() {
  const url = window.__ENV?.CONTROL_TRAFICO_BARRERAS_URL || `${window.location.protocol}//${window.location.hostname}:8091/embed`;
  return <div className="h-[calc(100vh-1px)] w-full overflow-hidden bg-slate-950"><iframe title="Control de tráfico vial / barreras" src={url} className="h-full w-full border-0" allow="autoplay; fullscreen" /></div>;
}
'@
}

$info = @{ module = 'control-trafico-barreras'; version = '2.3.0'; route = '/control-trafico-barreras'; backup = $backup; installed_at = (Get-Date).ToString('o') } | ConvertTo-Json
Set-Utf8NoBom $marker $info
Write-Host "Integración instalada. Respaldo: $backup"
