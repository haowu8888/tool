# Runs the compiled tests .dev\desktest.exe on the desktop, where the screen
# can be captured, with the arguments of .dev\desktest.txt; the output goes to
# .dev\desktest.log. Run it through the interactive scheduled task ToolboxTest.
# The recording tests leave their videos in .dev\rec-out.
$dir = $PSScriptRoot
$log = Join-Path $dir "desktest.log"
$tmp = "$log.tmp"
$args = (Get-Content (Join-Path $dir "desktest.txt") -Raw).Trim()
Set-Location (Split-Path $dir)
# Copied over desktest.exe, the app runs with its log here, and CDP.
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9224"
$env:TOOLBOX_RECORD_OUT = Join-Path $dir "rec-out"
New-Item -ItemType Directory -Force $env:TOOLBOX_RECORD_OUT | Out-Null
cmd /c "`"$dir\desktest.exe`" $args > `"$tmp`" 2>&1"
Move-Item -Force $tmp $log
