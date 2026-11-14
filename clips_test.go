package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func text(s, source string) *clipEntry {
	return &clipEntry{ClipItem: ClipItem{Kind: "text", Source: source}, Full: s}
}

// An item the app puts back on the clipboard moves first and keeps the
// app it came from; nothing of the history is kept beside its file.
func TestClipsSourceAndNoBackup(t *testing.T) {
	dir := dataDir(t)
	write(t, filepath.Join(dir, "clipboard.json.bak"), `[{"id":"old","kind":"text","full":"secret"}]`)
	c := &Clips{settings: &Settings{}}
	c.add(text("a", "chrome"), false)
	c.add(text("b", "code"), false)
	c.add(text("a", ""), true)
	if e := c.items[0]; len(c.items) != 2 || e.Full != "a" || e.Source != "chrome" {
		t.Fatalf("copied again by the app: %+v", c.items)
	}
	c.add(text("a", "word"), false)
	if e := c.items[0]; len(c.items) != 2 || e.Source != "word" {
		t.Fatalf("copied again in another app: %+v", c.items)
	}
	c.Clear()
	for _, name := range []string{"clipboard.json.bak", "clipboard.json.broken"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err == nil {
			t.Errorf("%s is left", name)
		}
	}
	b, _ := os.ReadFile(filepath.Join(dir, "clipboard.json"))
	if string(b) != "[]" {
		t.Errorf("after clearing: %s", b)
	}
}

// Pictures past what they may take go, oldest first; the newest and the
// pinned stay.
func TestClipsTrimPictures(t *testing.T) {
	dataDir(t)
	c := &Clips{settings: &Settings{}, loaded: true}
	pic := func(id string, mb int64, pinned bool) clipEntry {
		return clipEntry{ClipItem: ClipItem{ID: id, Kind: "image", Pinned: pinned}, Size: mb << 20}
	}
	c.items = []clipEntry{pic("huge", 300, false), pic("pinned", 500, true), *text("t", ""), pic("big", 150, false), pic("small", 10, false)}
	c.trim()
	var ids []string
	for _, e := range c.items {
		ids = append(ids, e.ID)
	}
	if len(ids) != 3 || ids[0] != "huge" || ids[1] != "pinned" || ids[2] != "" {
		t.Fatalf("kept %q", ids)
	}
}

// Items past their days go, but the pinned; programs left out are told
// by name, whatever the case, with or without .exe.
func TestClipsDaysAndExclude(t *testing.T) {
	dir := dataDir(t)
	write(t, filepath.Join(dir, "settings.json"), `{"clipboard": {"days": 7, "exclude": [" KeePass.exe ", "windowsterminal", "keepass", ""]}}`)
	st := &Settings{}
	cfg := st.current().Clipboard
	if len(cfg.Exclude) != 2 || !cfg.excludes("KeePass") || !cfg.excludes("WindowsTerminal") || cfg.excludes("chrome") || cfg.excludes("") {
		t.Fatalf("exclude %q", cfg.Exclude)
	}
	c := &Clips{settings: st, loaded: true}
	now := time.Now()
	at := func(id string, days int, pinned bool) clipEntry {
		return clipEntry{ClipItem: ClipItem{ID: id, Kind: "text", Pinned: pinned, Time: now.AddDate(0, 0, -days).UnixMilli()}}
	}
	c.items = []clipEntry{at("new", 0, false), at("week", 6, false), at("old", 8, false), at("kept", 100, true)}
	c.expire()
	if len(c.items) != 3 || c.items[0].ID != "new" || c.items[1].ID != "week" || c.items[2].ID != "kept" {
		t.Fatalf("kept %+v", c.items)
	}
}
