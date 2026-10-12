@echo off
chcp 65001 >nul
cd /d "%~dp0"

node -v >nul 2>&1
if errorlevel 1 (
  echo Node.js not found. Downloading the official installer ^(v22 LTS^)...
  powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi' -OutFile 'node-installer.msi'"
  if errorlevel 1 (
    echo Download failed. Please install Node.js manually from https://nodejs.org/ and run start.bat again.
    pause
    exit /b 1
  )
  start /wait node-installer.msi
  del node-installer.msi
  echo Installation complete! Please CLOSE this window and run start.bat again so Windows can update the PATH.
  pause
  exit /b 1
)

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
