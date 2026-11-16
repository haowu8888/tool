package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

// updateScript waits for the app to end, installs the new build (the
// installer silently, or the zip's files over the old ones), and starts
// the app again in any case. update.log beside it tells what failed.
const updateScript = `$ErrorActionPreference = 'Stop'
$log = Join-Path $PSScriptRoot 'update.log'
function Note($m) { Add-Content -LiteralPath $log -Value ("{0:HH:mm:ss} {1}" -f (Get-Date), $m) -Encoding UTF8 }
try {
  Wait-Process -Id {{pid}} -Timeout 60 -ErrorAction SilentlyContinue
  if (Get-Process -Id {{pid}} -ErrorAction SilentlyContinue) { Note 'still running, killing'; Stop-Process -Id {{pid}} -Force; Start-Sleep 1 }
  if ({{setup}}) {
    $p = Start-Process -FilePath '{{file}}' -ArgumentList '/S' -Wait -PassThru
    Note "installer exited $($p.ExitCode)"
  } else {
    foreach ($f in Get-ChildItem -LiteralPath '{{src}}') {
      for ($i = 1; ; $i++) {
        try { Copy-Item -LiteralPath $f.FullName -Destination '{{dir}}' -Force; break }
        catch { if ($i -ge 20) { throw }; Start-Sleep -Milliseconds 500 }
      }
    }
    Note 'files copied'
  }
} catch { Note $_ }
finally {
  Start-Process -FilePath '{{exe}}' -WorkingDirectory '{{dir}}'
  Remove-Item -LiteralPath '{{file}}' -Force -ErrorAction SilentlyContinue
  if ('{{src}}') { Remove-Item -LiteralPath '{{src}}' -Recurse -Force -ErrorAction SilentlyContinue }
}
`

// runUpdater starts the script, which outlives the app: file is the
// download, src the zip's files (empty for the installer), exe the app.
func runUpdater(tmp, file, src, exe string) error {
	return runUpdaterFor(os.Getpid(), tmp, file, src, exe)
}

// runUpdaterFor waits for the process pid instead of the app's.
func runUpdaterFor(pid int, tmp, file, src, exe string) error {
	quote := func(s string) string { return strings.ReplaceAll(s, "'", "''") }
	setup := "$true"
	if src != "" {
		setup = "$false"
	}
	script := strings.NewReplacer(
		"{{pid}}", strconv.Itoa(pid),
		"{{setup}}", setup,
		"{{file}}", quote(file),
		"{{src}}", quote(src),
		"{{dir}}", quote(filepath.Dir(exe)),
		"{{exe}}", quote(exe),
	).Replace(updateScript)
	p := filepath.Join(tmp, "update.ps1")
	// With a BOM, or Windows PowerShell 5 reads Chinese paths wrong.
	if err := os.WriteFile(p, append([]byte{0xEF, 0xBB, 0xBF}, script...), 0o644); err != nil {
		return err
	}
	ps := filepath.Join(os.Getenv("SystemRoot"), `System32\WindowsPowerShell\v1.0\powershell.exe`)
	cmd := exec.Command(ps, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", p)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}
