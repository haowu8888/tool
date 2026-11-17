package main

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

// dataDir makes the app's data folder an empty one for the test and
// returns it.
func dataDir(t *testing.T) string {
	dir := t.TempDir()
	t.Setenv("AppData", dir)         // Windows
	t.Setenv("XDG_CONFIG_HOME", dir) // elsewhere
	dir = filepath.Join(dir, "Toolbox")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	return dir
}

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// A damaged data file gives way to its backup, which a write then leaves
// be rather than replace with the damaged file.
func TestReadJSONFallsBackOnBackup(t *testing.T) {
	dir := dataDir(t)
	file := filepath.Join(dir, "notes.json")
	type data struct{ Text string }

	var d data
	if err := readJSON("notes.json", &d); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("without a file: %v, want os.ErrNotExist", err)
	}
	if err := writeJSON("notes.json", data{"first"}); err != nil {
		t.Fatal(err)
	}
	// The second write keeps the first as the backup.
	if err := writeJSON("notes.json", data{"second"}); err != nil {
		t.Fatal(err)
	}
	if err := readJSON("notes.json", &d); err != nil || d.Text != "second" {
		t.Fatalf("read %q, %v, want second", d.Text, err)
	}

	write(t, file, `{"Text":"sec`) // cut short
	d = data{}
	if err := readJSON("notes.json", &d); err != nil || d.Text != "first" {
		t.Fatalf("from a damaged file: %q, %v, want the backup's first", d.Text, err)
	}
	if b, _ := os.ReadFile(file + ".broken"); string(b) != `{"Text":"sec` {
		t.Errorf("the damaged file was kept as %q", b)
	}
	// An old backup is due for replacing, but not by a damaged file.
	old := time.Now().Add(-48 * time.Hour)
	os.Chtimes(file+".bak", old, old)
	if err := writeJSON("notes.json", data{"third"}); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(file + ".bak"); !strings.Contains(string(b), "first") {
		t.Errorf("the backup became %s", b)
	}

	// Damaged without a backup: an error, and the file is left alone.
	os.Remove(file + ".bak")
	write(t, file, "")
	if err := readJSON("notes.json", &d); err == nil {
		t.Error("a damaged file without a backup read without an error")
	}
}

// The settings start as a copy of the defaults, which shares their slices:
// reading the file's overlay items must not write them over the defaults'.
func TestLoadKeepsDefaults(t *testing.T) {
	dir := dataDir(t)
	write(t, filepath.Join(dir, "settings.json"), `{"monitor":{"overlay":{"items":["net","mem"]}}}`)
	defaults := slices.Clone(defaultSettings.Monitor.Overlay.Items)

	st := &Settings{}
	if got := st.current().Monitor.Overlay.Items; !slices.Equal(got, []string{"net", "mem"}) {
		t.Errorf("items = %v, want the file's", got)
	}
	if got := defaultSettings.Monitor.Overlay.Items; !slices.Equal(got, defaults) {
		t.Errorf("the defaults became %v, want %v", got, defaults)
	}
}

// Appearance values out of range fall back, and a background picture can
// only name a file of the appearance folder.
func TestNormalizeAppearance(t *testing.T) {
	a := AppearanceSettings{Style: "neon", Accent: "red", Background: `..\..\secret.png`, Opacity: 5, Dim: 120, Blur: -3, Cards: 10}
	normalizeAppearance(&a)
	want := AppearanceSettings{Style: "default", Accent: "#3b82f6", Background: "", Opacity: 10, Dim: 90, Blur: 0, Cards: 40}
	if a != want {
		t.Errorf("got %+v, want %+v", a, want)
	}
	a = AppearanceSettings{Style: "mint", Accent: "#8B5CF6", Background: "bg-1.jpg", Dim: 0, Blur: 12, Cards: 0}
	normalizeAppearance(&a)
	want = AppearanceSettings{Style: "mint", Accent: "#8b5cf6", Background: "bg-1.jpg", Opacity: 100, Dim: 0, Blur: 12, Cards: 85}
	if a != want {
		t.Errorf("got %+v, want %+v", a, want)
	}
}
