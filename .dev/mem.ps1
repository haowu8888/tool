# Lists the app's memory and CPU time with its WebView2 processes, to
# .dev/mem.log or the console.
$tb = Get-Process Toolbox
"Toolbox: {0:N0} MB, cpu {1:N1}s, since {2}, threads {3}, handles {4}" -f ($tb.WorkingSet64/1MB), $tb.CPU, $tb.StartTime.ToString("HH:mm:ss"), $tb.Threads.Count, $tb.HandleCount
$all = Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'"
$ids = @($tb.Id)
$sum = 0; $n = 0
do {
  $more = $all | Where-Object { $ids -contains $_.ParentProcessId -and $ids -notcontains $_.ProcessId }
  foreach ($k in $more) {
    $ids += $k.ProcessId
    $p = Get-Process -Id $k.ProcessId -ErrorAction SilentlyContinue
    if ($p) {
      $sum += $p.WorkingSet64; $n++
      $type = if ($k.CommandLine -match "--type=([a-z-]+)") { $Matches[1] } else { "browser" }
      "{0,-12} {1,6:N0} MB cpu {2:N1}s" -f $type, ($p.WorkingSet64/1MB), $p.CPU
    }
  }
} while ($more)
"webview total: {0:N0} MB in {1} processes; now {2}" -f ($sum/1MB), $n, (Get-Date).ToString("HH:mm:ss")
