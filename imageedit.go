package main

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/transfer"
)

// ImageEditOpened tells the image editor's page that a picture waits for
// it, as a screenshot sent to 编辑: the page takes it with Take.
var ImageEditOpened = mygo.NewEvent[int]("imageEditOpened")

// The pictures the editor opens are served through the imgedit scheme at
// this address; the page draws them on a canvas, edits and exports them
// itself, and hands the result back to save or copy.
const imageEditScheme = "imgedit"

const imageEditURL = "http://imgedit.localhost/"

// imageExts are the pictures the editor opens: what WebView2 decodes.
var imageExts = regexp.MustCompile(`(?i)\.(png|jpe?g|gif|webp|bmp|ico|avif|svg)$`)

// maxEditFile is the largest file opened, in bytes.
const maxEditFile = 200 << 20

// EditImage is a picture opened in the editor.
type EditImage struct {
	URL  string `json:"url"`
	Name string `json:"name"` // the file's name, or a made-up one
	Path string `json:"path"` // the file, which 覆盖原图 writes over; "" for none
	Size int64  `json:"size"`
}

// ImageEdit opens pictures for the image editor's page and saves what it
// makes of them.
type ImageEdit struct {
	mu       sync.Mutex
	docs     map[string]*docJob // 合并文档's files being written
	settings *Settings
	seq      int
	sources  map[string]editSource // by the id in the URL, the last few
	order    []string
	pending  *EditImage
	opened   map[string]bool // files opened here, the only ones written over
	saveDir  string          // where the last picture was saved
	open     func()          // shows the tool's page
}

// editSource is a picture to serve: a file, or bytes as a screenshot's.
type editSource struct {
	path string
	data []byte
}

// keepSources is how many files stay served: the page loads a picture as
// soon as it is opened, but 合并文档 adds many at once; keepData is how
// many pictures that are not files, which take memory, as screenshots.
const (
	keepSources = 200
	keepData    = 3
)

// serve registers the imgedit scheme; call it before any window is made.
func (m *ImageEdit) serve() {
	mygo.Protocol.HandleFunc(imageEditScheme, func(w http.ResponseWriter, r *http.Request) {
		m.mu.Lock()
		src, ok := m.sources[strings.TrimPrefix(r.URL.Path, "/")]
		m.mu.Unlock()
		if !ok {
			http.NotFound(w, r)
			return
		}
		// The page reads the canvas it draws the picture on back.
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Cache-Control", "no-store")
		if src.path != "" {
			http.ServeFile(w, r, src.path)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		w.Write(src.data)
	})
}

// add serves a picture under a new id. Call it with mu held.
func (m *ImageEdit) add(src editSource, name string, size int64) EditImage {
	if m.sources == nil {
		m.sources = map[string]editSource{}
	}
	m.seq++
	id := strconv.Itoa(m.seq)
	// The extension lets WebView2 tell an SVG from the rest.
	if ext := strings.ToLower(filepath.Ext(src.path)); ext != "" {
		id += ext
	}
	m.sources[id] = src
	m.order = append(m.order, id)
	data := 0
	for i := len(m.order) - 1; i >= 0; i-- {
		k := m.order[i]
		if m.sources[k].data == nil {
			continue
		}
		if data++; data > keepData {
			delete(m.sources, k)
			m.order = append(m.order[:i], m.order[i+1:]...)
		}
	}
	for len(m.order) > keepSources {
		delete(m.sources, m.order[0])
		m.order = m.order[1:]
	}
	return EditImage{URL: imageEditURL + id, Name: name, Path: src.path, Size: size}
}

// Open asks for a picture to edit; nil when none is picked.
func (m *ImageEdit) Open() (*EditImage, error) {
	list, err := m.Pick(false)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

// Pick asks for pictures, one or many, for 创造拼图 and 合并文档.
func (m *ImageEdit) Pick(multiple bool) ([]EditImage, error) {
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Title:    "打开图片",
		Multiple: multiple,
		Filters:  []mygo.FileFilter{{Name: "图片", Extensions: []string{"png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif", "svg"}}},
	})
	if err != nil || len(paths) == 0 {
		return nil, err
	}
	var out []EditImage
	for _, p := range paths {
		img, err := m.OpenPath(p)
		if err != nil {
			return out, err
		}
		out = append(out, img)
	}
	return out, nil
}

