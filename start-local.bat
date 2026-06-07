@echo off
REM ============================================================
REM  D'Decor Cafeteria - One-click startup (LOCAL, no Docker)
REM  Runs API (:4000) + web (:5173) with hot reload.
REM  Requires: Node 20+  and  a local PostgreSQL (see .env).
REM ============================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

title D'Decor Cafeteria (local)

echo.
echo  ====================================================
echo    D'Decor Cafeteria  -  starting (local, no Docker)
echo  ====================================================
echo.

REM --- Node present? ---
where node >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Node.js is not installed or not on PATH.
    echo          Install Node 20+ from https://nodejs.org then run this again.
    echo.
    pause
    exit /b 1
)

REM --- Is PostgreSQL reachable on localhost:5432? ---
powershell -NoProfile -Command "exit ([int](-not (Test-NetConnection -ComputerName localhost -Port 5432 -InformationLevel Quiet)))"
if errorlevel 1 (
    echo  [ERROR] Cannot reach PostgreSQL on localhost:5432.
    echo          Start your PostgreSQL service, then run this again.
    echo          ^(Connection settings come from the .env file.^)
    echo.
    pause
    exit /b 1
)

REM --- Install dependencies on first run ---
if not exist "node_modules" (
    echo  Installing dependencies ^(first run only^)...
    call npm install
    if errorlevel 1 (
        echo  [ERROR] npm install failed. See messages above.
        pause
        exit /b 1
    )
)

REM --- One-time database setup (schema only; punch rows come from Hikvision) ---
if not exist ".local-setup-done" (
    echo.
    echo  First run: applying database schema...
    call npm run db:setup
    if errorlevel 1 (
        echo  [ERROR] db:setup failed. Check DATABASE_URL in .env and that the
        echo          'canteen' database / user exist.
        pause
        exit /b 1
    )
    > ".local-setup-done" echo done
    echo  Database ready.
)

echo.
echo  ====================================================
echo    Starting servers...
echo      App   :  http://localhost:5173
echo      API   :  http://localhost:4000
echo      Login :  ambuj.kumar@ddecor.com  /  Admin@123$
echo  ====================================================
echo.
echo  ^(Leave this window open. Press Ctrl+C here to stop.^)
echo.

REM Open the browser shortly after the dev servers come up
start "" cmd /c "timeout /t 8 >nul & start "" http://localhost:5173"

REM Run API + web together (blocks until you stop it)
call npm run dev

endlocal
