$ErrorActionPreference = 'Stop'
$InstallRoot = Join-Path $env:ProgramFiles 'FCGS\Gate Bridge'
$DataRoot = Join-Path $env:ProgramData 'FCGS\Gate Bridge'
$AgentRoot = Join-Path $DataRoot 'update-agent'
$ConfigPath = Join-Path $DataRoot 'config.json'
$SecretsPath = Join-Path $DataRoot 'secrets.bin'
if (-not (Test-Path $ConfigPath) -or -not (Test-Path $SecretsPath)) { throw 'FCGS Bridge is not paired or configured' }
Add-Type -AssemblyName System.Security
$sealed = [System.IO.File]::ReadAllBytes($SecretsPath)
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($sealed,$null,[System.Security.Cryptography.DataProtectionScope]::LocalMachine)
$secretObject = ([Text.Encoding]::UTF8.GetString($plain)) | ConvertFrom-Json
$cfg = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$env:FCGS_GATE_BRIDGE_URL = [string]$cfg.portalUrl
$env:FCGS_GATE_BRIDGE_TOKEN = [string]$secretObject.bridgeToken
$env:FCGS_UPDATE_AGENT_ROOT = $AgentRoot
$env:FCGS_GATE_BRIDGE_INSTALL = $InstallRoot
$plain = $null
$sealed = $null
$secretObject = $null
Set-Location $AgentRoot
& (Join-Path $AgentRoot 'node.exe') (Join-Path $AgentRoot 'agent.cjs')
exit $LASTEXITCODE