// OpenPath opens a picture file, as dropped on the window.
func (m *ImageEdit) OpenPath(path string) (EditImage, error) {
	if !imageExts.MatchString(path) {
		return EditImage{}, errors.New("不是能打开的图片：" + filepath.Base(path))
	}
	st, err := os.Stat(path)
	if err != nil {
		return EditImage{}, err
	}
	if st.IsDir() || st.Size() > maxEditFile {
		return EditImage{}, errors.New("文件太大或不是图片")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.opened == nil {
		m.opened = map[string]bool{}
	}
	m.opened[path] = true
	return m.add(editSource{path: path}, filepath.Base(path), st.Size()), nil
}

// edit opens a PNG that is not a file, as a screenshot or a pinned
// picture, in the editor's page.
func (m *ImageEdit) edit(png []byte, name string) {
	m.mu.Lock()
	img := m.add(editSource{data: png}, name+".png", int64(len(png)))
	m.pending = &img
	seq := m.seq
	m.mu.Unlock()
	if m.open != nil {
		m.open()
	}
	ImageEditOpened.Broadcast(seq)
}

// Take returns the picture sent to the editor that the page has not
// opened, once.
func (m *ImageEdit) Take() *EditImage {
	m.mu.Lock()
	defer m.mu.Unlock()
	p := m.pending
	m.pending = nil
	return p
}

// exportExt is the extension of a format the page exports: png, jpeg or
// webp.
func exportExt(format string) (string, string, error) {
	switch format {
	case "png":
		return "png", "PNG 图片", nil
	case "jpeg":
		return "jpg", "JPG 图片", nil
	case "webp":
		return "webp", "WebP 图片", nil
	}
	return "", "", errors.New("不支持的格式：" + format)
}

// Save asks where to save the edited picture, base64 in a format, and
// returns the file, or "" when the user cancels. The dialog starts beside
// the opened file, or where the last was saved.
func (m *ImageEdit) Save(data, format, name, from string) (string, error) {
	ext, label, err := exportExt(format)
	if err != nil {
		return "", err
	}
	b, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return "", err
	}
	base := strings.TrimSuffix(name, filepath.Ext(name))
	if base == "" {
		base = "图片 " + time.Now().Format("2006-01-02 150405")
	}
	path, err := m.savePath("保存图片", ext, label, from, base+" 编辑")
	if err != nil || path == "" {
		return "", err
	}
	return path, writeFileSafe(path, b)
}

// SaveFile asks where to save a picture the page made, as a collage or a
// long picture, base64 in a format, under a name without extension.
func (m *ImageEdit) SaveFile(data, format, name string) (string, error) {
	ext, label, err := exportExt(format)
	if err != nil {
		return "", err
	}
	b, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return "", err
	}
	path, err := m.savePath("保存图片", ext, label, "", name)
	if err != nil || path == "" {
		return "", err
	}
	return path, writeFileSafe(path, b)
}

// savePath asks where to save a file of an extension, starting beside the
// opened file from, or where the last was saved; "" when canceled.
func (m *ImageEdit) savePath(title, ext, label, from, base string) (string, error) {
	m.mu.Lock()
	dir := m.saveDir
	if from != "" && m.opened[from] {
		dir = filepath.Dir(from)
	}
	m.mu.Unlock()
	if dir == "" && m.settings != nil {
		dir = m.settings.current().Shot.SaveDir
	}
	if dir == "" {
		if home, err := os.UserHomeDir(); err == nil {
			dir = filepath.Join(home, "Pictures")
		}
	}
	if base == "" {
		base = time.Now().Format("2006-01-02 150405")
	}
	path, err := mygo.Dialog.Save(mygo.SaveDialogOptions{
		Title:       title,
		DefaultPath: freeName(filepath.Join(dir, base+"."+ext)),
		Filters:     []mygo.FileFilter{{Name: label, Extensions: []string{ext}}},
	})
	if err != nil || path == "" {
		return "", err
	}
	if !strings.EqualFold(filepath.Ext(path), "."+ext) && !(ext == "jpg" && strings.EqualFold(filepath.Ext(path), ".jpeg")) {
		path += "." + ext
	}
	m.mu.Lock()
	m.saveDir = filepath.Dir(path)
	m.mu.Unlock()
	return path, nil
}

// freeName is path, or path with (2), (3)… before its extension when a
// file has the name already.
func freeName(path string) string {
	ext := filepath.Ext(path)
	stem := strings.TrimSuffix(path, ext)
	for i := 2; ; i++ {
		if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) || i > 999 {
			return path
		}
		path = fmt.Sprintf("%s (%d)%s", stem, i, ext)
	}
}

// Overwrite writes the edited picture over the file it was opened from,
// which must have been opened here and have the format's extension.
func (m *ImageEdit) Overwrite(path, data, format string) error {
	m.mu.Lock()
	ok := m.opened[path]
	m.mu.Unlock()
	if !ok {
		return errors.New("只能覆盖在这里打开的文件")
	}
	ext, _, err := exportExt(format)
	if err != nil {
		return err
	}
	have := strings.ToLower(strings.TrimPrefix(filepath.Ext(path), "."))
	if have != ext && !(ext == "jpg" && have == "jpeg") {
		return fmt.Errorf("原图是 %s，不能存成 %s 覆盖", have, ext)
	}
	b, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return err
	}
	return writeFileSafe(path, b)
}

// writeFileSafe writes a file through a temporary one beside it, so that
// a failure halfway leaves the old file whole.
func writeFileSafe(path string, b []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}

// Copy puts the edited picture, a PNG in base64, on the clipboard.
func (m *ImageEdit) Copy(data string) error {
	b, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return err
	}
	return mygo.Clipboard.Write(transfer.New(transfer.NewItem(transfer.Bytes(transfer.PNG, b))))
}

// Reveal shows a saved picture in Explorer.
func (m *ImageEdit) Reveal(path string) {
	mygo.Shell.ShowItemInFolder(path)
}
