package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"image/png"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/transfer"
)

// ClipsChanged is sent with the clipboard history whenever it changes.
var ClipsChanged = mygo.NewEvent[[]ClipItem]("clipsChanged")

// ClipsSummoned tells the history's popup that the shortcut brought it up.
var ClipsSummoned = mygo.NewEvent[int]("clipsSummoned")

// The history's pictures are files in clip-files in the app's data
// folder, which pages load through the clip scheme at this address.
const clipScheme = "clip"

const clipURL = "http://clip.localhost/"

// clipPreview is how much of a text the pages get, to show and search.
const clipPreview = 2000

// maxClipText is the longest text kept, in bytes; longer ones are left out.
const maxClipText = 1 << 20

// maxClipImages is how much the kept pictures may take on the disk, in
// bytes, besides the pinned ones: past it the oldest go.
const maxClipImages = 200 << 20

// ClipSettings are the clipboard history's.
type ClipSettings struct {
	Pause bool `json:"pause"` // nothing new is kept
	Max   int  `json:"max"`   // how many are kept, besides the pinned ones
	// Days is after how many days an item goes, unless pinned; 0 for
	// never.
	Days int `json:"days"`
	// Exclude are the programs whose copies are not kept, by name as the
	// history shows them: WindowsTerminal, KeePass.
	Exclude []string `json:"exclude"`
}

// excludes is whether copies made in a program are not kept.
func (s ClipSettings) excludes(app string) bool {
	return app != "" && slices.ContainsFunc(s.Exclude, func(name string) bool { return strings.EqualFold(name, app) })
}

// normalizeClipSettings puts the settings in their bounds.
func normalizeClipSettings(s *ClipSettings) {
	if !slices.Contains([]int{100, 300, 1000}, s.Max) {
		s.Max = defaultSettings.Clipboard.Max
	}
	if !slices.Contains([]int{0, 7, 30, 90}, s.Days) {
		s.Days = 0
	}
	names := []string{}
	for _, name := range s.Exclude {
		name = strings.TrimSpace(name)
		if len(name) > 4 && strings.EqualFold(name[len(name)-4:], ".exe") {
			name = name[:len(name)-4]
		}
		if name != "" && !slices.ContainsFunc(names, func(o string) bool { return strings.EqualFold(o, name) }) {
			names = append(names, name)
		}
	}
	s.Exclude = names
}

// ClipItem is something copied, for the pages: a text (its start), a
// picture or files.
type ClipItem struct {
	ID     string   `json:"id"`
	Kind   string   `json:"kind"` // text, image or files
	Text   string   `json:"text,omitempty"`
	Len    int      `json:"len,omitempty"` // the whole text's characters
	Files  []string `json:"files,omitempty"`
	Image  string   `json:"image,omitempty"` // its URL
	W      int      `json:"w,omitempty"`
	H      int      `json:"h,omitempty"`
	Source string   `json:"source,omitempty"` // the app it was copied in
	Time   int64    `json:"time"`             // Unix milliseconds, of the last copy
	Pinned bool     `json:"pinned,omitempty"`
}

// clipEntry is a ClipItem as clipboard.json keeps it: the whole text, and
// the picture's file and hash.
type clipEntry struct {
	ClipItem
	Full string `json:"full,omitempty"`
	Hash string `json:"hash,omitempty"`
	Size int64  `json:"size,omitempty"` // the picture's file, in bytes
	pic  []byte // a new picture, until it is a file
}

// Clips keeps what is copied, newest first, to copy or paste it again.
type Clips struct {
	mu       sync.Mutex
	items    []clipEntry
	loaded   bool
	settings *Settings
	popup    *mygo.Window
	popupMu  sync.Mutex // one summon at a time
	// prev is the window that had the keys when the popup came up, where
	// a picked item is pasted.
	prev uintptr
	// own is the clipboard's count after the app itself last put an item
	// of the history on it: no copy of the user's in another app.
	own uint32
	// onEdit opens a copied picture in the image editor.
	onEdit func(png []byte, name string)
}

func (c *Clips) load() {
	if c.loaded {
		return
	}
	c.loaded = true
	if err := readJSON("clipboard.json", &c.items); err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Println("clipboard history:", err)
	}
	// What is deleted is gone: no copies of an older history are left
	// beside it, as earlier versions kept.
	if p, err := configPath("clipboard.json"); err == nil {
		os.Remove(p + ".bak")
		os.Remove(p + ".broken")
	}
	// The pictures' sizes, for the ones kept before they were counted;
	// and files no item has, as after a crash, go.
	dir, err := clipDir()
	if err != nil {
		return
	}
	used := map[string]bool{}
	for i := range c.items {
		e := &c.items[i]
		if e.Kind != "image" {
			continue
		}
		used[e.ID+".png"] = true
		if e.Size == 0 {
			if st, err := os.Stat(filepath.Join(dir, e.ID+".png")); err == nil {
				e.Size = st.Size()
			}
		}
	}
	files, _ := os.ReadDir(dir)
	for _, f := range files {
		if !used[f.Name()] {
			os.Remove(filepath.Join(dir, f.Name()))
		}
	}
}

