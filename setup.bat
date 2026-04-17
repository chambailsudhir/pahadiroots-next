@echo off
echo.
echo ========================================
echo   Pahadi Roots Admin Panel - Setup
echo ========================================
echo.

set TARGET=C:\Users\chamb\pahadi-admin
set SOURCE=%~dp0pahadi-admin

echo [1/5] Copying all files...
xcopy /E /Y /I "%SOURCE%\src" "%TARGET%\src\"
xcopy /E /Y /I "%SOURCE%\public" "%TARGET%\public\"
copy /Y "%SOURCE%\.env.local" "%TARGET%\.env.local"
copy /Y "%SOURCE%\next.config.js" "%TARGET%\next.config.js"
copy /Y "%SOURCE%\package.json" "%TARGET%\package.json"
copy /Y "%SOURCE%\tailwind.config.js" "%TARGET%\tailwind.config.js"
copy /Y "%SOURCE%\postcss.config.mjs" "%TARGET%\postcss.config.mjs"

echo.
echo [2/5] Installing dependencies...
cd /d "%TARGET%"
call npm install recharts date-fns

echo.
echo [3/5] Clearing Next.js cache...
if exist ".next" rmdir /s /q ".next"

echo.
echo [4/5] Starting server...
echo.
echo ========================================
echo   Opening: http://localhost:3000/admin
echo   Password: 1147
echo ========================================
echo.
start "" "http://localhost:3000/admin"
call npm run dev

pause
