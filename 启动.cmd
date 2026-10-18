@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0程序\对接层" || goto :failed
node 界面\服务.js --开 %*
set "exitCode=%errorlevel%"
if not "%exitCode%"=="0" (
  echo.
  echo 启动失败，按任意键关闭窗口。
  pause >nul
)
exit /b %exitCode%
:failed
echo 无法进入界面服务目录：%~dp0程序\对接层
echo 按任意键关闭窗口。
pause >nul
exit /b 1
