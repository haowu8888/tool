# A window with a text box that takes the keys, presses Ctrl+Alt+V itself
# (so that the clipboard history's popup comes up over it, as from a real
# key press there), and after 8 seconds writes what was pasted into it to
# .dev/pastetarget.log: the target for the clipboard history's paste test. Run through the interactive scheduled task
# ToolboxPasteTarget.
Add-Type -AssemblyName System.Windows.Forms
Add-Type 'using System; using System.Runtime.InteropServices; public class F { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t); [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h); }'
$script:fg = ""
$log = Join-Path $PSScriptRoot "pastetarget.log"
Remove-Item $log -ErrorAction SilentlyContinue
$f = New-Object System.Windows.Forms.Form
$f.Text = "粘贴测试"; $f.Width = 420; $f.Height = 160; $f.TopMost = $true; $f.StartPosition = "CenterScreen"
$t = New-Object System.Windows.Forms.TextBox
$t.Multiline = $true; $t.Dock = "Fill"
$f.Controls.Add($t)
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 8000
$timer.Add_Tick({ "pasted=[$($t.Text)] hadKeys=$script:fg" | Set-Content -Encoding UTF8 $log; $f.Close() })
$check = New-Object System.Windows.Forms.Timer
$check.Interval = 1500
$check.Add_Tick({
  $check.Stop()
  $script:fg = ([F]::GetForegroundWindow() -eq $f.Handle)
  if ($script:fg) { foreach ($k in 0x11, 0x12, 0x56) { [F]::keybd_event($k, 0, 0, [UIntPtr]::Zero) }; foreach ($k in 0x56, 0x12, 0x11) { [F]::keybd_event($k, 0, 2, [UIntPtr]::Zero) } }
})
# With "alt1" in .dev/pastetarget.txt it also picks the first item itself,
# by Alt+1 with Alt held for 300 ms as a hand does, and logs whether the
# popup is up again afterwards.
$alt = (Test-Path "$PSScriptRoot\pastetarget.txt") -and ((Get-Content "$PSScriptRoot\pastetarget.txt") -match "alt1")
$script:step = 0
$pick = New-Object System.Windows.Forms.Timer
$pick.Interval = 300
$pick.Add_Tick({
  $script:step++
  if ($script:step -eq 4) { [F]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [F]::keybd_event(0x31, 0, 0, [UIntPtr]::Zero); [F]::keybd_event(0x31, 0, 2, [UIntPtr]::Zero) }
  if ($script:step -eq 5) { [F]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero) }
  if ($script:step -eq 9) { $pick.Stop(); $script:fg = "$script:fg popupAfter=$([F]::IsWindowVisible([F]::FindWindow([NullString]::Value, [string][char]0x526A + [char]0x8D34 + [char]0x677F + [char]0x5386 + [char]0x53F2)))" }
})
if ($alt) { $check.Add_Tick({ $pick.Start() }) }
$f.Add_Shown({ [F]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [F]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero); $f.Activate(); $t.Focus(); $timer.Start(); $check.Start() })
[void]$f.ShowDialog()
