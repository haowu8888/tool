package main

import (
	"archive/zip"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestCompareVersions(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want int
	}{
		{"0.1.10", "0.1.9", 1},
		{"0.1.9", "0.1.10", -1},
		{"0.1.0", "0.1", 0},
		{"0.2.1", "0.10.0", -1},
		{"1.0.0", "0.99.99", 1},
	} {
		if got := compareVersions(c.a, c.b); got != c.want {
			t.Errorf("compareVersions(%q, %q) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}

func TestNewest(t *testing.T) {
	files := []shareFile{
		{Name: "Toolbox-0.1.9-portable.zip"},
		{Name: "toolbox-setup-0.1.9-amd64.exe"},
		{Name: "toolbox-setup-0.1.12-amd64.exe"},
		{Name: "Toolbox-0.1.12-portable.zip"},
		{Name: "toolbox-setup-0.9.0-amd64.exe", Type: 1}, // a folder
		{Name: "notes.txt"},
	}
	if f, v := newest(files, false); f == nil || v != "0.1.12" || f.Name != "toolbox-setup-0.1.12-amd64.exe" {
		t.Fatalf("installer: %v %q", f, v)
	}
	if f, v := newest(files, true); f == nil || v != "0.1.12" || f.Name != "Toolbox-0.1.12-portable.zip" {
		t.Fatalf("portable: %v %q", f, v)
	}
	if f, _ := newest(files[5:], false); f != nil {
		t.Fatalf("nothing to pick, got %v", f)
	}
}

func TestListShare(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v4/file":
			if got := r.URL.Query().Get("uri"); got != "cloudreve://test@share/" {
				t.Errorf("uri %q", got)
			}
			w.Write([]byte(`{"code":0,"data":{"files":[{"type":0,"name":"toolbox-setup-0.1.7-amd64.exe","size":5,"path":"cloudreve://test@share/toolbox-setup-0.1.7-amd64.exe","updated_at":"2026-11-16T14:01:30Z"}]}}`))
		case "/api/v4/file/url":
			var body struct {
				URIs []string `json:"uris"`
			}
			json.NewDecoder(r.Body).Decode(&body)
			if len(body.URIs) != 1 {
				t.Errorf("uris %v", body.URIs)
			}
			w.Write([]byte(`{"code":0,"data":{"urls":[{"url":"http://x/file"}]}}`))
		default:
			w.Write([]byte(`{"code":404,"msg":"Not found"}`))
		}
	}))
	defer srv.Close()
	server, share := updateServer, updateShare
	updateServer, updateShare = srv.URL, "test"
	defer func() { updateServer, updateShare = server, share }()

	files, err := listShare()
	if err != nil || len(files) != 1 || files[0].Size != 5 || files[0].UpdatedAt.IsZero() {
		t.Fatalf("listShare: %v %+v", err, files)
	}
	if link, err := downloadURL(files[0].Path); err != nil || link != "http://x/file" {
		t.Fatalf("downloadURL: %q %v", link, err)
	}
	if err := cloudreve(http.MethodGet, "/nope", nil, &struct{}{}); err == nil {
		t.Fatal("an error code should fail")
	}
}

func TestUnzip(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "a.zip")
	f, _ := os.Create(file)
	z := zip.NewWriter(f)
	for name, body := range map[string]string{"Toolbox.exe": "exe", "icon.png": "png", "sub/evil.exe": "no", "../up.exe": "no"} {
		w, _ := z.Create(name)
		w.Write([]byte(body))
	}
	z.Close()
	f.Close()
	out := filepath.Join(dir, "new")
	if err := unzip(file, out); err != nil {
		t.Fatal(err)
	}
	entries, _ := os.ReadDir(out)
	if len(entries) != 2 {
		t.Fatalf("want only the top level files, got %v", entries)
	}
	if b, _ := os.ReadFile(filepath.Join(out, "Toolbox.exe")); string(b) != "exe" {
		t.Fatalf("Toolbox.exe = %q", b)
	}
}
