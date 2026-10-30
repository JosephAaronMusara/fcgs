param(
    [Parameter(Mandatory = $true)]
    [string]$RepoPath
)

$ErrorActionPreference = "Stop"
$packageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = (Resolve-Path -LiteralPath $RepoPath).Path

$files = @(
    "client/src/components/fee-balance-import-dialog.tsx",
    "client/src/components/fee-schedule-dialog.tsx",
    "client/src/pages/school-finance.tsx",
    "package.json",
    "script/apply-2026-10-14-fee-schedule.ts",
    "script/validate-2026-10-14-fee-schedule.cjs",
    "server/access-control-operations.ts",
    "server/auth.ts",
    "server/fees-import-routes.ts",
    "server/fees-schedule.ts",
    "server/portal-routes.ts",
    "server/routes.ts",
    "shared/schema.ts",
    "sql/2026_10_14_fee_schedule_automatic_arrears.sql"
)

if (-not (Test-Path -LiteralPath (Join-Path $repo "package.json"))) {
    throw "RepoPath does not appear to be the FCGS Portal repository: $repo"
}

Write-Host "Applying FCGS fee schedule / automatic arrears build to:" -ForegroundColor Cyan
Write-Host "  $repo"
Write-Host ""

foreach ($relative in $files) {
    $source = Join-Path $packageRoot $relative
    $destination = Join-Path $repo $relative
    if (-not (Test-Path -LiteralPath $source)) {
        throw "Package file missing: $relative"
    }
    $destinationDirectory = Split-Path -Parent $destination
    New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
    Write-Host "Applied  $relative"
}

Write-Host ""
Write-Host "Applied $($files.Count) source files. No files were deleted." -ForegroundColor Green
Write-Host "Next: npm run check; npm run fee-schedule:source-check; npm run build" -ForegroundColor Yellow
Write-Host "Then, against the LOCAL database only: npm run fcgs:upgrade:2026-10-14" -ForegroundColor Yellow