// List returns the history, newest first.
func (c *Clips) List() []ClipItem {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.load()
	return c.list()
}

func (c *Clips) list() []ClipItem {
	out := make([]ClipItem, len(c.items))
	for i, e := range c.items {
		out[i] = e.ClipItem
	}
	return out
}

// changed saves the history and tells the pages. Call it with mu held.
func (c *Clips) changed() {
	if err := writeJSONOnce("clipboard.json", c.items); err != nil {
		log.Println("clipboard history:", err)
	}
	ClipsChanged.Broadcast(c.list())
}

func clipDir() (string, error) { return configPath("clip-files") }

// serve registers the clip scheme; call it before any window is made.
func (c *Clips) serve() {
	dir, err := clipDir()
	if err != nil {
		log.Println("clip files:", err)
		return
	}
	files := http.FileServer(http.Dir(dir))
	mygo.Protocol.HandleFunc(clipScheme, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "max-age=31536000, immutable")
		files.ServeHTTP(w, r)
	})
}

// watch keeps what is copied, as long as the app runs. Windows counts the
// clipboard's changes, which costs nothing to ask.
func (c *Clips) watch() {
	// The history is read now, which also clears away what older versions
	// left beside it.
	c.mu.Lock()
	c.load()
	c.mu.Unlock()
	last := clipboardSeq()
	var expired time.Time
	for {
		time.Sleep(400 * time.Millisecond)
		// Items past their days go, looked for every little while.
		if time.Since(expired) > 10*time.Minute {
			expired = time.Now()
			c.expire()
		}
		seq := clipboardSeq()
		if seq == last {
			continue
		}
		last = seq
		c.mu.Lock()
		own := seq == c.own
		c.mu.Unlock()
		if c.settings.current().Clipboard.Pause {
			continue
		}
		// The copying app may still be putting its formats on.
		time.Sleep(100 * time.Millisecond)
		if clipboardPrivate() {
			continue
		}
		e, err := readClip()
		if err != nil || e == nil {
			continue
		}
		// Put there by the app from the history: the item keeps the app it
		// first came from.
		if !own {
			e.Source = clipboardApp()
			if c.settings.current().Clipboard.excludes(e.Source) {
				continue
			}
		}
		c.add(e, own)
	}
}

// readClip reads the clipboard: files, or else a text, or else a picture.
// Copied cells come with a picture of them too, and a text is what they
// mean; a copied screenshot may come with its file, and is a picture.
// Nil for nothing to keep.
func readClip() (*clipEntry, error) {
	formats := mygo.Clipboard.Formats()
	e := &clipEntry{}
	var files []string
	if slices.Contains(formats, transfer.FileList) || slices.Contains(formats, transfer.URIList) {
		var err error
		if files, err = mygo.Clipboard.ReadFiles(); err != nil || len(files) == 0 {
			return nil, err
		}
		if len(files) == 1 && isShotFile(files[0]) && slices.Contains(formats, transfer.PNG) {
			files = nil
		}
	}
	switch {
	case files != nil:
		e.Kind, e.Files = "files", files
		e.Text = strings.Join(files, "\n")
	case slices.Contains(formats, transfer.Text):
		b, err := mygo.Clipboard.ReadFormat(transfer.Text)
		if err != nil {
			return nil, err
		}
		text := strings.ReplaceAll(string(b), "\r\n", "\n")
		if strings.TrimSpace(text) == "" || len(text) > maxClipText || !utf8.ValidString(text) {
			return nil, nil
		}
		e.Kind, e.Full = "text", text
	case slices.Contains(formats, transfer.PNG):
		b, err := mygo.Clipboard.ReadFormat(transfer.PNG)
		if err != nil {
			return nil, err
		}
		cfg, err := png.DecodeConfig(bytes.NewReader(b))
		if err != nil {
			return nil, err
		}
		sum := sha256.Sum256(b)
		e.Kind, e.W, e.H, e.Hash = "image", cfg.Width, cfg.Height, hex.EncodeToString(sum[:12])
		e.pic = b
	default:
		return nil, nil
	}
	return e, nil
}

