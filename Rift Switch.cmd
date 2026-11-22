@echo off
rem Starts Rift Switch from this folder (the version built with "npm run dist").
set "EXE=%~dp0src-tauri\target\release\rift-switch.exe"
if exist "%EXE%" (
  start "" "%EXE%"
) else (
  echo Rift Switch is not built yet. Run "npm run dist" in this folder first.
  pause
)
