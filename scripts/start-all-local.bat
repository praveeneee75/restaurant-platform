@echo off
setlocal
cd /d "%~dp0\.."
set "ROOT=%cd%"

echo ==========================================
echo Restaurant Platform Local Startup
echo ==========================================
echo.

echo Starting POS backend...
start "Restaurant POS Backend" cmd /k "cd /d ""%ROOT%\pos-app"" && npm run start"

echo Starting Print Agent...
start "Restaurant Print Agent" cmd /k "cd /d ""%ROOT%\print-agent"" && npm run start"

if /I "%START_SAAS_LOCAL%"=="1" (
  echo Starting SaaS backend for local development...
  start "Restaurant SaaS Backend" cmd /k "cd /d ""%ROOT%\saas-backend"" && npm run start"
) else (
  echo SaaS backend skipped. Set START_SAAS_LOCAL=1 to start it for local development.
)

echo.
echo Waiting for local services...
timeout /t 6 /nobreak >nul

echo Opening POS login page...
start "" "http://localhost:3000/login.html"

echo.
echo POS health: http://localhost:3000/health
echo Print Agent health: http://127.0.0.1:3100/health
echo.
echo Keep the opened service windows running while using POS.
