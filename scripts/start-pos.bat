@echo off
setlocal
cd /d "%~dp0\..\pos-app"
echo Starting Restaurant POS backend...
echo URL: http://localhost:3000/login.html
npm run start

