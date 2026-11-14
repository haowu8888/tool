# Puts something on the desktop's clipboard, as another app copying would,
# for the clipboard history's tests. .dev/setclip.txt says what:
#   text:<text>   image:<png path>   files:<path>|<path>
# Run through the interactive scheduled task ToolboxSetClip; it writes
# .dev/setclip.log when done.
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$spec = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot "setclip.txt")
$kind, $value = $spec.TrimEnd("`r", "`n") -split ":", 2
switch ($kind) {
  "text" { [System.Windows.Forms.Clipboard]::SetText($value) }
  "image" { [System.Windows.Forms.Clipboard]::SetImage([System.Drawing.Image]::FromFile($value)) }
  "files" {
    $list = New-Object System.Collections.Specialized.StringCollection
    $value -split "\|" | ForEach-Object { [void]$list.Add($_) }
    [System.Windows.Forms.Clipboard]::SetFileDropList($list)
  }
}
"done $kind" | Set-Content -Encoding UTF8 (Join-Path $PSScriptRoot "setclip.log")
