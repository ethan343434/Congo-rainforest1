@echo off
title Sol Voyager for your phone - keep this window open while you play
rem Serves the game to phones and tablets on the same Wi-Fi as this PC.
rem Close this window (or press Ctrl+C) to stop it.
cd /d "%~dp0"
echo.
echo   Sol Voyager - play on your iPhone or iPad
echo.
echo   1. Connect your phone to the same Wi-Fi as this PC.
echo   2. In Safari on the phone, open one of these addresses:
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do for /f "tokens=*" %%b in ("%%a") do echo        http://%%b:8000/solar-system/
echo.
echo   3. Turn the phone sideways. If Windows asks about the firewall,
echo      click "Allow access" for private networks.
echo.
echo   Keep this window open while you play. Close it when you are done.
echo.
where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server 8000 --bind 0.0.0.0
) else (
  py -m http.server 8000 --bind 0.0.0.0
)
echo.
echo   The server stopped. If you saw an error above, Python may not be installed:
echo   get it from https://www.python.org/downloads/ (tick "Add Python to PATH").
pause
