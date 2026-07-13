@echo off
cd /d "%~dp0"
echo Starting Vercel-ready attendance platform at http://localhost:8788/
echo Keep this window open while testing locally.
"C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" local-server.js
pause
