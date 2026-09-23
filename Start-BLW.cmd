@echo off
cd /d "%~dp0"
set "BLW_NODE=node"
if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "BLW_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
echo Open http://127.0.0.1:4173 in your browser after the ready message.
echo Keep this window open while using BLW ERP.
"%BLW_NODE%" server.mjs
pause
