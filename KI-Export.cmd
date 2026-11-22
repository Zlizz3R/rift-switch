@echo off
setlocal
cd /d "%~dp0"

title Rift Switch - KI Export

echo ==========================================
echo         Rift Switch KI-Export
echo ==========================================
echo.

if not exist "tools\ai-export.js" (
    echo FEHLER: tools\ai-export.js wurde nicht gefunden.
    pause
    exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
    echo FEHLER: Node.js wurde nicht gefunden.
    pause
    exit /b 1
)

node tools\ai-export.js

if errorlevel 1 (
    echo.
    echo FEHLER: Der KI-Export ist fehlgeschlagen.
    pause
    exit /b 1
)

if not exist "ki-export" (
    echo FEHLER: Der Exportordner wurde nicht erstellt.
    pause
    exit /b 1
)

explorer "%~dp0ki-export"

exit /b 0