$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot

$targets = @(
    'frontend/public/legacy/andesnorte/ANNI',
    'frontend/public/legacy/ANNI',
    'frontend/public/assets/legacy/ANNI'
)

$files = @(
    '7475.png',
    '7475_v.png',
    'ADIT7475.png',
    'ADIT7475_am.png',
    'ADIT7475_v.png',
    'AN NORTE FW.png',
    'AN NORTE FW_v.png',
    'AN NORTE HW.png',
    'AN NORTE HW_v.png',
    'AN SUR HW.png',
    'AN SUR HW_v.png',
    'ANNI.jpg',
    'BRECHA.png',
    'CABECERA FW NORTE.png',
    'CABECERA FW NORTE_v.png',
    'CABECERA HW.png',
    'CABECERA HW_v.png',
    'INICIO CAVING.png',
    'INICIO CAVING_v.png',
    'MONITOREO POST EVENTO 2025.png',
    'MONITOREO POST EVENTO 2025_v.png',
    'MONITOREO POST EVENTO FW.png',
    'MONITOREO POST EVENTO FW_v.png',
    'MONITOREO POST EVENTO.png',
    'MONITOREO POST EVENTO_v.png',
    'P 4600.png',
    'P 4600_am.png',
    'P 4600_v.png',
    'PACIFICO.png',
    'PACIFICO_v.png',
    'PAC#U2553FICO.png',
    'PAC#U2553FICO_v.png',
    'Pilar 2.png',
    'Pilar 2_v.png',
    'TC OIM.png',
    'TC OIM_am.png',
    'TC OIM_v.png',
    'MONITOREO POST EVENTO 2025 (after).png'
)

foreach ($target in $targets) {
    $dir = Join-Path $projectRoot $target
    if (-not (Test-Path $dir)) { continue }
    foreach ($file in $files) {
        $path = Join-Path $dir $file
        if (Test-Path $path) {
            Remove-Item $path -Force
            Write-Host "Eliminado: $path"
        }
    }
}

Write-Host 'Limpieza Andes Norte terminada.'
