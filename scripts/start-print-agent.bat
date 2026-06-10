@echo off
setlocal
cd /d "%~dp0\..\print-agent"
echo Starting Restaurant Print Agent...
echo Health: http://127.0.0.1:3100/health
npm run start

