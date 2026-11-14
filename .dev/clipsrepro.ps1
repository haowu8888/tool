# Presses Ctrl+Alt+V the way a person does (holding Ctrl+Alt a moment
# after V) over a test window, then for 2 seconds logs whether the
# clipboard history's popup is visible and which window is in front, to
# .dev/clipsrepro.log. .dev/clipsrepro.txt sets how long Ctrl+Alt is held
# (ms). Run through the interactive scheduled task
# ToolboxClipsRepro.
Add-Type -AssemblyName System.Windows.Forms
Add-Type 'using System; using System.Text; using System.Runtime.InteropServices; public class F { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t); [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n); public delegate bool EnumProc(IntPtr h, IntPtr p); [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid); public static IntPtr Popup(uint app) { IntPtr found = IntPtr.Zero; EnumWindows((h, p) => { uint pid; GetWindowThreadProcessId(h, out pid); if (pid == app && Title(h) == "\u526a\u8d34\u677f\u5386\u53f2") { found = h; return false; } return true; }, IntPtr.Zero); return found; } public static string Title(IntPtr h) { var s = new StringBuilder(200); GetWindowText(h, s, 200); return s.ToString(); } }'
$log = Join-Path $PSScriptRoot "clipsrepro.log"
Remove-Item $log -ErrorAction SilentlyContinue
$hold = 400
$app = [uint32](Get-Process Toolbox).Id
if (Test-Path "$PSScriptRoot\clipsrepro.txt") { $hold = [int](Get-Content "$PSScriptRoot\clipsrepro.txt").Trim() }
$f = New-Object System.Windows.Forms.Form
$f.Text = "剪贴板复现"; $f.Width = 420; $f.Height = 160; $f.TopMost = $true; $f.StartPosition = "CenterScreen"
$t = New-Object System.Windows.Forms.TextBox
$t.Multiline = $true; $t.Dock = "Fill"
$f.Controls.Add($t)
$script:out = @()
$check = New-Object System.Windows.Forms.Timer
$check.Interval = 1200
$script:sw = $null
$script:released = $false
$script:n = 0
$sample = New-Object System.Windows.Forms.Timer
$sample.Interval = 40
$sample.Add_Tick({
  $ms = $script:sw.ElapsedMilliseconds
  if (-not $script:released -and $ms -ge $hold) { [F]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero); [F]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero); $script:released = $true; $script:out += "${ms}ms released" }
  $p = [F]::Popup($app)
  $fg = [F]::GetForegroundWindow()
  $script:out += "${ms}ms popup=$(if ($p -ne [IntPtr]::Zero) { [F]::IsWindowVisible($p) } else { 'none' }) fg=[$([F]::Title($fg))]"
  # With .dev/clipsrepro-away.txt, the test window takes the keys back
  # after 1.5 seconds, as a click elsewhere: the popup should hide.
  if ($script:n -eq 35 -and (Test-Path "$PSScriptRoot\clipsrepro-away.txt")) { [F]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [F]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero); $f.Activate(); $script:out += "${ms}ms away" }
  # With .dev/clipsrepro-again.txt, the shortcut is pressed once more after
  # a second: the popup should go away, and the test window have the keys.
  if ($script:n -eq 25 -and (Test-Path "$PSScriptRoot\clipsrepro-again.txt")) { foreach ($k in 0x11, 0x12, 0x56) { [F]::keybd_event($k, 0, 0, [UIntPtr]::Zero) }; foreach ($k in 0x56, 0x12, 0x11) { [F]::keybd_event($k, 0, 2, [UIntPtr]::Zero) }; $script:out += "${ms}ms again" }
  if (++$script:n -ge 60) {
    $sample.Stop()
    if (-not $script:released) { [F]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero); [F]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero) }
    $script:out | Set-Content -Encoding UTF8 $log
    $f.Close()
  }
})
$check.Add_Tick({
  $check.Stop()
  $script:out += "fg-is-form=$([F]::GetForegroundWindow() -eq $f.Handle)"
  $script:sw = [Diagnostics.Stopwatch]::StartNew()
  [F]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero); [F]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
  [F]::keybd_event(0x56, 0, 0, [UIntPtr]::Zero); [F]::keybd_event(0x56, 0, 2, [UIntPtr]::Zero)
  $sample.Start()
})
$f.Add_Shown({ [F]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [F]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero); $f.Activate(); $t.Focus(); $check.Start() })
[void]$f.ShowDialog()
