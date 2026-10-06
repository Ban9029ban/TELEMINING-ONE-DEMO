[CmdletBinding()]
param(
    [switch]$Elevated
)

$ErrorActionPreference = 'Stop'
$logPath = Join-Path $PSScriptRoot 'recover_hdmi.log'

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-NvidiaDisplayDevice {
    return Get-CimInstance Win32_PnPEntity |
        Where-Object {
            $_.PNPClass -eq 'Display' -and
            $_.Name -like 'NVIDIA*'
        } |
        Select-Object -First 1
}

if (-not (Test-IsAdministrator)) {
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Elevated"
    Write-Host 'Solicitando permisos de administrador para recuperar NVIDIA/HDMI...'
    Start-Process `
        -FilePath 'powershell.exe' `
        -ArgumentList $arguments `
        -Verb RunAs `
        -WindowStyle Normal
    exit 0
}

Start-Transcript -LiteralPath $logPath -Append | Out-Null

try {
    Write-Host '=== Recuperacion NVIDIA / HDMI ==='
    Write-Host "Inicio: $(Get-Date -Format o)"

    $gpu = Get-NvidiaDisplayDevice
    if (-not $gpu) {
        throw 'Windows no encontro una GPU NVIDIA en la clase Display.'
    }

    $instanceId = $gpu.DeviceID
    Write-Host "GPU: $($gpu.Name)"
    Write-Host "InstanceId: $instanceId"
    Write-Host "Codigo inicial: $($gpu.ConfigManagerErrorCode)"

    Write-Host 'Buscando cambios de hardware...'
    & pnputil.exe /scan-devices | Out-Host

    Write-Host 'Reiniciando solamente la GPU NVIDIA...'
    & pnputil.exe /restart-device "$instanceId" | Out-Host
    Start-Sleep -Seconds 8

    $gpu = Get-NvidiaDisplayDevice
    if ($gpu.ConfigManagerErrorCode -ne 0) {
        Write-Warning "La GPU conserva el codigo $($gpu.ConfigManagerErrorCode). Aplicando ciclo deshabilitar/habilitar."
        Disable-PnpDevice -InstanceId $instanceId -Confirm:$false
        Start-Sleep -Seconds 3
        Enable-PnpDevice -InstanceId $instanceId -Confirm:$false
        Start-Sleep -Seconds 10
        & pnputil.exe /scan-devices | Out-Host
        Start-Sleep -Seconds 3
        $gpu = Get-NvidiaDisplayDevice
    }

    Write-Host 'Activando salida de escritorio extendida...'
    Start-Process `
        -FilePath "$env:WINDIR\System32\DisplaySwitch.exe" `
        -ArgumentList '/extend' `
        -WindowStyle Hidden
    Start-Sleep -Seconds 5

    $monitors = Get-CimInstance Win32_PnPEntity |
        Where-Object { $_.PNPClass -eq 'Monitor' } |
        Select-Object Name, Status, ConfigManagerErrorCode

    Write-Host "Codigo final NVIDIA: $($gpu.ConfigManagerErrorCode)"
    Write-Host 'Monitores detectados:'
    $monitors | Format-Table -AutoSize | Out-Host

    if ($gpu.ConfigManagerErrorCode -eq 0) {
        Write-Host 'RECUPERACION_OK: NVIDIA inicio correctamente; HDMI fue reenumerado.'
        exit 0
    }

    Write-Warning "RECUPERACION_PARCIAL: NVIDIA continua con codigo $($gpu.ConfigManagerErrorCode). Reinicia Windows; si persiste, corresponde reinstalar limpiamente el controlador NVIDIA."
    exit 2
}
catch {
    Write-Error $_
    exit 1
}
finally {
    Write-Host "Fin: $(Get-Date -Format o)"
    Stop-Transcript | Out-Null
}
