@echo off
cd /d "%~dp0"
title Fate Echo - 本地测试服务器
echo ============================================
echo   命运回响 - 本地测试服务器
echo   地址: http://localhost:8090
echo   关闭本窗口即停止服务器
echo ============================================
echo.
start "" "http://localhost:8090"
python -m http.server 8090
echo.
echo 服务器已停止。
pause
