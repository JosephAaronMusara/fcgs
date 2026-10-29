$ErrorActionPreference = 'Stop'
Write-Host 'FCGS Transport UI/UX release verification (local only)'
$required = @(
  'client/src/pages/transport.tsx',
  'client/src/pages/org-transport-oversight.tsx',
  'client/src/pages/org-dashboard.tsx',
  'client/src/components/ui/input.tsx',
  'script/test-transport-ui-ux-2026-10-29.cjs',
  'script/verify-transport-consolidated-build.ps1'
)
foreach ($file in $required) { if (-not (Test-Path -LiteralPath $file)) { throw "Missing $file" } }
& git diff --check
if ($LASTEXITCODE -ne 0) { throw 'Git whitespace validation failed' }
& node script/test-transport-ui-ux-2026-10-29.cjs
if ($LASTEXITCODE -ne 0) { throw 'Transport UI source tests failed' }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File script/verify-transport-consolidated-build.ps1
if ($LASTEXITCODE -ne 0) { throw 'Existing Transport regression tests, TypeScript or app build failed' }
Write-Host 'PASS: Transport UI/UX source, existing Transport tests, TypeScript and application build.'
Write-Host 'Browser testing on desktop and mobile remains required before production.'
