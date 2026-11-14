# Closes the window 工具箱 as its X button does, which hides it to the tray,
# then left-clicks the tray icon, or, with a menu item named in
# .dev/tray.txt, right-clicks it and clicks that item, and writes the app's
# top-level windows, hidden ones too, before and after to .dev/tray.log.
# Run through the interactive scheduled task ToolboxTray.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class T {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, int e);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, int m, IntPtr w, IntPtr l);
  public struct RECT { public int L, T, R, B; }
}
"@
$log = "$PSScriptRoot\tray.log"
[void][T]::SetProcessDPIAware()
$item = ""
if (Test-Path "$PSScriptRoot\tray.txt") { $item = (Get-Content -Encoding UTF8 "$PSScriptRoot\tray.txt").Trim() }
$out = @()
function Windows($label) {
  $app = (Get-Process Toolbox -ErrorAction SilentlyContinue).Id
  $fg = [T]::GetForegroundWindow()
  $script:out += "-- $label"
  [T]::EnumWindows({ param($h, $p)
    $pid2 = 0; [void][T]::GetWindowThreadProcessId($h, [ref]$pid2)
    if ($app -contains $pid2) {
      $s = New-Object System.Text.StringBuilder 256; [void][T]::GetWindowText($h, $s, 256)
      $c = New-Object System.Text.StringBuilder 256; [void][T]::GetClassName($h, $c, 256)
      if ($s.Length -gt 0) {
        $r = New-Object T+RECT; [void][T]::GetWindowRect($h, [ref]$r)
        $script:out += "title=$s class=$c visible=$([T]::IsWindowVisible($h)) iconic=$([T]::IsIconic($h)) foreground=$($h -eq $fg) rect=$($r.L),$($r.T),$($r.R),$($r.B)"
      }
    }
    $true }, [IntPtr]::Zero) | Out-Null
}
$A = [Windows.Automation.AutomationElement]
$TS = [Windows.Automation.TreeScope]::Descendants
function Find($root, $name, $type) {
  $c = New-Object Windows.Automation.AndCondition (New-Object Windows.Automation.PropertyCondition ($A::NameProperty, $name)), (New-Object Windows.Automation.PropertyCondition ($A::ControlTypeProperty, $type))
  $root.FindFirst($TS, $c)
}
function Click($e) {
  $p = $null
  if ($e.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern, [ref]$p)) { $p.Invoke(); return }
  throw "cannot invoke $($e.Current.Name)"
}
try {
  $h = [T]::FindWindow("MyGoWindow", "工具箱")
  if ($h -ne [IntPtr]::Zero -and [T]::IsWindowVisible($h)) { [void][T]::PostMessage($h, 0x10, [IntPtr]::Zero, [IntPtr]::Zero); Start-Sleep -Milliseconds 800 } # WM_CLOSE
  Windows "before"
  $root = $A::RootElement
  $btn = [Windows.Automation.ControlType]::Button
  $icon = Find $root "工具箱" $btn
  if (-not $icon) {
    # The icon is in the overflow: open it first.
    $chevron = Find $root "显示隐藏的图标" $btn
    if (-not $chevron) { throw "no tray icon and no overflow button" }
    Click $chevron
    for ($i = 0; $i -lt 10 -and -not $icon; $i++) { Start-Sleep -Milliseconds 300; $icon = Find $root "工具箱" $btn }
  }
  if (-not $icon) {
    $names = $root.FindAll($TS, (New-Object Windows.Automation.PropertyCondition ($A::ControlTypeProperty, $btn))) | ForEach-Object { $_.Current.Name } | Where-Object { $_ }
    throw "no tray icon 工具箱; buttons: $($names -join ' | ')"
  }
  if ($item) {
    # Invoke is a left click: right-click with the mouse for the menu.
    $r = $icon.Current.BoundingRectangle
    [void][T]::SetCursorPos([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2))
    [T]::mouse_event(8, 0, 0, 0, 0); [T]::mouse_event(16, 0, 0, 0, 0)
    $mi = $null
    for ($i = 0; $i -lt 10 -and -not $mi; $i++) { Start-Sleep -Milliseconds 300; $mi = Find $root $item ([Windows.Automation.ControlType]::MenuItem) }
    if (-not $mi) {
      $names = $root.FindAll($TS, (New-Object Windows.Automation.PropertyCondition ($A::ControlTypeProperty, [Windows.Automation.ControlType]::MenuItem))) | ForEach-Object { $_.Current.Name }
      throw "no menu item $item; icon at $r; menu items: $($names -join ' | ')"
    }
    Click $mi
  } else {
    Click $icon
  }
  Start-Sleep -Milliseconds 1500
  Windows "after"
} catch { $out += "error: $_" }
$out | Out-File -Encoding UTF8 $log
