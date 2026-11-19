@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1" %*
if errorlevel 1 (
  echo.
  echo Lurkr installation failed.
  pause
  exit /b 1
)
echo.
pause
