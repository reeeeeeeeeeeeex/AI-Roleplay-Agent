@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24 from https://nodejs.org/ and reopen this file.
  if not defined CI pause
  exit /b 1
)
node scripts/start.mjs
if errorlevel 1 (
  if not defined CI pause
  exit /b 1
)
