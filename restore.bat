@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo VAZNO: zatvorite prozor servera pre vracanja baze.
echo.
node restore-db.js
pause
