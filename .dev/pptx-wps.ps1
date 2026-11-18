# Opens .dev\doc-out\test.pptx in WPS presentation over COM and exports it
# to a PDF, to see the file is one WPS takes.
$f = "D:\AI\claude-docker\workspace\tool\.dev\doc-out\test.pptx"
$o = "D:\AI\claude-docker\workspace\tool\.dev\doc-out\test-wps.pdf"
try {
  $app = New-Object -ComObject KWPP.Application
  $p = $app.Presentations.Open($f, $true, $false, $false)
  "slides: " + $p.Slides.Count
  $p.SaveAs($o, 32)
  $p.Close()
  $app.Quit()
  "exported: " + (Test-Path $o)
} catch { "error: " + $_ }
