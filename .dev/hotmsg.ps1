# Posts WM_HOTKEY with the shortcut ID in .dev/hotmsg.txt to the app's
# MyGoApp window, as if the shortcut were pressed: injected keys do not
# get through while RustDesk's privacy mode blocks local input. MyGo
# numbers the shortcuts in the order they are registered: at launch 1
# Ctrl+Alt+B, 2 Ctrl+Alt+Space, 3 Ctrl+Alt+N; changing one in the settings
# gives it the next number. Run through the
# interactive scheduled task ToolboxHotMsg.
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class M {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, int m, IntPtr w, IntPtr l);
}
"@
$id = [int](Get-Content "$PSScriptRoot\hotmsg.txt").Trim()
$app = (Get-Process Toolbox -ErrorAction SilentlyContinue).Id
$script:sent = "no MyGoApp window"
[M]::EnumWindows({ param($h, $p)
  $pid2 = 0; [void][M]::GetWindowThreadProcessId($h, [ref]$pid2)
  $c = New-Object System.Text.StringBuilder 64; [void][M]::GetClassName($h, $c, 64)
  if ($app -contains $pid2 -and $c.ToString() -eq "MyGoApp") { $script:sent = "posted ${id}: $([M]::PostMessage($h, 0x312, [IntPtr]$id, [IntPtr]::Zero))" }
  $true }, [IntPtr]::Zero) | Out-Null
$sent | Out-File -Encoding UTF8 "$PSScriptRoot\hotmsg.log"
