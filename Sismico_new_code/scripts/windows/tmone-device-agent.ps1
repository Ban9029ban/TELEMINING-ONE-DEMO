param(
  [string]$BackendUrl = "http://localhost:8000",
  [string]$ScreenCode = "pantalla-1",
  [string]$SiteCode = "diamante",
  [string]$RequestedView = "/legacy-sismico/diamante"
)

function Get-PrimaryMac {
  $adapters = Get-NetAdapter | Where-Object { $_.Status -eq "Up" -and $_.MacAddress } | Sort-Object -Property InterfaceMetric
  if ($adapters.Count -gt 0) { return $adapters[0].MacAddress.ToLower().Replace('-', ':') }
  return "unknown"
}

function Get-MacAddresses {
  return @(Get-NetAdapter | Where-Object { $_.MacAddress } | ForEach-Object { $_.MacAddress.ToLower().Replace('-', ':') })
}

function Get-IpAddresses {
  return @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '169.254*' -and $_.IPAddress -ne '127.0.0.1' } | Select-Object -ExpandProperty IPAddress)
}

$hostname = $env:COMPUTERNAME
$windowsUser = "$env:USERDOMAIN\$env:USERNAME"
$domainName = $env:USERDOMAIN
$macs = Get-MacAddresses
$ips = Get-IpAddresses
$primaryMac = Get-PrimaryMac
$fingerprint = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes("$hostname|$primaryMac|$windowsUser"))

$payload = @{
  screen_code    = $ScreenCode
  site_code      = $SiteCode
  requested_view = $RequestedView
  device_name    = $hostname
  hostname       = $hostname
  windows_user   = $windowsUser
  domain_name    = $domainName
  primary_mac    = $primaryMac
  mac_addresses  = $macs
  ip_addresses   = $ips
  fingerprint    = $fingerprint
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Method Post -Uri "$BackendUrl/api/screens/agent-checkin" -ContentType 'application/json' -Body $payload
