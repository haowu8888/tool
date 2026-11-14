package main

import (
	"encoding/base64"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/egoist/mygo"
)

// The images, videos and attachments of notes are files in notes-files in
// the app's data folder, which pages load through the notefile scheme.
// WebView2 serves notefile://localhost/<name> at this address, which the
// notes keep.
const noteFileScheme = "notefile"

const noteFileURL = "http://notefile.localhost/"

// NoteFile is a file a note shows or links to.
type NoteFile struct {
	URL  string `json:"url"`
	Name string `json:"name"` // the name the user knows it by
	Size int64  `json:"size"`
	Kind string `json:"kind"` // image, video or file
}

// serveNoteFiles registers the notefile scheme; call it before any window
// is made.
func serveNoteFiles() {
	dir, err := configPath("notes-files")
	if err != nil {
		log.Println("note files:", err)
		return
	}
	files := http.FileServer(http.Dir(dir))
	mygo.Protocol.HandleFunc(noteFileScheme, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "max-age=31536000, immutable")
		files.ServeHTTP(w, r)
	})
}

// SaveFile keeps a file the page has, as a pasted image, given base64.
func (n *Notes) SaveFile(name, data string) (NoteFile, error) {
	b, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return NoteFile{}, err
	}
	return storeNoteFile(name, func(w io.Writer) error {
		_, err := w.Write(b)
		return err
	})
}

// ImportFiles copies files, as dropped on the window, into the notes'.
func (n *Notes) ImportFiles(paths []string) ([]NoteFile, error) {
	var out []NoteFile
	for _, p := range paths {
		st, err := os.Stat(p)
		if err != nil {
			return out, err
		}
		if st.IsDir() {
			continue
		}
		f, err := storeNoteFile(filepath.Base(p), func(w io.Writer) error {
			src, err := os.Open(p)
			if err != nil {
				return err
			}
			defer src.Close()
			_, err = io.Copy(w, src)
			return err
		})
		if err != nil {
			return out, err
		}
		out = append(out, f)
	}
	return out, nil
}

// PickFiles asks for files of a kind, image, video or file, and copies
// them into the notes'.
func (n *Notes) PickFiles(kind string, multiple bool) ([]NoteFile, error) {
	opts := mygo.OpenDialogOptions{Title: "选择文件", Multiple: multiple}
	switch kind {
	case "image":
		opts.Title = "选择图片"
		opts.Filters = []mygo.FileFilter{{Name: "图片", Extensions: []string{"png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"}}}
	case "video":
		opts.Title = "选择视频"
		opts.Filters = []mygo.FileFilter{{Name: "视频", Extensions: []string{"mp4", "webm", "mov", "m4v", "ogg"}}}
	}
	paths, err := mygo.Dialog.Open(opts)
	if err != nil || len(paths) == 0 {
		return nil, err
	}
	return n.ImportFiles(paths)
}

// OpenFile opens a note's attachment with its application.
func (n *Notes) OpenFile(url string) error {
	p, err := noteFilePath(url)
	if err != nil {
		return err
	}
	return mygo.Shell.OpenPath(p)
}

// RevealFile shows a note's attachment in Explorer.
func (n *Notes) RevealFile(url string) error {
	p, err := noteFilePath(url)
	if err != nil {
		return err
	}
	mygo.Shell.ShowItemInFolder(p)
	return nil
}

// storeNoteFile writes a file under a new name that keeps the extension.
func storeNoteFile(name string, write func(io.Writer) error) (NoteFile, error) {
	dir, err := configPath("notes-files")
	if err != nil {
		return NoteFile{}, err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return NoteFile{}, err
	}
	ext := strings.ToLower(filepath.Ext(name))
	stored := newID() + ext
	f, err := os.Create(filepath.Join(dir, stored))
	if err != nil {
		return NoteFile{}, err
	}
	err = write(f)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(f.Name())
		return NoteFile{}, err
	}
	st, _ := os.Stat(f.Name())
	return NoteFile{URL: noteFileURL + stored, Name: name, Size: st.Size(), Kind: fileKind(ext)}, nil
}

func fileKind(ext string) string {
	switch ext {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg":
		return "image"
	case ".mp4", ".webm", ".mov", ".m4v", ".ogg":
		return "video"
	}
	return "file"
}

// noteFilePath is the file of a notefile URL.
func noteFilePath(url string) (string, error) {
	name, ok := strings.CutPrefix(url, noteFileURL)
	if !ok || name == "" || strings.ContainsAny(name, `/\`) {
		return "", errors.New("不是笔记里的文件：" + url)
	}
	return configPath(filepath.Join("notes-files", name))
}

// cleanFiles removes the files no note or todo refers to any more, a day after
// they were made, so that undoing a delete still finds them.
func (n *Notes) cleanFiles() {
	dir, err := configPath("notes-files")
	if err != nil {
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	n.mu.Lock()
	if err := n.load(); err != nil {
		n.mu.Unlock()
		return
	}
	var all strings.Builder
	for _, note := range n.data.Notes {
		all.WriteString(note.Body)
	}
	for _, t := range n.data.Todos {
		all.WriteString(strings.Join(t.Images, " "))
	}
	n.mu.Unlock()
	used := all.String()
	for _, e := range entries {
		info, err := e.Info()
		if err != nil || e.IsDir() || time.Since(info.ModTime()) < 24*time.Hour || strings.Contains(used, e.Name()) {
			continue
		}
		os.Remove(filepath.Join(dir, e.Name()))
	}
}
