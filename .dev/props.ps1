# Writes the state of the app's visible windows to .dev/props.txt:
# extended styles and display affinity (17 = WDA_EXCLUDEFROMCAPTURE). Run
# through the interactive scheduled task ToolboxProps.
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class P {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern bool GetWindowDisplayAffinity(IntPtr h, out uint a);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumProc f, IntPtr p);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  public struct RECT { public int L, T, R, B; }
}
"@
[void][P]::SetProcessDPIAware()
$app = (Get-Process Toolbox -ErrorAction SilentlyContinue).Id
$out = @()
[P]::EnumWindows({ param($h, $p)
  $s = New-Object System.Text.StringBuilder 256
  [void][P]::GetWindowText($h, $s, 256)
  $pid2 = 0; [void][P]::GetWindowThreadProcessId($h, [ref]$pid2)
  if ($app -contains $pid2 -and [P]::IsWindowVisible($h)) {
    $r = New-Object P+RECT; [void][P]::GetWindowRect($h, [ref]$r)
    $ex = [P]::GetWindowLong($h, -20); $a = 0; [void][P]::GetWindowDisplayAffinity($h, [ref]$a)
    $script:out += "title=$($s.ToString()) rect=$($r.L),$($r.T),$($r.R),$($r.B) topmost=$([bool]($ex -band 8)) transparent=$([bool]($ex -band 0x20)) layered=$([bool]($ex -band 0x80000)) affinity=$a"
    $c = New-Object P+RECT; [void][P]::GetClientRect($h, [ref]$c)
    $script:out += "  dpi=$([P]::GetDpiForWindow($h)) client=$($c.R)x$($c.B)"
    [P]::EnumChildWindows($h, { param($k, $q)
      $n = New-Object System.Text.StringBuilder 256; [void][P]::GetClassName($k, $n, 256)
      $kr = New-Object P+RECT; [void][P]::GetWindowRect($k, [ref]$kr)
      $script:out += "  child $($n.ToString()) $($kr.L),$($kr.T),$($kr.R),$($kr.B) visible=$([P]::IsWindowVisible($k))"
      return $true }, [IntPtr]::Zero) | Out-Null
  }
  return $true }, [IntPtr]::Zero) | Out-Null
if (-not $out) { $out = "none" }
$out | Out-File -Encoding UTF8 "$PSScriptRoot\props.txt"
