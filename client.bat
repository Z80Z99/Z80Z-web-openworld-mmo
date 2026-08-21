@echo off
chcp 65001 >nul <nul
cd /d "%~dp0"

echo [1/3] Stopping previous client...
taskkill /FI "WINDOWTITLE eq MMO-Client" /F >nul 2>&1
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr :3000 ^| findstr LISTENING') do (
    taskkill /PID %%p /F >nul 2>&1
)
echo     Done.

echo [2/3] Starting client dev server on port 3000...
set VITE_SERVER_URL=ws://127.0.0.1:2567
start "MMO-Client" /D "%~dp0packages\client" npm run dev
echo     Client started.

echo [3/3] Opening browser in 3 seconds...
timeout /t 3 /nobreak >nul
start http://localhost:3000
pause
