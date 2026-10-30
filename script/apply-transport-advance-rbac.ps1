$ErrorActionPreference = 'Stop'
$file = Join-Path (Get-Location).Path 'server/rbac-config.ts'
if (-not (Test-Path -LiteralPath $file)) { throw 'Run from the fcgs-portal root. RBAC configuration file missing.' }
$content = [System.IO.File]::ReadAllText($file)
$recordCode = 'transport.advances.repayments.record'
$verifyCode = 'transport.advances.repayments.verify'
if ($content.Contains($recordCode) -and $content.Contains($verifyCode)) { Write-Host 'PASS: Both repayment permissions already registered'; return }
if ($content.Contains($recordCode) -xor $content.Contains($verifyCode)) { throw 'Only one permission already exists. STOP; review RBAC configuration manually.' }
$anchor = '  { code: "transport.advances.disburse", name: "Disburse Vehicle Advances", description: "Record disbursement references for approved vehicle advances", category: "Transport" },'
if ($content.IndexOf($anchor) -lt 0 -or $content.IndexOf($anchor) -ne $content.LastIndexOf($anchor)) { throw 'Expected RBAC anchor not unique. No changes made.' }
$add = $anchor + "`n" +
'  { code: "transport.advances.repayments.record", name: "Record Direct Advance Repayments", description: "Record an advance principal repayment awaiting independent financial verification", category: "Transport" },' + "`n" +
'  { code: "transport.advances.repayments.verify", name: "Verify Direct Advance Repayments", description: "Independently verify or reject an advance principal repayment", category: "Transport" },'
$backupDir = Join-Path (Get-Location).Path 'backups'
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
$backup = Join-Path $backupDir ('rbac-config-before-transport-' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.ts')
Copy-Item -LiteralPath $file -Destination $backup
[System.IO.File]::WriteAllText($file, $content.Replace($anchor,$add), (New-Object System.Text.UTF8Encoding($false)))
Write-Host 'PASS: Registered two RBAC permissions without changing configured role grants.'
Write-Host "Backup: $backup"
