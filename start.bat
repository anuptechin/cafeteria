@echo off
REM ============================================================
REM  D'Decor Cafeteria - One-click startup (Docker)
REM  Builds + starts web (8080), api (4000), db (5434)
REM  then opens the app in your browser.
REM ============================================================
setlocal
cd /d "%~dp0"

title D'Decor Cafeteria

echo.
echo  ====================================================
echo    D'Decor Cafeteria  -  starting...
echo  ====================================================
echo.

REM --- Make sure Docker is installed ---
where docker >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Docker is not installed or not on PATH.
    echo          Install Docker Desktop, then run this again.
    echo.
    pause
    exit /b 1
)

REM --- Make sure the Docker engine is actually running ---
docker info >nul 2>&1
if errorlevel 1 (
    echo  Docker Desktop does not appear to be running.
    echo  Trying to start it...
    start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
    echo  Waiting for Docker to come up...
    :waitdocker
    timeout /t 3 >nul
    docker info >nul 2>&1
    if errorlevel 1 goto waitdocker
    echo  Docker is ready.
)

echo.
echo  Building and starting containers (first run can take a few minutes)...
echo.
docker compose up -d --build
if errorlevel 1 (
    echo.
    echo  [ERROR] docker compose failed. See the messages above.
    echo.
    pause
    exit /b 1
)

echo.
echo  ====================================================
echo    Cafeteria is up!
echo      App   :  http://localhost:8080
echo      API   :  http://localhost:4000
echo      Login :  ambuj.kumar@ddecor.com  /  Admin@123$
echo  ====================================================
echo.
echo  Opening the app in your browser...

REM Give the API a moment to apply schema + seed on first boot
timeout /t 5 >nul
start "" http://localhost:8080

echo.
echo  To view logs:   docker compose logs -f api
echo  To stop:        double-click stop.bat  (or: docker compose down)
echo.
pause
endlocal