// same is whether two entries hold the same thing.
func (e *clipEntry) same(o *clipEntry) bool {
	if e.Kind != o.Kind {
		return false
	}
	switch e.Kind {
	case "text":
		return e.Full == o.Full
	case "image":
		return e.Hash == o.Hash
	}
	return slices.Equal(e.Files, o.Files)
}

// add puts a copy first in the history; copied again, it moves up there.
// Own is for an item the app put on the clipboard itself.
func (c *Clips) add(e *clipEntry, own bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.load()
	e.Time = time.Now().UnixMilli()
	if i := slices.IndexFunc(c.items, func(o clipEntry) bool { return o.same(e) }); i >= 0 {
		old := c.items[i]
		old.Time = e.Time
		if !own {
			old.Source = e.Source
		}
		c.items = slices.Delete(c.items, i, i+1)
		c.items = slices.Insert(c.items, 0, old)
		c.changed()
		return
	}
	e.ID = newID()
	if e.Kind == "text" {
		e.Len = utf8.RuneCountInString(e.Full)
		e.Text = e.Full
		if e.Len > clipPreview {
			e.Text = string([]rune(e.Full)[:clipPreview])
		}
	}
	if e.Kind == "image" {
		dir, err := clipDir()
		if err == nil {
			err = os.MkdirAll(dir, 0o755)
		}
		if err == nil {
			err = os.WriteFile(filepath.Join(dir, e.ID+".png"), e.pic, 0o644)
		}
		if err != nil {
			log.Println("clipboard picture:", err)
			return
		}
		e.Image = clipURL + e.ID + ".png"
		e.Size = int64(len(e.pic))
		e.pic = nil
	}
	c.items = slices.Insert(c.items, 0, *e)
	c.trim()
	c.changed()
}

// trim lets the oldest go, past the number the settings keep, and the
// oldest pictures past what they may take on the disk; pinned ones stay,
// and the newest picture however large.
func (c *Clips) trim() {
	cfg := c.settings.current().Clipboard
	keep := cfg.Max
	var before int64 // items last copied before it are too old
	if cfg.Days > 0 {
		before = time.Now().AddDate(0, 0, -cfg.Days).UnixMilli()
	}
	n := 0
	var size int64
	c.items = slices.DeleteFunc(c.items, func(e clipEntry) bool {
		if e.Pinned {
			return false
		}
		if n++; n > keep || e.Time < before {
			removeClipFile(e)
			return true
		}
		if e.Kind == "image" {
			if size > 0 && size+e.Size > maxClipImages {
				removeClipFile(e)
				return true
			}
			size += e.Size
		}
		return false
	})
}

// expire lets the items past their days go.
func (c *Clips) expire() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.load()
	n := len(c.items)
	if c.trim(); len(c.items) != n {
		c.changed()
	}
}

func removeClipFile(e clipEntry) {
	if e.Kind != "image" {
		return
	}
	if dir, err := clipDir(); err == nil {
		os.Remove(filepath.Join(dir, e.ID+".png"))
	}
}

func (c *Clips) find(id string) (clipEntry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.load()
	i := slices.IndexFunc(c.items, func(e clipEntry) bool { return e.ID == id })
	if i < 0 {
		return clipEntry{}, false
	}
	return c.items[i], true
}

// Copy puts an item on the clipboard again, which moves it first.
func (c *Clips) Copy(id string) error {
	e, ok := c.find(id)
	if !ok {
		return errors.New("这条已经删掉了")
	}
	err := c.write(e)
	c.mu.Lock()
	c.own = clipboardSeq()
	c.mu.Unlock()
	return err
}

func (c *Clips) write(e clipEntry) error {
	switch e.Kind {
	case "files":
		return mygo.Clipboard.WriteFiles(e.Files...)
	case "image":
		dir, err := clipDir()
		if err != nil {
			return err
		}
		b, err := os.ReadFile(filepath.Join(dir, e.ID+".png"))
		if err != nil {
			return errors.New("图片文件不见了")
		}
		return mygo.Clipboard.Write(transfer.New(transfer.NewItem(transfer.Bytes(transfer.PNG, b))))
	}
	return mygo.Clipboard.Write(transfer.TextData(strings.ReplaceAll(e.Full, "\n", "\r\n")))
}

