#Requires -RunAsAdministrator
# One-time supervised bootstrap ONLY after the trusted public KMS key has been independently verified.
param(
 [Parameter(Mandatory=$true)][string]$TrustedPublicKeysJson,
 [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ExpectedSha256
)
$ErrorActionPreference = 'Stop'
$InstallRoot = Join-Path $env:ProgramFiles 'FCGS\Gate Bridge'
$DataRoot = Join-Path $env:ProgramData 'FCGS\Gate Bridge'
$AgentRoot = Join-Path $DataRoot 'update-agent'
$Source = $PSScriptRoot
if (!(Test-Path (Join-Path $InstallRoot 'node.exe'))) { throw 'FCGS Bridge installation missing; aborting bootstrap' }
if (!(Test-Path $TrustedPublicKeysJson)) { throw 'Independently verified AWS KMS public-key pin file is required' }
$actual=(Get-FileHash -Algorithm SHA256 -LiteralPath $TrustedPublicKeysJson).Hash
if($actual -ne $ExpectedSha256) { throw 'Trusted public key pin does not match the independently verified SHA-256 fingerprint' }
$keys=Get-Content -Raw $TrustedPublicKeysJson | ConvertFrom-Json
if (!($keys.keys.Count -gt 0)) { throw 'At least one pinned KMS public key is required' }
foreach($key in $keys.keys){
 if ([string]::IsNullOrWhiteSpace([string]$key.keyId) -or -not ([string]$key.publicKeyPem).StartsWith('-----BEGIN PUBLIC KEY-----')) {throw 'Invalid pinned public key metadata'}
}
New-Item -ItemType Directory -Force -Path $AgentRoot | Out-Null
icacls.exe $AgentRoot /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Unable to restrict updater directory' }
Copy-Item -LiteralPath (Join-Path $InstallRoot 'node.exe') -Destination (Join-Path $AgentRoot 'node.exe') -Force
foreach($file in @('agent.cjs','Start-UpdateAgent.ps1','Install-VerifiedBridge.ps1')) {
 Copy-Item -LiteralPath (Join-Path $Source $file) -Destination (Join-Path $AgentRoot $file) -Force
}
Copy-Item -LiteralPath $TrustedPublicKeysJson -Destination (Join-Path $AgentRoot 'trusted-release-keys.json') -Force
$bytes = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$secret = [Convert]::ToBase64String($bytes)
$SecretPath=Join-Path $AgentRoot 'local-auth.txt'
if (!(Test-Path $SecretPath)) { [IO.File]::WriteAllText($SecretPath,$secret) }
# Agent runs as SYSTEM, separately from the main Bridge service, and survives user logouts.
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path $AgentRoot 'Start-UpdateAgent.ps1') + '"')
$trigger=New-ScheduledTaskTrigger -AtStartup
$principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings=New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 2) -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
Register-ScheduledTask -TaskName 'FCGS Gate Bridge Update Agent' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'FCGS Gate Bridge Update Agent'
Write-Output 'Update Agent installed. It WILL NOT install an unsigned/unapproved release. Automatic updates default to disabled in Portal.'
