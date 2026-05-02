@echo off
:: ============================================================================
:: Xova launcher — start Vite + the existing debug binary together.
:: NO REBUILD. Uses the binary that's already on disk; just brings up the
:: dev server and the window in the right order. After laptop reboot, this
:: is what you double-click to bring Xova back up.
::
:: Per Adam's NEVER REBUILD rule (2026-05-02), this script does NOT call
:: `npm run tauri build` or `cargo build`. It only starts the existing
:: target\debug\xova.exe and the Vite frontend dev server.
:: ============================================================================

echo.
echo === Xova launcher (no-rebuild path) ===
echo.

cd /d "%~dp0app"

:: 1. Start Vite dev server in a minimised window
echo [1/3] Starting Vite dev server on http://localhost:5174 ...
start "Xova Vite" /MIN cmd /c "npm run dev"

:: 2. Wait until Vite is responding (max ~30s)
echo [2/3] Waiting for Vite to respond ...
set /a tries=0
:waitloop
timeout /t 1 /nobreak >nul
curl -s -o nul http://localhost:5174/ 2>nul
if %errorlevel% equ 0 goto viteup
set /a tries+=1
if %tries% lss 30 goto waitloop
echo   ! Vite didn't come up after 30s. Check the "Xova Vite" window for errors.
goto :eof
:viteup
echo   Vite is up.

:: 3. Launch the existing debug binary (it loads frontend from devUrl=localhost:5174)
echo [3/3] Launching Xova window (target\debug\xova.exe) ...
start "" "%~dp0app\src-tauri\target\debug\xova.exe"

echo.
echo === Xova should be visible. Closing this window won't kill Xova or Vite. ===
echo.

:: Self-close after 5s so user doesn't have to ctrl+c
timeout /t 5 /nobreak >nul
