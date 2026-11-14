# Quits the app started by launch.cmd.
Get-Process Toolbox -ErrorAction SilentlyContinue | Stop-Process -Force
