# Closes the window 工具箱 as its X button does and writes whether the app
# still runs 2 seconds later to .dev/close.log. Run through the interactive
# scheduled task ToolboxClose.
Add-Type @"
using System; using System.Runtime.InteropServices;
public class C {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, int m, IntPtr w, IntPtr l);
}
"@
$h = [C]::FindWindow("MyGoWindow", "工具箱")
[void][C]::PostMessage($h, 0x10, [IntPtr]::Zero, [IntPtr]::Zero)
Start-Sleep 2
$p = Get-Process Toolbox -ErrorAction SilentlyContinue
"hwnd=$h running=$([bool]$p)" | Out-File -Encoding UTF8 "$PSScriptRoot\close.log"
