#Requires -RunAsAdministrator
param([Parameter(Mandatory=$true)][string]$Staging)
$ErrorActionPreference = 'Stop'
$InstallRoot = Join-Path $env:ProgramFiles 'FCGS\Gate Bridge'
$DataRoot = Join-Path $env:ProgramData 'FCGS\Gate Bridge'
$AgentRoot = Join-Path $DataRoot 'update-agent'
$Service = 'FCGSGateBridgeService'
$ConfigPath = Join-Path $DataRoot 'config.json'
$Manifest = Get-Content -Raw (Join-Path $Staging 'manifest.json') | ConvertFrom-Json
$Backup = Join-Path $AgentRoot ('rollback-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$ChangedFiles = @()
$Started = $false
$RollbackVerified = $false
$Portal = [string]$env:FCGS_GATE_BRIDGE_URL
$Headers = @{ Authorization = 'Bearer ' + [string]$env:FCGS_GATE_BRIDGE_TOKEN }
function Get-BridgeHealth {
  if(-not $Portal.StartsWith('https://')) { throw 'Secure Portal URL missing for health verification' }
  return Invoke-RestMethod -UseBasicParsing -TimeoutSec 8 -Uri ($Portal.TrimEnd('/') + '/api/gate-bridge/update-agent/health') -Headers $Headers
}
$BeforeHealth = Get-BridgeHealth
$BeforeOnline = @($BeforeHealth.devices | Where-Object { $_.isActive -and $_.status -eq 'online' } | ForEach-Object { $_.id })

if (-not (Test-Path $ConfigPath)) { throw 'Gate Bridge configuration missing' }
New-Item -ItemType Directory -Force -Path $Backup | Out-Null
Copy-Item -LiteralPath $ConfigPath -Destination (Join-Path $Backup 'config.json') -Force
try {
  foreach ($asset in $Manifest.assets) {
    $name = [string]$asset.name
    if ($name -notmatch '^[a-zA-Z0-9._-]+$') { throw 'Unsafe filename in manifest' }
    $new = Join-Path $Staging $name
    if (-not (Test-Path $new)) { throw "Missing staged file $name" }
    $sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $new).Hash.ToLowerInvariant()
    if ($sha -ne [string]$asset.sha256) { throw "Staged checksum mismatch for $name" }
    $old = Join-Path $InstallRoot $name
    if (Test-Path $old) { Copy-Item -LiteralPath $old -Destination (Join-Path $Backup $name) -Force }
    $ChangedFiles += $name
  }
  Stop-Service -Name $Service -Force
  (Get-Service -Name $Service).WaitForStatus('Stopped', (New-TimeSpan -Seconds 60))
  foreach ($name in $ChangedFiles) { Copy-Item -LiteralPath (Join-Path $Staging $name) -Destination (Join-Path $InstallRoot $name) -Force }
  $config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
  $config.releaseVersion = [string]$Manifest.version
  $config | ConvertTo-Json -Depth 12 | Set-Content -Encoding UTF8 -LiteralPath $ConfigPath
  Start-Service -Name $Service
  (Get-Service -Name $Service).WaitForStatus('Running', (New-TimeSpan -Seconds 60))
  $Started = $true
  $TestDeadline = (Get-Date).AddSeconds(60)
  $Healthy = $false
  do {
    Start-Sleep -Seconds 3
    try {
      $health = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri 'http://127.0.0.1:9191/__fcgs_update/ready' -Headers @{'X-FCGS-Update-Secret'=(Get-Content -Raw (Join-Path $AgentRoot 'local-auth.txt')).Trim()}
      if ($health.StatusCode -eq 200) { $Healthy = $true; break }
    } catch { }
  } until ((Get-Date) -ge $TestDeadline)
  if (-not $Healthy) { throw 'Updated service running but recognition callback listener or Bridge update endpoint unresponsive' }
  $PortalDeadline = (Get-Date).AddSeconds(90)
  $PortalHealthy = $false
  do {
    Start-Sleep -Seconds 5
    try {
      $Health = Get-BridgeHealth
      if ($Health.version -ne [string]$Manifest.version) { continue }
      if ([string]::IsNullOrWhiteSpace([string]$Health.lastHeartbeatAt)) { continue }
      if ([DateTime]::UtcNow.Subtract(([DateTime]$Health.lastHeartbeatAt).ToUniversalTime()).TotalSeconds -gt 60) { continue }
      if (-not [string]::IsNullOrWhiteSpace([string]$Health.callbackError)) { continue }
      $Online = @($Health.devices | Where-Object { $_.isActive -and $_.status -eq 'online' } | ForEach-Object { $_.id })
      $Regressed = @($BeforeOnline | Where-Object { $_ -notin $Online })
      if ($Regressed.Count -eq 0) { $PortalHealthy = $true; break }
    } catch { }
  } until ((Get-Date) -ge $PortalDeadline)
  if (-not $PortalHealthy) { throw 'Portal/authentication/device health verification failed: online terminals did not recover to pre-update condition' }
  Write-Output "Verified Gate Bridge version $($Manifest.version), rollback copy preserved: $Backup"
  exit 0
} catch {
  $failure = $_.Exception.Message
  Write-Warning "Update failed: $failure. Attempting complete rollback (files AND config)..."
  Stop-Service -Name $Service -Force -ErrorAction SilentlyContinue
  try { (Get-Service -Name $Service).WaitForStatus('Stopped', (New-TimeSpan -Seconds 60)) } catch { }
  try {
    foreach ($name in $ChangedFiles) {
      $old = Join-Path $Backup $name
      if (Test-Path $old) { Copy-Item -LiteralPath $old -Destination (Join-Path $InstallRoot $name) -Force }
      else { Remove-Item -LiteralPath (Join-Path $InstallRoot $name) -Force -ErrorAction SilentlyContinue }
    }
    Copy-Item -LiteralPath (Join-Path $Backup 'config.json') -Destination $ConfigPath -Force
    Start-Service -Name $Service -ErrorAction Stop
    (Get-Service -Name $Service).WaitForStatus('Running', (New-TimeSpan -Seconds 60))
    # v1.1.0 was released before the internal /__fcgs_update endpoint existed.
    # Check that the historical version restored its callback LISTENER and Portal heartbeat.
    $RolledBackListener=$false
    $until=(Get-Date).AddSeconds(45)
    do { Start-Sleep -Seconds 3; try {
      $sock=New-Object System.Net.Sockets.TcpClient
      $ar=$sock.BeginConnect('127.0.0.1',9191,$null,$null)
      if($ar.AsyncWaitHandle.WaitOne(2500)){$sock.EndConnect($ar);$RolledBackListener=$true}
      $sock.Close()
      if($RolledBackListener){break}
    }catch{} }until((Get-Date)-ge $until)
    if(-not $RolledBackListener){throw 'Rollback listener verification failed'}
    $rollbackConfig=Get-Content -Raw $ConfigPath | ConvertFrom-Json
    if([string]$rollbackConfig.releaseVersion -eq [string]$Manifest.version){throw 'Rollback configuration still reports the rejected release'}
    $RollbackVerified = $true
    Write-Warning "Previous software and configuration restored, service running. Backup retained: $Backup"
  } catch { Write-Warning "CRITICAL: Rollback FAILED ($($_.Exception.Message)); maintenance intervention required." }
  throw "Update failed: $failure; rollback service status: $RollbackVerified; backup: $Backup"
}
