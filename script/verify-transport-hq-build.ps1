# Local source verification only. Does not connect to a database or modify services.
$ErrorActionPreference = 'Stop'
$files = @(
  'client\src\pages\org-transport-oversight.tsx',
  'server\hq-operations-routes.ts',
  'server\transport-hq-financials.ts',
  'shared\schema.ts',
  'sql\2026_10_28_transport_hq_claim_attribution.sql',
  'script\test-transport-hq-financials.cjs',
  'script\test-transport-hq-source.cjs'
)
foreach ($file in $files) {if (-not (Test-Path -LiteralPath $file)) {throw "Missing build file: $file"}}
Write-Host 'All Transport HQ build files found.'
node script/test-transport-hq-financials.cjs
if ($LASTEXITCODE -ne 0) {throw 'Financial tests failed.'}
node script/test-transport-hq-source.cjs
if ($LASTEXITCODE -ne 0) {throw 'HQ source tests failed.'}
node script/test-transport-credit-allocation.cjs
if ($LASTEXITCODE -ne 0) {throw 'Transport credit allocation regression tests failed.'}
npm.cmd run check
if ($LASTEXITCODE -ne 0) {throw 'TypeScript validation failed.'}
npm.cmd run build
if ($LASTEXITCODE -ne 0) {throw 'Application build failed.'}
Write-Host 'PASS: HQ Transport source and application validation completed.'
