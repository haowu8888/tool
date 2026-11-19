package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestWriteShotFile(t *testing.T) {
	t.Setenv("TMP", t.TempDir())
	t.Setenv("TEMP", os.Getenv("TMP"))
	t.Setenv("TMPDIR", os.Getenv("TMP"))
	if err := os.MkdirAll(shotFileDir(), 0o755); err != nil {
		t.Fatal(err)
	}
	old := filepath.Join(shotFileDir(), "old.png")
	os.WriteFile(old, []byte("x"), 0o644)
	ago := time.Now().Add(-25 * time.Hour)
	os.Chtimes(old, ago, ago)

	a, err := writeShotFile([]byte("a"))
	if err != nil {
		t.Fatal(err)
	}
	b, err := writeShotFile([]byte("b"))
	if err != nil {
		t.Fatal(err)
	}
	if a == b || !isShotFile(a) || !isShotFile(b) {
		t.Fatalf("files %q %q", a, b)
	}
	if got, _ := os.ReadFile(b); !bytes.Equal(got, []byte("b")) {
		t.Fatalf("b holds %q", got)
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatal("a file of more than a day ago is kept")
	}
	if isShotFile(filepath.Join(os.Getenv("TMP"), "a.png")) {
		t.Fatal("a file elsewhere counts as a screenshot's")
	}
}
