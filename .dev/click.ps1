# Clicks with injected mouse input, as remote desktop tools do, at the
# client-area point "x y" (DIPs) of the toolbox window read from
# .dev/click.txt. The window is raised first. Run through the interactive
# scheduled task ToolboxClick.
Add-Type @"
using System; using System.Runtime.InteropServices;
public class C {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, uint d, UIntPtr e);
  public struct POINT { public int X, Y; }
}
"@
[void][C]::SetProcessDPIAware()
$h = [C]::FindWindow([NullString]::Value, "工具箱")
if ($h -eq [IntPtr]::Zero) { "no window" | Out-File "$PSScriptRoot\click.log"; exit 1 }
$x, $y = (Get-Content "$PSScriptRoot\click.txt").Split(" ") | % { [double]$_ }
$scale = [C]::GetDpiForWindow($h) / 96
$p = New-Object C+POINT; [void][C]::ClientToScreen($h, [ref]$p)
$sx = [int]($p.X + $x * $scale); $sy = [int]($p.Y + $y * $scale)
[void][C]::SetWindowPos($h, [IntPtr](-1), 0, 0, 0, 0, 0x13) # topmost, no move/size/activate
Start-Sleep -Milliseconds 300
[void][C]::SetCursorPos($sx, $sy)
[C]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); [C]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 300
[void][C]::SetWindowPos($h, [IntPtr](-2), 0, 0, 0, 0, 0x13) # back to not topmost
"clicked $sx,$sy" | Out-File "$PSScriptRoot\click.log"
