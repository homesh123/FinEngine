@echo off
rem FinEngine live API. Started at boot by the "FinEngine live API" scheduled task (runs as SYSTEM,
rem no Remote Desktop log-on needed). Logs: C:\FinEngine\logs\api.log
set PYTHONUTF8=1
set ALLOWED_ORIGIN=*
if exist C:\FinEngine\finengine.env for /f "usebackq tokens=1,* delims==" %%a in ("C:\FinEngine\finengine.env") do set "%%a=%%b"
cd /d C:\FinEngine\app
C:\FinEngine\venv\Scripts\python.exe server\live_api.py --host 127.0.0.1 --port 8100 --warm >> C:\FinEngine\logs\api.log 2>&1
