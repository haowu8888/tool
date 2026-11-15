package main

import (
	"encoding/binary"
	"errors"
	"image"
	"io"
	"log"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// RecordChanged tells the recording's panel, and the tool's page, what
// the recording is doing.
var RecordChanged = mygo.NewEvent[RecordState]("recordChanged")

// RecordSettings are the screen recorder's.
type RecordSettings struct {
	FPS    int  `json:"fps"`    // frames a second: 15, 30 or 60
	Cursor bool `json:"cursor"` // the pointer is in the video
	Sound  bool `json:"sound"`  // what the speakers play
	Mic    bool `json:"mic"`
	// Dir is where the videos go; empty for 视频\工具箱录屏.
	Dir string `json:"dir"`
}

// RecordState is the recording, for its panel: state is idle,
// recording, paused, saving, done or failed.
type RecordState struct {
	State string `json:"state"`
	// Elapsed is how long it has recorded, without the pauses, in ms.
	Elapsed int64  `json:"elapsed"`
	Path    string `json:"path"`
	Name    string `json:"name"`
	Size    int64  `json:"size"` // of the saved file
	Width   int    `json:"width"`
	Height  int    `json:"height"`
	Note    string `json:"note"` // what did not go as asked, as the sound
	Error   string `json:"error"`
}

// RecordFile is a saved recording, for the tool's list.
type RecordFile struct {
	Path     string `json:"path"`
	Name     string `json:"name"`
	Size     int64  `json:"size"`
	Time     int64  `json:"time"`     // when it was saved, ms since 1970
	Duration int64  `json:"duration"` // ms, 0 when unknown
	URL      string `json:"url"`      // to play it in the page
}

// Record records a region of the screen, selected as a screenshot is,
// into an MP4: a red frame shows around the region and a small panel
// beside it, both left out of the video.
type Record struct {
	mu       sync.Mutex
	cur      *recording
	shot     *Shot
	settings *Settings
	main     *mygo.Window
	// onChange is told when a recording starts or ends, for the tray.
	onChange func(recording bool)
}

// recording is one recording, from the selection to the panel closed.
type recording struct {
	mu        sync.Mutex
	rect      image.Rectangle // on the virtual screen, in pixels
	opts      RecordSettings
	path      string
	state     string
	start     int64 // clock100ns when the first frame was taken
	pausedAt  int64 // when the pause going on started, 0 without one
	pausedFor int64 // the pauses before it
	elapsed   int64 // how long it got, once stopped
	note      string
	err       string
	size      int64
	stop      chan struct{}
	done      chan struct{} // closed once saved
	stopped   bool
	discard   bool
	frame     *mygo.Window
	panel     *mygo.Window
	restore   bool // the toolbox comes back at the end
}

// recordPanelWidth and the heights are the panel's, in DIPs: a bar
// while recording, a card once saved.
const (
	recordPanelWidth  = 300
	recordPanelHeight = 52
	recordDoneHeight  = 132
)

// started tells that the frames are being taken from now.
func (rc *recording) started(at int64, notes []string) {
	rc.mu.Lock()
	rc.start = at
	if rc.state == "" {
		rc.state = "recording"
	}
	rc.note = strings.Join(notes, "；")
	rc.mu.Unlock()
	// The panel's clock starts from here, not from when it showed.
	go rc.broadcast()
}

// pos is where clock time t is on the recording, in 100 ns without the
// pauses, and whether it is in the pause going on.
func (rc *recording) pos(t int64) (int64, bool) {
	rc.mu.Lock()
	defer rc.mu.Unlock()
	if rc.pausedAt != 0 && t >= rc.pausedAt {
		return rc.pausedAt - rc.start - rc.pausedFor, true
	}
	return t - rc.start - rc.pausedFor, false
}

func (rc *recording) discarded() bool {
	rc.mu.Lock()
	defer rc.mu.Unlock()
	return rc.discard
}

func (rc *recording) stateLocked() RecordState {
	st := RecordState{State: rc.state, Path: rc.path, Name: filepath.Base(rc.path), Size: rc.size, Width: rc.rect.Dx(), Height: rc.rect.Dy(), Note: rc.note, Error: rc.err}
	switch rc.state {
	case "recording", "paused":
		now := clock100ns()
		if rc.pausedAt != 0 {
			now = rc.pausedAt
		}
		st.Elapsed = (now - rc.start - rc.pausedFor) / 10_000
	case "saving", "done":
		st.Elapsed = rc.elapsed / 10_000
	}
	return st
}

func (rc *recording) broadcast() {
	rc.mu.Lock()
	st := rc.stateLocked()
	rc.mu.Unlock()
	RecordChanged.Broadcast(st)
}

// dir is where the videos go, made if it is not there.
func (r *Record) dir() (string, error) {
	dir := r.settings.current().Record.Dir
	if dir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		dir = filepath.Join(home, "Videos", "工具箱录屏")
	}
	return dir, os.MkdirAll(dir, 0o755)
}

