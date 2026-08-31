@echo off
setlocal
title fourstage launcher

echo ============================================
echo   fourstage multi-window launcher
echo   Will open 3 cmd windows:
echo     [1] MCP  server
echo     [2] HTTP server
echo     [3] Web  frontend
echo ============================================
echo.

cd /d "%~dp0"

REM New windows inherit the current working directory (project root).

REM Start MCP server (stdio mode, logs to stderr, see its own window)
:: start "fourstage-mcp" cmd /k "npm.cmd run dev:mcp"

REM Start HTTP server (port 3000)
start "fourstage-http" cmd /k "npm.cmd run dev:http"

REM Start web frontend (vite, port 5173, /api proxied)
start "fourstage-web" cmd /k "npm.cmd run dev:web"

echo.
echo Three windows launched. MCP loads registered repos automatically.
echo To point MCP at a specific repo, add  --repo ^<path^>  manually in its window.
pause