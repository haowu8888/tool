package main

import (
	"log"
	"os"
	"path/filepath"
)

// maxLogSize is how large the log file grows before it starts over.
const maxLogSize = 1 << 20

// logToFile sends the log to toolbox.log in the data folder as well: the
// app has no console, and what the displays did while the screen was dark
// can only be read afterwards. A large file is kept as .old and started
// over.
func logToFile() {
	p, err := configPath("toolbox.log")
	if err != nil {
		return
	}
	os.MkdirAll(filepath.Dir(p), 0o755)
	if fi, err := os.Stat(p); err == nil && fi.Size() > maxLogSize {
		os.Rename(p, p+".old")
	}
	f, err := os.OpenFile(p, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	log.SetOutput(logFile{f})
}

// logFile writes to the file and to the standard error, which fails
// without a console.
type logFile struct{ f *os.File }

func (l logFile) Write(b []byte) (int, error) {
	os.Stderr.Write(b)
	return l.f.Write(b)
}
