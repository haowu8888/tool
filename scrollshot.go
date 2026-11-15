package main

import (
	"errors"
	"image"
	"math"
	"strconv"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// ScrollShotChanged tells the long screenshot's panel how far it got.
var ScrollShotChanged = mygo.NewEvent[ScrollShotState]("scrollShotChanged")

// ScrollShotState is a long screenshot so far, for its panel.
type ScrollShotState struct {
	Seq     int    `json:"seq"` // changes with the preview
	Preview string `json:"preview"`
	Width   int    `json:"width"` // in pixels
	Height  int    `json:"height"`
	Note    string `json:"note"`
	Auto    bool   `json:"auto"` // scrolling by itself
}

// scrollShot is a long screenshot going on: the frame around the region,
// which the pointer passes through to scroll the window under it, and a
// panel beside it with the picture so far.
type scrollShot struct {
	mu      sync.Mutex
	rect    image.Rectangle // the region on the virtual screen, in pixels
	st      *stitcher
	seq     int
	note    string
	auto    bool
	changed time.Time // when it last scrolled, for auto scrolling to stop at the end
	stop    chan struct{}
	frame   *mygo.Window
	panel   *mygo.Window
	d       mygo.Display
	sel     image.Rectangle // the region on its display, as Finish takes it
	restore bool
}

// scrollFrameMargin is how far, in DIPs, the frame is drawn outside the
// region.
const scrollFrameMargin = 3

const scrollPanelWidth = 248

// Scroll starts a long screenshot of the selection on a display: the
// windows under it are scrolled, by hand or by itself, and their pictures
// stitched together.
func (s *Shot) Scroll(display int64, r ShotRect) error {
	s.mu.Lock()
	f := s.frames[display]
	if !s.active || f == nil {
		s.mu.Unlock()
		return errors.New("截图已经结束")
	}
	sel := image.Rect(r.X, r.Y, r.X+r.W, r.Y+r.H).Intersect(f.img.Rect)
	if sel.Dx() < 40 || sel.Dy() < 60 {
		s.mu.Unlock()
		return errors.New("选区太小了，长截图至少要 40 × 60 像素")
	}
	d := f.display
	// The toolbox comes back when the long screenshot ends.
	restore := s.restore
	s.restore = false
	s.mu.Unlock()
	mon, err := monitorRect(display)
	if err != nil {
		return err
	}
	s.end()

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
	m := scrollFrameMargin
	frame := mygo.NewWindow(mygo.WindowOptions{
		Title:           "长截图",
		URL:             "/?longframe",
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
	// The pointer and the wheel go through it to the window under it, and
	// it is not in the screenshots.
	frame.SetIgnoreMouseEvents(true)
	frame.SetContentProtection(true)

	// The panel goes beside the region where there is room, or else
	// inside its corner, where it is left out of the pictures too.
	wa := d.WorkArea
	pw, ph := scrollPanelWidth, min(max(at.Height, 360), wa.Height-16)
	px := at.X + at.Width + m + 8
	if px+pw > wa.X+wa.Width {
		px = at.X - m - 8 - pw
		if px < wa.X {
			px = at.X + at.Width - pw - 8
		}
	}
	py := min(max(at.Y, wa.Y+8), wa.Y+wa.Height-ph-8)
	panel := mygo.NewWindow(mygo.WindowOptions{
		Title:           "长截图",
		URL:             "/?scroll",
		X:               px,
		Y:               py,
		Width:           pw,
		Height:          ph,
		MinWidth:        pw,
		MinHeight:       ph,
		MaxWidth:        pw,
		MaxHeight:       ph,
		Hidden:          true,
		Frameless:       true,
		AlwaysOnTop:     true,
		SkipTaskbar:     true,
		DisableResize:   true,
		DisableMinimize: true,
		DisableMaximize: true,
	})
	panel.SetContentProtection(true)

	rect := sel.Add(mon.Min)
	ss := &scrollShot{rect: rect, stop: make(chan struct{}), frame: frame, panel: panel, d: d, sel: sel, restore: restore, changed: time.Now()}
	panel.OnClose(func(e *mygo.CloseEvent) {
		if appQuitting.Load() {
			return
		}
		e.PreventDefault()
		go s.ScrollEnd("")
	})
	s.mu.Lock()
	s.scroll = ss
	s.mu.Unlock()
	frame.ShowInactive()
	// The screenshot windows fade out before the first picture.
	time.Sleep(150 * time.Millisecond)
	first, err := captureScreen(rect)
	if err != nil {
		s.ScrollEnd("")
		return err
	}
	ss.mu.Lock()
	ss.st = newStitcher(first)
	ss.mu.Unlock()
	go s.scrollLoop(ss)
	return nil
}

// ScrollState is the long screenshot's state, for its panel to start with.
func (s *Shot) ScrollState() ScrollShotState {
	s.mu.Lock()
	ss := s.scroll
	s.mu.Unlock()
	if ss == nil {
		return ScrollShotState{}
	}
	ss.mu.Lock()
	defer ss.mu.Unlock()
	return ss.state()
}

// ScrollReady shows the panel once its page is drawn.
func (s *Shot) ScrollReady() {
	s.mu.Lock()
	ss := s.scroll
	s.mu.Unlock()
	if ss != nil {
		ss.panel.Show()
		ss.panel.Focus()
	}
}

func (ss *scrollShot) state() ScrollShotState {
	st := ScrollShotState{Seq: ss.seq, Note: ss.note, Auto: ss.auto}
	if ss.st != nil {
		st.Width, st.Height = ss.st.w, ss.st.height()
	}
	st.Preview = shotURL + "scroll/" + strconv.Itoa(ss.seq) + ".bmp"
	return st
}

// scrollLoop takes a picture of the region every little while and adds
// what scrolled into it; scrolling by itself, it turns the wheel too.
func (s *Shot) scrollLoop(ss *scrollShot) {
	tick := time.NewTicker(70 * time.Millisecond)
	defer tick.Stop()
	var wheeled time.Time
	for {
		select {
		case <-ss.stop:
			return
		case <-tick.C:
		}
		img, err := captureScreen(ss.rect)
		if err != nil {
			continue
		}
		ss.mu.Lock()
		if ss.st.full() {
			// As long as it gets: nothing more is added.
			ss.mu.Unlock()
			continue
		}
		before := ss.note
		res := ss.st.add(img)
		changed := false
		switch res {
		case stitchAdded:
			ss.changed = time.Now()
			ss.seq++
			changed = true
			ss.note = ""
			if ss.st.full() {
				ss.auto = false
				ss.note = "已经到最长了"
			}
		case stitchLost:
			ss.note = "滚得太快了，往回滚一点再慢慢往下"
		}
		if ss.auto {
			c := cursorPos()
			switch {
			case time.Since(ss.changed) > 2*time.Second:
				ss.auto = false
				ss.note = "已经到底了"
				changed = true
			case !c.In(ss.rect):
				// The pointer went to the panel: wait for it.
			case time.Since(wheeled) > 180*time.Millisecond:
				wheelDown()
				wheeled = time.Now()
			}
		}
		if ss.note != before {
			changed = true
		}
		var st ScrollShotState
		if changed {
			st = ss.state()
		}
		ss.mu.Unlock()
		if changed {
			ScrollShotChanged.Broadcast(st)
		}
	}
}

// ScrollAuto scrolls the region by itself, or stops. The pointer is put
// in it: the wheel turns the window under the pointer.
func (s *Shot) ScrollAuto(on bool) {
	s.mu.Lock()
	ss := s.scroll
	s.mu.Unlock()
	if ss == nil {
		return
	}
	ss.mu.Lock()
	ss.auto = on
	ss.changed = time.Now()
	ss.note = ""
	if on {
		moveCursor(image.Pt((ss.rect.Min.X+ss.rect.Max.X)/2, (ss.rect.Min.Y+ss.rect.Max.Y)/2))
	}
	st := ss.state()
	ss.mu.Unlock()
	ScrollShotChanged.Broadcast(st)
}

// ScrollEnd ends a long screenshot: copy, save or pin the picture, or
// nothing for "".
func (s *Shot) ScrollEnd(action string) error {
	s.mu.Lock()
	ss := s.scroll
	s.scroll = nil
	s.mu.Unlock()
	if ss == nil {
		return nil
	}
	close(ss.stop)
	ss.mu.Lock()
	var img *image.RGBA
	if ss.st != nil {
		img = ss.st.image()
	}
	ss.mu.Unlock()
	ss.frame.Destroy()
	ss.panel.Destroy()
	if ss.restore && s.main != nil {
		s.main.Show()
	}
	defer freeSoon()
	if action == "" || img == nil {
		return nil
	}
	// Pinned, it is as large as it was on the screen.
	r := image.Rectangle{Min: ss.sel.Min, Max: ss.sel.Min.Add(img.Rect.Size())}
	if err := s.use(img, ss.d, r, action); err != nil {
		mygo.Dialog.Error("长截图", err.Error())
	}
	return nil
}

// scrollPreview is the long screenshot's preview, for the shot scheme.
func (s *Shot) scrollPreview() []byte {
	s.mu.Lock()
	ss := s.scroll
	s.mu.Unlock()
	if ss == nil {
		return nil
	}
	ss.mu.Lock()
	defer ss.mu.Unlock()
	if ss.st == nil {
		return nil
	}
	return encodeBMP(ss.st.preview(2 * scrollPanelWidth))
}
