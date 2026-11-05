@echo off
chcp 65001 >nul
rem Premesta ostatke stare verzije u folder _staro (nista se ne brise). Baza i backup ostaju na mestu.
cd /d "%~dp0"
if not exist _staro mkdir _staro
if exist public\pages move public\pages _staro\ >nul
if exist public\dashboard.html move public\dashboard.html _staro\ >nul
if exist public\manifest.json.old move public\manifest.json.old _staro\ >nul
for %%F in (server*kopija*.js excel-generator.js pdf-generator.js napravi_cmms.bat package-lock.json.old) do if exist "%%F" move "%%F" _staro\ >nul
if exist excel move excel _staro\ >nul
echo Gotovo. Stari fajlovi su u folderu _staro (mozete ga obrisati kad potvrdite da sve radi).
pause
