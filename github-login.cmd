@echo off
call "%~dp0env.cmd"
echo Logging in to GitHub for Starstation. A browser page will ask for a one-time code.
gh auth login --hostname github.com --git-protocol https --web --insecure-storage
gh auth setup-git
echo.
gh auth status
pause