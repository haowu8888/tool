@echo off
rem Starts the built app with the WebView2 debug port 9224. Run it through the
rem interactive scheduled task ToolboxDev: the SSH session has no desktop.
set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9224
start "" "%~dp0..\build\windows-amd64\Toolbox.exe"
