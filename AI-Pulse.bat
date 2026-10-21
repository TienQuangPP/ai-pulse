@echo off
title AI Pulse
cd /d "%~dp0"
where node >nul 2>nul || (echo Can cai Node.js 18+ tu https://nodejs.org & pause & exit /b 1)
start "" http://localhost:8787
node server\index.js
pause
