param(
    [string]$Hosta = "tmone.denial.cl",
    [int]$Port = 7070,
    [string]$Backbone = "GW_BACKBONE_NORTE",
    [string]$EdgeKind = "EDGE_BUS",
    [string]$EdgeId = "BUS_001"
)

Write-Host ("Conectando a {0}:{1} ..." -f $Hosta, $Port)

$client = New-Object System.Net.Sockets.TcpClient

try {
    $client.Connect($Hosta, $Port)
}
catch {
    Write-Error "No se pudo conectar a $Hosta : $Port. ¿Está levantado el listener?"
    exit 1
}

$stream = $client.GetStream()
$writer = New-Object System.IO.StreamWriter($stream)
$writer.AutoFlush = $true

for ($i = 0; $i -lt 10; $i++) {

    # MAC BLE ficticia
    $bt = ("AA:BB:CC:DD:EE:{0:D2}" -f $i)
    
    # Timestamp ISO
    $ts = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss")

    # RSSI ficticio
    $rssi = -60 - $i

    # Formato correcto con $()
    $line = "$($bt):BT:$($ts):$($Backbone):$($EdgeKind):$($EdgeId):$($rssi)"

    Write-Host "Enviando: $line"
    $writer.WriteLine($line)

    Start-Sleep -Seconds 1
}

Write-Host "Cerrando conexión..."
$writer.Close()
$stream.Close()
$client.Close()

Write-Host "Listo."
