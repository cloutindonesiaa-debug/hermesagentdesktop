@echo off
REM Hermes Agent Desktop — Restore Script for Windows
echo.
echo 🚀 Hermes Agent Desktop — Restore
echo ==================================

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js not found. Please install Node.js first.
    echo    Download: https://nodejs.org/
    pause
    exit /b 1
)
echo ✅ Node.js found

REM Install Mission Control dependencies
echo.
echo 📦 Installing Mission Control dependencies...
cd mission-control
call npm install
if %errorlevel% neq 0 (
    echo ❌ npm install failed
    pause
    exit /b 1
)
echo ✅ Dependencies installed

REM Create .env from example if not exists
if not exist .env (
    copy .env.example .env
    echo 📝 Created .env from example. Edit it to add your API key.
)

REM Delete old database for fresh start
echo.
echo 🗄️ Setting up fresh database...
if exist mission-control.db del mission-control.db
echo ✅ Database ready

echo.
echo ==================================
echo ✅ Restore complete!
echo.
echo To start Mission Control:
echo   cd mission-control
echo   set PORT=3001 ^&^& node server.js
echo.
echo Then open: http://localhost:3001
echo.
echo 📝 Don't forget to edit .env with your API key:
echo    XIAOMI_API_KEY=***echo ==================================
pause
