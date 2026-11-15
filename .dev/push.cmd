@echo off
cd /d "%~dp0.."
git push origin main > .dev\push.tmp 2>&1
echo exit %errorlevel% >> .dev\push.tmp
move /y .dev\push.tmp .dev\push.log > nul
