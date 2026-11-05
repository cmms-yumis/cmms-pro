@echo off
chcp 65001 >nul
rem Pokrece CMMS server automatski pri startu Windows-a (pre prijave korisnika). Pokrenuti kao administrator.
net session >nul 2>&1
if errorlevel 1 (
  echo Pokrenite kao administrator: desni klik, pa "Run as administrator".
  pause
  exit /b 1
)
schtasks /create /tn "CMMS Pro server" /tr "\"%~dp0POKRENI.bat\"" /sc onstart /ru SYSTEM /rl highest /f
echo.
echo Gotovo. Server ce se pokretati sam pri svakom paljenju racunara.
echo Uklanjanje: schtasks /delete /tn "CMMS Pro server" /f
pause