// Start selects a region to record, as the tool's page asks: the toolbox
// steps aside, and comes back at the end.
func (r *Record) Start() {
	go r.shot.start("record", true)
}

// toggle starts a recording, or stops the one going on, for the shortcut
// and the tray.
func (r *Record) toggle() {
	r.mu.Lock()
	rc := r.cur
	r.mu.Unlock()
	if rc != nil {
		rc.mu.Lock()
		going := rc.state == "recording" || rc.state == "paused" || rc.state == "" || rc.state == "saving"
		rc.mu.Unlock()
		if going {
			r.Stop(false)
			return
		}
		r.Close()
	}
	r.shot.start("record", false)
}

// IsRecording is whether a recording is going on, or being saved.
func (r *Record) IsRecording() bool {
	r.mu.Lock()
	rc := r.cur
	r.mu.Unlock()
	if rc == nil {
		return false
	}
	rc.mu.Lock()
	defer rc.mu.Unlock()
	return !rc.stopped || rc.state == "saving"
}

// quit saves a recording going on before the app ends: without its end,
// an MP4 does not play.
func (r *Record) quit() {
	r.mu.Lock()
	rc := r.cur
	r.mu.Unlock()
	if rc == nil {
		return
	}
	// On the main thread: Stop's broadcast must not wait for it.
	go r.Stop(false)
	select {
	case <-rc.done:
	case <-time.After(5 * time.Second):
	}
}

// Record starts recording the selection on a display.
func (s *Shot) Record(display int64, sr ShotRect) error {
	s.mu.Lock()
	f := s.frames[display]
	if !s.active || f == nil {
		s.mu.Unlock()
		return errors.New("截图已经结束")
	}
	sel := image.Rect(sr.X, sr.Y, sr.X+sr.W, sr.Y+sr.H).Intersect(f.img.Rect)
	// H.264 wants even sizes.
	sel.Max.X -= sel.Dx() % 2
	sel.Max.Y -= sel.Dy() % 2
	if sel.Dx() < 32 || sel.Dy() < 32 {
		s.mu.Unlock()
		return errors.New("选区太小了，录屏至少要 32 × 32 像素")
	}
	d := f.display
	full := sel == f.img.Rect || sel.Dx() >= f.img.Rect.Dx()-1 && sel.Dy() >= f.img.Rect.Dy()-1
	restore := s.restore
	s.restore = false
	s.mu.Unlock()
	mon, err := monitorRect(display)
	if err != nil {
		return err
	}
	if s.rec == nil {
		return errors.New("录屏不可用")
	}
	if s.rec.IsRecording() {
		return errors.New("已经在录屏了")
	}
	s.end()
	return s.rec.begin(d, sel, sel.Add(mon.Min), full, restore)
}

