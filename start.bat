@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".env" (
  if exist ".env.example" (
    echo [PokerCRM] .env not found - creating from .env.example
    copy /y ".env.example" ".env" >nul
  )
)

if not exist "node_modules" (
  echo [PokerCRM] node_modules not found - installing dependencies via npm install...
  call npm install
  if errorlevel 1 (
    echo [PokerCRM] npm install failed. Ensure Node.js ^>=22.5 is installed and network is available.
    pause
    exit /b 1
  )
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
