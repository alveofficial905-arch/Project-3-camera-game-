@echo off
title Temple Run IRL - Game Launcher
cd /d "%~dp0"
echo ============================================================
echo   Starting Temple Run IRL Motion Workout Game...
echo ============================================================

start "" powershell.exe -ExecutionPolicy Bypass -NoExit -File "%~dp0server.ps1"

timeout /t 2 /nobreak >nul

if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" "http://localhost:8080/"
) else (
    start "" "http://localhost:8080/"
)

echo Game launched at http://localhost:8080/
echo Enjoy your workout!