// begin records rect, which is sel on display d, with the frame around it
// unless it is the whole display.
func (r *Record) begin(d mygo.Display, sel, rect image.Rectangle, full, restore bool) error {
	opts := r.settings.current().Record
	dir, err := r.dir()
	if err != nil {
		return err
	}
	path := filepath.Join(dir, "录屏 "+time.Now().Format("2006-01-02 150405")+".mp4")
	rc := &recording{rect: rect, opts: opts, path: path, stop: make(chan struct{}), done: make(chan struct{}), restore: restore}

	scale := d.ScaleFactor
	if scale <= 0 {
		scale = 1
	}
	at := mygo.Rectangle{
		X:      d.Bounds.X + int(math.Round(float64(sel.Min.X)/scale)),
		Y:      d.Bounds.Y + int(math.Round(float64(sel.Min.Y)/scale)),
		Width:  int(math.Round(float64(sel.Dx()) / scale)),
		Height: int(math.Round(float64(sel.Dy()) / scale)),
	}
	if !full {
		m := scrollFrameMargin
		rc.frame = mygo.NewWindow(mygo.WindowOptions{
			Title:           "录屏",
			URL:             "/?longframe&rec",
			X:               at.X - m,
			Y:               at.Y - m,
			Width:           at.Width + 2*m,
			Height:          at.Height + 2*m,
			MinWidth:        at.Width + 2*m,
			MinHeight:       at.Height + 2*m,
			MaxWidth:        at.Width + 2*m,
			MaxHeight:       at.Height + 2*m,
			Hidden:          true,
			Frameless:       true,
			Transparent:     true,
			AlwaysOnTop:     true,
			SkipTaskbar:     true,
			DisableResize:   true,
			DisableMinimize: true,
			DisableMaximize: true,
			DisableShadow:   true,
		})
		rc.frame.SetIgnoreMouseEvents(true)
		rc.frame.SetContentProtection(true)
	}
	px, py := r.panelPlace(d.WorkArea, at, full, recordPanelHeight)
	rc.panel = mygo.NewWindow(mygo.WindowOptions{
		Title:           "录屏",
		URL:             "/?rec",
		X:               px,
		Y:               py,
		Width:           recordPanelWidth,
		Height:          recordPanelHeight,
		MinWidth:        recordPanelWidth,
		MinHeight:       recordPanelHeight,
		Hidden:          true,
		Frameless:       true,
		AlwaysOnTop:     true,
		SkipTaskbar:     true,
		DisableResize:   true,
		DisableMinimize: true,
		DisableMaximize: true,
	})
	// Over the region, as for the whole screen, it is still not in the
	// video.
	rc.panel.SetContentProtection(true)
	rc.panel.OnClose(func(e *mygo.CloseEvent) {
		// Quitting, the recording is saved before the app ends (quit).
		if appQuitting.Load() {
			return
		}
		e.PreventDefault()
		go r.Close()
	})

	r.mu.Lock()
	old := r.cur
	r.cur = rc
	r.mu.Unlock()
	if old != nil {
		old.destroy()
	}
	if rc.frame != nil {
		rc.frame.ShowInactive()
	}
	if r.onChange != nil {
		r.onChange(true)
	}
	go r.run(rc)
	return nil
}

// panelPlace puts the panel under the region, or over it, or inside its
// bottom for a region as large as the screen.
func (r *Record) panelPlace(wa, at mygo.Rectangle, full bool, h int) (int, int) {
	x := at.X + at.Width - recordPanelWidth
	if x < wa.X+8 {
		x = wa.X + 8
	}
	x = min(x, wa.X+wa.Width-recordPanelWidth-8)
	y := at.Y + at.Height + scrollFrameMargin + 8
	if full || y+h > wa.Y+wa.Height {
		y = at.Y - scrollFrameMargin - 8 - h
		if full || y < wa.Y {
			// Inside, at the bottom in the middle.
			x = wa.X + (wa.Width-recordPanelWidth)/2
			y = min(at.Y+at.Height, wa.Y+wa.Height) - h - 24
		}
	}
	return x, y
}

