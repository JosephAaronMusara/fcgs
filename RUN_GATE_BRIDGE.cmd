@echo off
setlocal
cd /d "%~dp0"

if not exist "gate-bridge.env" (
  copy /Y "gate-bridge.env.example" "gate-bridge.env" >nul
  echo.
  echo Created gate-bridge.env from the example file.
  echo Configure the bridge token and terminal credentials, save the file, then run this command again.
  echo.
  notepad "gate-bridge.env"
  exit /b 1
)

echo Starting FCGS Gate Bridge...
call npx dotenv -e .\gate-bridge.env -- npm run gate:bridge
set EXIT_CODE=%ERRORLEVEL%

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Gate Bridge exited with code %EXIT_CODE%.
  pause
)
exit /b %EXIT_CODE%
