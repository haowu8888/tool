# Runs an interactive scheduled task and waits for its script's log file:
#   .dev\run-task.ps1 ToolboxClick click.log
param([string]$Task, [string]$Log)
$path = Join-Path $PSScriptRoot $Log
Remove-Item $path -ErrorAction SilentlyContinue
schtasks /run /tn $Task | Out-Null
for ($i = 0; $i -lt 60 -and -not (Test-Path $path); $i++) { Start-Sleep -Milliseconds 500 }
Start-Sleep -Milliseconds 800
if (Test-Path $path) { Get-Content -Encoding UTF8 $path } else { "timeout: $Task" }
