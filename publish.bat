@echo off
chcp 65001 >nul
setlocal

echo ============================================
echo   stagelab 一键发布脚本
echo ============================================
echo.

rem ---- [0] 检查包名是否被官方源占用 ----
echo [0/5] 检查包名 "stagelab" 占用情况 ...
npm view stagelab version >nul 2>&1
if %errorlevel%==0 (
  echo   [警告] 包名 "stagelab" 在 npm 官方源已存在（版本见下）。若是他人包，请改名或加 scope。
  for /f "delims=" %%v in ('npm view stagelab version 2^>nul') do echo   当前线上版本：%%v
) else (
  echo   [OK] 包名 "stagelab" 当前可注册。
)
echo.

rem ---- [1] 构建发布包（esbuild bundle + 拷贝 web 产物）----
echo [1/5] 执行 npm run build:release ...
call npm run build:release
if errorlevel 1 goto :fail

rem ---- [2] 预览发布内容 ----
echo.
echo [2/5] 预览发布内容（files=dist，应只含 cli.mjs 与 web/）...
call npm pack --dry-run
if errorlevel 1 goto :fail

rem ---- [3] 人工确认 ----
echo.
echo [3/5] 确认无误后继续发布（取消按 Ctrl+C）...
pause

rem ---- [4] 正式发布（prepublishOnly 会再次 build:release）----
echo.
echo [4/5] 执行 npm publish ...
call npm publish
if errorlevel 1 goto :fail

rem ---- [5] 全局安装验证 ----
echo.
echo [5/5] 全局安装验证 ...
call npm install -g stagelab
if errorlevel 1 goto :fail

echo.
echo ============================================
echo   发布完成！验证：stagelab start / stagelab mcp
echo ============================================
goto :end

:fail
echo.
echo   [!] 步骤失败，请检查上方输出后重试。

:end
endlocal
pause