// run records until stopped, and saves.
func (r *Record) run(rc *recording) {
	// The screenshot windows fade out before the first frame.
	time.Sleep(150 * time.Millisecond)
	go func() {
		// The panel's clock goes on by itself; this keeps it right.
		t := time.NewTicker(5 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-rc.stop:
				return
			case <-t.C:
				rc.broadcast()
			}
		}
	}()
	err := recordScreen(rc)
	// Saved: the app may end now.
	close(rc.done)
	rc.mu.Lock()
	if !rc.stopped {
		// It failed by itself: as long as it got.
		if rc.start != 0 {
			now := clock100ns()
			if rc.pausedAt != 0 {
				now = rc.pausedAt
			}
			rc.elapsed = now - rc.start - rc.pausedFor
		}
		rc.stopped = true
		close(rc.stop)
	}
	discard := rc.discard
	if err != nil {
		rc.state, rc.err = "failed", err.Error()
		log.Println("record:", err)
	} else {
		rc.state = "done"
	}
	if fi, e := os.Stat(rc.path); e == nil {
		rc.size = fi.Size()
	}
	frame, panel, restore := rc.frame, rc.panel, rc.restore
	rc.frame = nil
	rc.mu.Unlock()
	if frame != nil {
		frame.Destroy()
	}
	if discard || err != nil && rc.size < 1024 {
		os.Remove(rc.path)
	}
	if r.onChange != nil {
		r.onChange(false)
	}
	if discard {
		r.Close()
	} else if panel != nil {
		// Grown into a card, it stays on the screen.
		x, y := panel.Position()
		if d, ok := displayAt(x, y); ok {
			wa := d.WorkArea
			y = min(y, wa.Y+wa.Height-recordDoneHeight-8)
		}
		panel.SetBounds(mygo.Rectangle{X: x, Y: y, Width: recordPanelWidth, Height: recordDoneHeight})
		rc.broadcast()
	}
	if restore && r.main != nil {
		r.main.Show()
	}
	freeSoon()
}

// displayAt is the display a point is on.
func displayAt(x, y int) (mygo.Display, bool) {
	for _, d := range mygo.Screen.Displays() {
		b := d.Bounds
		if x >= b.X && x < b.X+b.Width && y >= b.Y && y < b.Y+b.Height {
			return d, true
		}
	}
	return mygo.Display{}, false
}

// State is the recording's, for its panel to start with.
func (r *Record) State() RecordState {
	r.mu.Lock()
	rc := r.cur
	r.mu.Unlock()
	if rc == nil {
		return RecordState{State: "idle"}
	}
	rc.mu.Lock()
	defer rc.mu.Unlock()
	st := rc.stateLocked()
	if st.State == "" {
		st.State = "recording"
	}
	return st
}

// Ready shows the panel once its page is drawn, without taking the keys
// from the window being recorded.
func (r *Record) Ready() {
	r.mu.Lock()
	rc := r.cur
	r.mu.Unlock()
	if rc != nil {
		rc.panel.ShowInactive()
	}
}

// Pause pauses the recording, or goes on.
func (r *Record) Pause(on bool) {
	r.mu.Lock()
	rc := r.cur
	r.mu.Unlock()
	if rc == nil {
		return
	}
	rc.mu.Lock()
	switch {
	case on && rc.state == "recording":
		rc.pausedAt = clock100ns()
		rc.state = "paused"
	case !on && rc.state == "paused":
		rc.pausedFor += clock100ns() - rc.pausedAt
		rc.pausedAt = 0
		rc.state = "recording"
	}
	rc.mu.Unlock()
	rc.broadcast()
}

