# Captures the whole virtual desktop, topmost windows included, to
# .dev/desktop.png. Run through the interactive scheduled task ToolboxShot.
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type 'using System.Runtime.InteropServices; public class Dpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
[void][Dpi]::SetProcessDPIAware()
$v = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $v.Width, $v.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($v.X, $v.Y, 0, 0, $bmp.Size)
$bmp.Save("$PSScriptRoot\desktop.png")
"$($v.Width)x$($v.Height)" | Out-File "$PSScriptRoot\desktop.txt"
