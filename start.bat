@echo off
rem html2frame control panel (Windows): double-click to start; it opens http://localhost:5600
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
	echo Node.js 18 or newer is needed: https://nodejs.org
	pause
	exit /b 1
)
if not exist node_modules\playwright-core (
	echo First start: installing playwright-core ^(no browser download^)...
	call npm install --omit=dev --no-audit --no-fund
	if errorlevel 1 (
		echo npm install failed.
		pause
		exit /b 1
	)
)
node server.js --open
pause
