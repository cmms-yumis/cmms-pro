@echo off
chcp 65001 >nul
title CMMS Pro - server
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nije instaliran. Preuzmite verziju LTS sa https://nodejs.org pa ponovo pokrenite.
  pause
  exit /b 1
)
if not exist "node_modules\express" (
  echo Prvo pokretanje - instaliram pakete, sacekajte...
  call npm install --omit=dev
  if errorlevel 1 (
    echo Instalacija nije uspela. Proverite internet vezu pa pokusajte ponovo.
    pause
    exit /b 1
  )
)
:start
node server.js
echo.
echo Server se zaustavio. Ponovo se pokrece za 5 sekundi (zatvorite ovaj prozor da prekinete)...
timeout /t 5 >nul
goto start
