# Writes what the desktop's clipboard holds to .dev/clip.log: an image's
# size, or the text, then the files it holds if any. The SSH session has a clipboard of its own, so this
# runs through the interactive scheduled task ToolboxClip.
Add-Type -AssemblyName System.Windows.Forms
$img = [Windows.Forms.Clipboard]::GetImage()
$out = if ($img) { "image $($img.Width)x$($img.Height)" } elseif ([Windows.Forms.Clipboard]::ContainsText()) { "text: " + [Windows.Forms.Clipboard]::GetText() } else { "empty" }
$files = [Windows.Forms.Clipboard]::GetFileDropList()
if ($files.Count) { $out = "$out`nfiles: " + ($files -join " | ") }
$out | Set-Content -Encoding UTF8 (Join-Path $PSScriptRoot "clip.log")
