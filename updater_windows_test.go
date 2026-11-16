package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// TestRunUpdaterPortable runs the script as an update of the zip does,
// with system tools standing in for the app: it waits for the process,
// copies the new files over the old and starts the exe.
func TestRunUpdaterPortable(t *testing.T) {
	sys := filepath.Join(os.Getenv("SystemRoot"), "System32")
	dir := t.TempDir()
	app, src := filepath.Join(dir, "app"), filepath.Join(dir, "new")
	os.MkdirAll(app, 0o755)
	os.MkdirAll(src, 0o755)
	copyFile := func(from, to string) {
		b, err := os.ReadFile(from)
		if err != nil {
			t.Fatal(err)
		}
		os.WriteFile(to, b, 0o755)
	}
	exe := filepath.Join(app, "app.exe")
	copyFile(filepath.Join(sys, "where.exe"), exe)
	copyFile(filepath.Join(sys, "hostname.exe"), filepath.Join(src, "app.exe"))
	want, _ := os.ReadFile(filepath.Join(src, "app.exe"))
	zip := filepath.Join(dir, "x.zip")
	os.WriteFile(zip, []byte("zip"), 0o644)

	// The script waits for this process, which stands for the app.
	app0 := exec.Command(filepath.Join(sys, "ping.exe"), "-n", "3", "127.0.0.1")
	if err := app0.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { app0.Process.Kill() })
	if err := runUpdaterFor(app0.Process.Pid, dir, zip, src, exe); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		got, _ := os.ReadFile(exe)
		if _, err := os.Stat(zip); bytes.Equal(got, want) && os.IsNotExist(err) {
			log, _ := os.ReadFile(filepath.Join(dir, "update.log"))
			t.Logf("update.log: %s", log)
			return
		}
		time.Sleep(300 * time.Millisecond)
	}
	log, _ := os.ReadFile(filepath.Join(dir, "update.log"))
	t.Fatalf("the exe was not replaced; update.log: %s", log)
}
