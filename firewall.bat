@echo off
chcp 65001 >nul
rem Otvara port servera u Windows Firewall-u da mu mogu pristupiti telefoni i racunari iz mreze.
rem Pokrenuti kao administrator (desni klik - Run as administrator).
net session >nul 2>&1
if errorlevel 1 (
  echo Pokrenite ovu datoteku kao administrator: desni klik, pa "Run as administrator".
  pause
  exit /b 1
)
set PORT=3000
rem Dozvoljene adrese: 192.168.0.0/22 = 192.168.0.x, 192.168.1.x, 192.168.2.x i 192.168.3.x
rem Za Tailscale dodajte: ,100.64.0.0/10   Za sve adrese stavite: any
set ALLOW=192.168.0.0/22,LocalSubnet
netsh advfirewall firewall delete rule name="CMMS Pro" >nul 2>&1
netsh advfirewall firewall add rule name="CMMS Pro" dir=in action=allow protocol=TCP localport=%PORT% remoteip=%ALLOW% profile=any
echo.
echo Port %PORT% je otvoren za: %ALLOW%
pause
