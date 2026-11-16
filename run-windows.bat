@echo off
rem Opens the game in its own window using Microsoft Edge (already on Windows 10/11).
rem No install needed. If Edge is not found, falls back to the default browser.
start "" msedge --app="file:///%~dp0dist/index.html" || start "" "%~dp0dist\index.html"
