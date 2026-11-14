# Tries to register shortcuts and writes which are taken to .dev/probe.log:
# 1409 means another program, the app say, holds it. Also the foreground
# window, as an elevated one blocks injected input. Run through the
# interactive scheduled task ToolboxProbe.
Add-Type 'using System; using System.Runtime.InteropServices; public class H { [DllImport("user32.dll", SetLastError = true)] public static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint vk); [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr h, int id); }'
$out = @()
foreach ($c in @(@("Ctrl+Alt+Space", 3, 0x20), @("Ctrl+Alt+B", 3, 0x42), @("Ctrl+Shift+B", 6, 0x42), @("Alt+Space", 1, 0x20), @("Ctrl+Space", 2, 0x20), @("Ctrl+Alt+L", 3, 0x4C), @("Ctrl+Alt+K", 3, 0x4B), @("Ctrl+Alt+N", 3, 0x4E), @("Ctrl+Alt+J", 3, 0x4A))) {
  if ([H]::RegisterHotKey([IntPtr]::Zero, 1, $c[1] -bor 0x4000, $c[2])) { [void][H]::UnregisterHotKey([IntPtr]::Zero, 1); $out += "$($c[0]) free" }
  else { $out += "$($c[0]) taken $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
}
Add-Type 'using System; using System.Runtime.InteropServices; using System.Text; public class F { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); }'
$fg = [F]::GetForegroundWindow(); $sb = New-Object Text.StringBuilder 256; [void][F]::GetWindowText($fg, $sb, 256); $fp = 0; [void][F]::GetWindowThreadProcessId($fg, [ref]$fp)
$proc = Get-Process -Id $fp -ErrorAction SilentlyContinue
$out += "foreground: $sb [$($proc.ProcessName)]"
$out | Out-File -Encoding UTF8 "$PSScriptRoot\probe.log"