// Stop ends the recording and saves it, or throws it away.
func (r *Record) Stop(discard bool) {
	r.mu.Lock()
	rc := r.cur
	r.mu.Unlock()
	if rc == nil {
		return
	}
	rc.mu.Lock()
	if rc.stopped {
		rc.mu.Unlock()
		return
	}
	now := clock100ns()
	if rc.pausedAt != 0 {
		now = rc.pausedAt
	}
	if rc.start != 0 {
		rc.elapsed = now - rc.start - rc.pausedFor
	}
	rc.stopped, rc.discard = true, discard
	rc.state = "saving"
	close(rc.stop)
	rc.mu.Unlock()
	rc.broadcast()
}

// Close closes the panel: a recording going on is saved first.
func (r *Record) Close() {
	r.mu.Lock()
	rc := r.cur
	r.mu.Unlock()
	if rc == nil {
		return
	}
	rc.mu.Lock()
	busy := !rc.stopped || rc.state == "saving"
	rc.mu.Unlock()
	if busy {
		// It closes once saved.
		r.Stop(false)
		return
	}
	r.mu.Lock()
	if r.cur == rc {
		r.cur = nil
	}
	r.mu.Unlock()
	rc.destroy()
	RecordChanged.Broadcast(RecordState{State: "idle"})
}

func (rc *recording) destroy() {
	rc.mu.Lock()
	frame, panel := rc.frame, rc.panel
	rc.frame, rc.panel = nil, nil
	rc.mu.Unlock()
	if frame != nil {
		frame.Destroy()
	}
	if panel != nil {
		panel.Destroy()
	}
}

// DragPanel moves the panel with the pointer while the button is down.
func (r *Record) DragPanel() {
	r.mu.Lock()
	rc := r.cur
	r.mu.Unlock()
	if rc == nil || rc.panel == nil {
		return
	}
	win := rc.panel
	go func() {
		x, y := win.Position()
		c := mygo.Screen.CursorScreenPoint()
		dx, dy := c.X-x, c.Y-y
		for mouseDown() {
			time.Sleep(10 * time.Millisecond)
			c := mygo.Screen.CursorScreenPoint()
			if c.X-dx != x || c.Y-dy != y {
				x, y = c.X-dx, c.Y-dy
				win.SetPosition(x, y)
			}
		}
	}()
}

// ---- The saved videos ----

// recordURL serves the videos to the page, through the shot scheme.
const recordURL = shotURL + "video/"

// mine is path, cleaned, if it is a video in the recordings' folder.
func (r *Record) mine(path string) (string, error) {
	dir, err := r.dir()
	if err != nil {
		return "", err
	}
	p := filepath.Clean(path)
	if !strings.EqualFold(filepath.Dir(p), filepath.Clean(dir)) || !strings.EqualFold(filepath.Ext(p), ".mp4") {
		return "", errors.New("不是录屏文件夹里的视频")
	}
	return p, nil
}

// List lists the videos in the recordings' folder, newest first.
func (r *Record) List() ([]RecordFile, error) {
	dir, err := r.dir()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	busy := ""
	r.mu.Lock()
	if rc := r.cur; rc != nil {
		rc.mu.Lock()
		if !rc.stopped || rc.state == "saving" {
			busy = rc.path
		}
		rc.mu.Unlock()
	}
	r.mu.Unlock()
	list := []RecordFile{}
	for _, e := range entries {
		if e.IsDir() || !strings.EqualFold(filepath.Ext(e.Name()), ".mp4") {
			continue
		}
		p := filepath.Join(dir, e.Name())
		if p == busy {
			continue
		}
		fi, err := e.Info()
		if err != nil {
			continue
		}
		list = append(list, RecordFile{Path: p, Name: e.Name(), Size: fi.Size(), Time: fi.ModTime().UnixMilli(), Duration: mp4Duration(p), URL: recordURL + url.PathEscape(e.Name())})
	}
	slices.SortFunc(list, func(a, b RecordFile) int { return int(b.Time - a.Time) })
	return list, nil
}

