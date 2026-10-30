$ErrorActionPreference = "Stop"
$InstallRoot = $PSScriptRoot
$DataRoot = Join-Path $env:ProgramData "FCGS\Gate Bridge"
$SecretsPath = Join-Path $DataRoot "secrets.bin"
$ConfigPath = Join-Path $DataRoot "config.json"
$LogRoot = Join-Path $DataRoot "logs"

if (-not (Test-Path $SecretsPath)) { throw "FCGS Gate Bridge encrypted credentials are missing: $SecretsPath" }
if (-not (Test-Path $ConfigPath)) { throw "FCGS Gate Bridge configuration is missing: $ConfigPath" }
New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null

Add-Type -AssemblyName System.Security
$protected = [System.IO.File]::ReadAllBytes($SecretsPath)
$plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
$secretJson = [System.Text.Encoding]::UTF8.GetString($plainBytes)
$secrets = $secretJson | ConvertFrom-Json
$config = Get-Content -Raw -Path $ConfigPath | ConvertFrom-Json

$env:FCGS_GATE_BRIDGE_URL = [string]$config.portalUrl
$env:FCGS_GATE_BRIDGE_TOKEN = [string]$secrets.bridgeToken
$env:FCGS_GATE_BRIDGE_INSTALLATION_ID = [string]$config.installationId
$env:FCGS_GATE_BRIDGE_MACHINE_NAME = [string]$env:COMPUTERNAME
$env:FCGS_GATE_DEVICE_USERNAME = [string]$secrets.terminalUsername
$env:FCGS_GATE_DEVICE_PASSWORD = [string]$secrets.terminalPassword
$env:FCGS_GATE_DEVICE_PASSWORD_IS_MD5 = if ($secrets.terminalPasswordIsMd5) { "true" } else { "false" }
$env:FCGS_GATE_BRIDGE_LOG_DIR = $LogRoot
$env:FCGS_GATE_BRIDGE_UPDATE_SECRET_PATH = Join-Path $DataRoot "update-agent\local-auth.txt"
$env:FCGS_GATE_BRIDGE_LISTEN_PORT = [string]$config.callbackPort

# Minimise lifetime of the plaintext JSON copy after process environment is populated.
$secretJson = $null
$plainBytes = $null
$secrets = $null

Set-Location $DataRoot
& (Join-Path $InstallRoot "node.exe") (Join-Path $InstallRoot "gate-bridge.cjs")
exit $LASTEXITCODE
