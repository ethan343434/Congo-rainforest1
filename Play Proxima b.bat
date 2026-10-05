@echo off
title Proxima b - keep this window open while you play
rem Starts a tiny local web server in this folder and opens the game.
rem Close this window (or press Ctrl+C) to stop it.
cd /d "%~dp0"
echo.
echo   Proxima b
echo   Starting... your browser will open in a moment.
echo   Keep this window open while you play. Close it when you are done.
echo.
start "" /b cmd /c "timeout /t 2 /nobreak >nul && explorer http://localhost:8000/solar-system/proxima.html"
where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server 8000 --bind 127.0.0.1
) else (
  py -m http.server 8000 --bind 127.0.0.1
)
echo.
echo   The server stopped. If you saw an error above, Python may not be installed:
echo   get it from https://www.python.org/downloads/ (tick "Add Python to PATH").
pause
