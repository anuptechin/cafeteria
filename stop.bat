@echo off
REM ============================================================
REM  D'Decor Cafeteria - stop the running containers
REM  (keeps the database/photos volumes; add -v to wipe them)
REM ============================================================
setlocal
cd /d "%~dp0"

title D'Decor Cafeteria - stopping

echo.
echo  Stopping D'Decor Cafeteria containers...
echo.
docker compose down

echo.
echo  Stopped. Data is preserved.
echo  (To wipe ALL data: docker compose down -v)
echo.
pause
endlocal
