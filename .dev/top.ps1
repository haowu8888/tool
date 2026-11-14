# Puts the toolbox's main window on top of the others, or back among them
# when .dev/top.txt says "off", for tests that capture the screen (the long
# screenshot). Run through the interactive scheduled task ToolboxTop; the
# result goes to .dev/top.log.
Add-Type @"
using System; using System.Runtime.InteropServices;
public class T {
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string c, string t);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint f);
}
"@
$off = (Get-Content (Join-Path $PSScriptRoot "top.txt") -ErrorAction SilentlyContinue) -eq "off"
$h = [T]::FindWindow([NullString]::Value, "工具箱")
$after = if ($off) { [IntPtr](-2) } else { [IntPtr](-1) } # HWND_NOTOPMOST, HWND_TOPMOST
$ok = [T]::SetWindowPos($h, $after, 0, 0, 0, 0, 0x0013) # SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE
"hwnd=$h topmost=$(-not $off) ok=$ok" | Set-Content -Encoding UTF8 (Join-Path $PSScriptRoot "top.log")
