#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
$InstallRoot = $PSScriptRoot
$DataRoot = Join-Path $env:ProgramData "FCGS\Gate Bridge"
$ConfigPath = Join-Path $DataRoot "config.json"
$ServiceName = "FCGSGateBridgeService"
if (-not (Test-Path $ConfigPath)) { throw "Gate Bridge config not found: $ConfigPath" }
$config = Get-Content -Raw -Path $ConfigPath | ConvertFrom-Json
$portal = ([string]$config.portalUrl).TrimEnd('/')
$manifest = Invoke-RestMethod -UseBasicParsing -Uri "$portal/api/gate-bridge/release" -Method Get
if (-not $manifest.ready) { throw "The FCGS Gate Bridge release is incomplete on the portal; update cancelled." }
$tmp = Join-Path $env:TEMP ("fcgs-gate-bridge-update-" + [guid]::NewGuid().ToString("N"))
$backup = Join-Path $DataRoot ("update-backup-" + (Get-Date -Format "yyyyMMddHHmmss"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
New-Item -ItemType Directory -Force -Path $backup | Out-Null
try {
  foreach ($asset in $manifest.assets) {
    $name = [string]$asset.name
    $target = Join-Path $tmp $name
    Invoke-WebRequest -UseBasicParsing -Uri "$portal/api/gate-bridge/windows-assets/$name" -OutFile $target
    $actual = (Get-FileHash -Algorithm SHA256 -Path $target).Hash.ToLowerInvariant()
    if ($actual -ne ([string]$asset.sha256).ToLowerInvariant()) { throw "Checksum validation failed for $name" }
    $existing = Join-Path $InstallRoot $name
    if (Test-Path $existing) { Copy-Item -Force $existing (Join-Path $backup $name) }
  }

  if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Stop-Service -Name $ServiceName -Force -ErrorAction Stop
    (Get-Service -Name $ServiceName).WaitForStatus('Stopped', (New-TimeSpan -Seconds 30))
  }

  try {
    foreach ($asset in $manifest.assets) {
      Copy-Item -Force (Join-Path $tmp ([string]$asset.name)) (Join-Path $InstallRoot ([string]$asset.name))
    }
    $config.releaseVersion = [string]$manifest.version
    Set-Content -Encoding UTF8 -Path $ConfigPath -Value ($config | ConvertTo-Json -Depth 5)
    Start-Service -Name $ServiceName
    (Get-Service -Name $ServiceName).WaitForStatus('Running', (New-TimeSpan -Seconds 30))
    Write-Host "FCGS Gate Bridge updated to $($manifest.version)." -ForegroundColor Green
    Remove-Item -Recurse -Force $backup -ErrorAction SilentlyContinue
  } catch {
    Write-Warning "Gate Bridge update failed. Restoring the previous release..."
    if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) { Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue }
    Get-ChildItem -File $backup -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item -Force $_.FullName (Join-Path $InstallRoot $_.Name) }
    Start-Service -Name $ServiceName -ErrorAction SilentlyContinue
    throw
  }
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
