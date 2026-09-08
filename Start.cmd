@echo off
setlocal
cd /d "%~dp0"
set OPEN_BROWSER=1
if not exist "apps\web\dist\index.html" (
  call pnpm build
  if errorlevel 1 exit /b 1
)
node scripts/tasks.mjs start
if errorlevel 1 pause