// Edit opens a copied picture in the image editor.
func (c *Clips) Edit(id string) error {
	e, ok := c.find(id)
	if !ok || e.Kind != "image" {
		return errors.New("这条已经删掉了")
	}
	dir, err := clipDir()
	if err != nil {
		return err
	}
	b, err := os.ReadFile(filepath.Join(dir, e.ID+".png"))
	if err != nil {
		return errors.New("图片文件不见了")
	}
	if c.onEdit != nil {
		name := "剪贴板图片"
		if e.Source != "" {
			name += " " + e.Source
		}
		go c.onEdit(b, name+" "+time.UnixMilli(e.Time).Format("2006-01-02 150405"))
	}
	return nil
}

// Paste puts an item on the clipboard and pastes it into the window the
// popup came up over, as Ctrl+V there would.
func (c *Clips) Paste(id string) error {
	if err := c.Copy(id); err != nil {
		return err
	}
	c.mu.Lock()
	prev := c.prev
	c.mu.Unlock()
	c.Hide()
	go func() {
		focusWindow(prev)
		// The window takes the keys before they come. Alt still held from
		// Alt+1 would make them Ctrl+Alt+V, the shortcut of this history.
		time.Sleep(120 * time.Millisecond)
		waitModifiersUp(1500 * time.Millisecond)
		pressPaste()
	}()
	return nil
}

// Pin keeps an item, however many come after it, or lets it go again.
func (c *Clips) Pin(id string, on bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.load()
	for i := range c.items {
		if c.items[i].ID == id {
			c.items[i].Pinned = on
		}
	}
	c.trim()
	c.changed()
}

// Delete removes an item.
func (c *Clips) Delete(id string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.load()
	c.items = slices.DeleteFunc(c.items, func(e clipEntry) bool {
		if e.ID == id {
			removeClipFile(e)
			return true
		}
		return false
	})
	c.changed()
}

// Clear removes every item but the pinned ones, and says how many went.
func (c *Clips) Clear() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.load()
	n := len(c.items)
	c.items = slices.DeleteFunc(c.items, func(e clipEntry) bool {
		if !e.Pinned {
			removeClipFile(e)
		}
		return !e.Pinned
	})
	n -= len(c.items)
	c.changed()
	return n
}

const (
	clipPopupWidth  = 380
	clipPopupHeight = 480
)

// summon brings the popup up at the pointer, over the window that has the
// keys, to paste in it.
func (c *Clips) summon() {
	c.popupMu.Lock()
	defer c.popupMu.Unlock()
	// Pressed again while it is up, the shortcut puts it away.
	if c.popup != nil && c.popup.IsVisible() {
		c.popup.Hide()
		c.mu.Lock()
		prev := c.prev
		c.mu.Unlock()
		focusWindow(prev)
		return
	}
	prev := foregroundWindow()
	c.mu.Lock()
	c.prev = prev
	c.mu.Unlock()
	if c.popup == nil {
		c.popup = mygo.NewWindow(mygo.WindowOptions{
			Title:           "剪贴板历史",
			URL:             "/?clips",
			Width:           clipPopupWidth,
			Height:          clipPopupHeight,
			MinWidth:        clipPopupWidth,
			MinHeight:       clipPopupHeight,
			MaxWidth:        clipPopupWidth,
			MaxHeight:       clipPopupHeight,
			Hidden:          true,
			Frameless:       true,
			AlwaysOnTop:     true,
			SkipTaskbar:     true,
			DisableResize:   true,
			DisableMinimize: true,
			DisableMaximize: true,
			BackgroundColor: "light-dark(#ffffff, #1a1d23)", // the page's --card
		})
		// Alt+F4 hides it, for the next time.
		c.popup.OnClose(func(e *mygo.CloseEvent) {
			if appQuitting.Load() {
				return
			}
			e.PreventDefault()
			go c.Hide()
		})
	}
	p := mygo.Screen.CursorScreenPoint()
	wa := mygo.Screen.DisplayNearestPoint(p).WorkArea
	x := min(max(p.X-24, wa.X+8), wa.X+wa.Width-clipPopupWidth-8)
	y := min(max(p.Y+16, wa.Y+8), wa.Y+wa.Height-clipPopupHeight-8)
	c.popup.SetBounds(mygo.Rectangle{X: x, Y: y, Width: clipPopupWidth, Height: clipPopupHeight})
	ClipsSummoned.Broadcast(0)
	c.popup.Show()
	c.popup.Focus()
	// It may have come up behind the window in front, as one run as
	// administrator; it would hide again at once, having no keys.
	time.Sleep(60 * time.Millisecond)
	forceFocus(c.popup.NativeHandle())
}

// Hide hides the popup.
func (c *Clips) Hide() {
	c.popupMu.Lock()
	defer c.popupMu.Unlock()
	if c.popup != nil {
		c.popup.Hide()
	}
}
