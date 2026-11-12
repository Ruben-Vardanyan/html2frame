@echo off
rem html2frame (Windows): double-click to start. The first start checks this computer and asks about the icons
rem (src/setup.js, D21). html2frame then runs in this window: Quit in the panel, or closing the window, stops it.
cd /d "%~dp0"
if not exist "%~dp0server.js" (
	echo.
	echo   Extract the ZIP first: right-click the downloaded ZIP, choose "Extract All", then open
	echo   "Start (Windows)" in the extracted folder.
	echo.
	pause
	exit /b 1
)
rem keep the version in step with "engines" in package.json
where node >nul 2>nul
if errorlevel 1 (
	echo.
	echo   [!!] Node.js is missing. Please install Node.js 20 or newer from https://nodejs.org ^(the LTS version^),
	echo        then start html2frame again.
	echo.
	pause
	exit /b 1
)
title html2frame
node src\start.js
rem stopped by Quit: the window closes; a problem: it stays, to be read
if errorlevel 1 (
	pause
	exit /b 1
)
