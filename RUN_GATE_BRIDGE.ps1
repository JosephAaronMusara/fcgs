$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".\gate-bridge.env")) {
    Copy-Item ".\gate-bridge.env.example" ".\gate-bridge.env"
    Write-Host "Created gate-bridge.env from the example file." -ForegroundColor Yellow
    Write-Host "Edit gate-bridge.env with the Gate Bridge token and terminal admin credentials, then run this script again." -ForegroundColor Yellow
    exit 1
}

Write-Host "Starting FCGS Gate Bridge..." -ForegroundColor Cyan
npx dotenv -e .\gate-bridge.env -- npm run gate:bridge
