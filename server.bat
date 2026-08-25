@echo off
chcp 65001 >nul <nul
cd /d "%~dp0"

echo [1/2] Stopping previous server...
taskkill /FI "WINDOWTITLE eq MMO-Server" /F >nul 2>&1
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr :2567 ^| findstr LISTENING') do (
    taskkill /PID %%p /F >nul 2>&1
)
echo     Done.

echo [2/2] Starting game server on port 2567...
start "MMO-Server" /D "%~dp0" npx --yes node@22 packages\server\dist\server\GameServer.js
echo     Server started.
echo     Press any key to close this window...
pause >nul
