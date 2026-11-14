# Presses a shortcut as real keyboard input: Ctrl+Alt+B, or the virtual
# key codes in .dev/hotkey.txt, as "0x11 0x12 0x20" for Ctrl+Alt+Space.
# Run through the interactive scheduled task ToolboxKey, since the SSH
# session has no desktop.
Add-Type 'using System.Runtime.InteropServices; public class K { [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, System.UIntPtr e); }'
$keys = 0x11, 0x12, 0x42
if (Test-Path "$PSScriptRoot\hotkey.txt") { $keys = (Get-Content "$PSScriptRoot\hotkey.txt").Trim() -split "\s+" | ForEach-Object { [byte][int]$_ } }
foreach ($k in $keys) { [K]::keybd_event($k, 0, 0, [UIntPtr]::Zero) }
[array]::Reverse($keys)
foreach ($k in $keys) { [K]::keybd_event($k, 0, 2, [UIntPtr]::Zero) }
"pressed" | Out-File "$PSScriptRoot\hotkey.log"
