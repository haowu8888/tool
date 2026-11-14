# Lists the WinRT interfaces shot_windows.go calls, with their IIDs and
# methods in vtable order (after IInspectable's six), from Windows'
# metadata, into .dev/winrt-dump.txt. Check a new call's place here.
$ErrorActionPreference = "Continue"
$types = @(
  [Windows.Media.Ocr.OcrEngine,Windows.Media,ContentType=WindowsRuntime],
  [Windows.Media.Ocr.OcrResult,Windows.Media,ContentType=WindowsRuntime],
  [Windows.Media.Ocr.OcrLine,Windows.Media,ContentType=WindowsRuntime],
  [Windows.Media.Ocr.OcrWord,Windows.Media,ContentType=WindowsRuntime],
  [Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics,ContentType=WindowsRuntime],
  [Windows.Graphics.Imaging.BitmapBuffer,Windows.Graphics,ContentType=WindowsRuntime],
  [Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]
)
$out = @()
foreach ($t in $types) {
  $all = $t.Assembly.GetTypes() | ? { $_.IsInterface -and $_.Namespace -eq $t.Namespace -and ($_.Name -eq "I$($t.Name)" -or $_.Name -eq "I$($t.Name)Statics" -or $_.Name -eq "I$($t.Name)Factory") }
  foreach ($i in $all) {
    $out += "== $($i.FullName) {$($i.GUID)}"
    $i.GetMethods() | Sort-Object MetadataToken | % { $out += "  " + $_.Name + "(" + (($_.GetParameters() | % { $_.ParameterType.Name }) -join ", ") + ") -> " + $_.ReturnType.Name }
  }
}
$out | Set-Content -Encoding UTF8 (Join-Path $PSScriptRoot "winrt-dump.txt")
