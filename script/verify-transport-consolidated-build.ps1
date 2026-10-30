$ErrorActionPreference='Stop'
Write-Host 'FCGS Transport — consolidated local source verification'
$files=@('server/transport-routes.ts','server/hq-operations-routes.ts','server/transport-hq-one-step.ts','server/transport-hq-financials.ts','server/transport-hq-settlement-groups.ts','server/transport-settlement-calendar.ts','server/transport-advance-repayments.ts','client/src/pages/transport.tsx','client/src/pages/org-transport-oversight.tsx','shared/schema.ts','sql/2026_10_28_transport_settlement_cycle_and_advance_repayments.sql')
foreach($f in $files){if(-not(Test-Path $f)){throw "MISSING FILE: $f"}}
& node script/test-transport-hq-financials.cjs; if($LASTEXITCODE -ne 0){throw 'HQ financial tests failed'}
& node script/test-transport-credit-allocation.cjs; if($LASTEXITCODE -ne 0){throw 'Credit allocation tests failed'}
& node script/test-transport-settlement-calendar.cjs; if($LASTEXITCODE -ne 0){throw 'Working day tests failed'}
& node script/test-transport-hq-groups.cjs; if($LASTEXITCODE -ne 0){throw 'HQ grouping tests failed'}
& node script/test-transport-consolidated-source.cjs; if($LASTEXITCODE -ne 0){throw 'Source contract tests failed'}
& npm.cmd run check; if($LASTEXITCODE -ne 0){throw 'TypeScript compilation failed. DO NOT MIGRATE.'}
& npm.cmd run build; if($LASTEXITCODE -ne 0){throw 'Application build failed. DO NOT MIGRATE.'}
Write-Host 'PASS: Local full source, type and application build verification. Database-backed workflow tests still required before production.'