// Dir returns the recordings' folder.
func (r *Record) Dir() (string, error) { return r.dir() }

// PickDir asks for another folder for the recordings.
func (r *Record) PickDir() (string, error) {
	cur, _ := r.dir()
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{Title: "录屏保存到", DefaultPath: cur, Directory: true})
	if err != nil || len(paths) == 0 {
		return "", err
	}
	return paths[0], r.settings.change(func(s *AppSettings) { s.Record.Dir = paths[0] })
}

// OpenDir shows the recordings' folder.
func (r *Record) OpenDir() error {
	dir, err := r.dir()
	if err != nil {
		return err
	}
	return mygo.Shell.OpenPath(dir)
}

// Open plays a video in the system's player.
func (r *Record) Open(path string) error {
	p, err := r.mine(path)
	if err != nil {
		return err
	}
	return mygo.Shell.OpenPath(p)
}

// Reveal shows a video in its folder.
func (r *Record) Reveal(path string) error {
	p, err := r.mine(path)
	if err != nil {
		return err
	}
	mygo.Shell.ShowItemInFolder(p)
	return nil
}

// Copy puts a video on the clipboard as a file, to paste into a chat.
func (r *Record) Copy(path string) error {
	p, err := r.mine(path)
	if err != nil {
		return err
	}
	return mygo.Clipboard.WriteFiles(p)
}

// Delete moves a video to the recycle bin.
func (r *Record) Delete(path string) error {
	p, err := r.mine(path)
	if err != nil {
		return err
	}
	return mygo.Shell.TrashItem(p)
}

// serveVideo serves a video of the recordings' folder, by name.
func (r *Record) serveVideo(name string) (string, bool) {
	dir, err := r.dir()
	if err != nil || name == "" || strings.ContainsAny(name, `/\`) || name != filepath.Base(name) {
		return "", false
	}
	p, err := r.mine(filepath.Join(dir, name))
	return p, err == nil
}

// mp4Duration reads a video's length, in ms, from its movie header; 0
// when it cannot.
func mp4Duration(path string) int64 {
	f, err := os.Open(path)
	if err != nil {
		return 0
	}
	defer f.Close()
	// moov is at the end, as Media Foundation writes it, or the start.
	fi, err := f.Stat()
	if err != nil {
		return 0
	}
	end := fi.Size()
	box := func(at, limit int64, want string) (int64, int64, bool) {
		for at+8 <= limit {
			var h [16]byte
			if _, err := f.ReadAt(h[:8], at); err != nil {
				return 0, 0, false
			}
			size := int64(binary.BigEndian.Uint32(h[:4]))
			head := int64(8)
			if size == 1 {
				if _, err := f.ReadAt(h[8:16], at+8); err != nil {
					return 0, 0, false
				}
				size, head = int64(binary.BigEndian.Uint64(h[8:16])), 16
			} else if size == 0 {
				size = limit - at
			}
			if size < head {
				return 0, 0, false
			}
			if string(h[4:8]) == want {
				return at + head, at + size, true
			}
			at += size
		}
		return 0, 0, false
	}
	start, stop, ok := box(0, end, "moov")
	if !ok {
		return 0
	}
	start, _, ok = box(start, stop, "mvhd")
	if !ok {
		return 0
	}
	var h [32]byte
	if _, err := f.ReadAt(h[:], start); err != nil && err != io.EOF {
		return 0
	}
	var scale, dur uint64
	if h[0] == 1 { // version 1: 64-bit times
		scale, dur = uint64(binary.BigEndian.Uint32(h[20:24])), binary.BigEndian.Uint64(h[24:32])
	} else {
		scale, dur = uint64(binary.BigEndian.Uint32(h[12:16])), uint64(binary.BigEndian.Uint32(h[16:20]))
	}
	if scale == 0 {
		return 0
	}
	return int64(dur * 1000 / scale)
}
