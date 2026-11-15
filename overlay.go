package main

import (
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// Overlay is the monitor's floating window: the numbers the user picks,
// on top of the other windows, dragged wherever. With click-through on,
// clicks go to the windows below; its menu, the tray's and the shortcut
// still reach it.
type Overlay struct {
	mu       sync.Mutex
	win      *mygo.Window
	w, h     int
	dragging bool

	settings *Settings
	monitor  *Monitor
	open     func() // shows the monitor in the toolbox
}

// Open shows the monitor in the toolbox.
func (o *Overlay) Open() {
	o.open()
}

// ResetPosition puts the window back in its first place.
func (o *Overlay) ResetPosition() error {
	return o.settings.change(func(s *AppSettings) { s.Monitor.Overlay.Placed = false })
}

// Resize fits the window to its page's content.
func (o *Overlay) Resize(w, h int) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.w, o.h = min(max(w, 40), 1200), min(max(h, 20), 800)
	if o.win == nil {
		return
	}
	// Growing keeps it on its screen: in the corner it starts in, it would
	// go past the edge. Not yet dragged, it stays in that corner.
	x, y := o.win.Position()
	wa := mygo.Screen.DisplayNearestPoint(mygo.Point{X: x, Y: y}).WorkArea
	if !o.settings.current().Monitor.Overlay.Placed && !o.dragging {
		x, y = overlayCorner(o.w)
	}
	x = max(min(x, wa.X+wa.Width-o.w), wa.X)
	y = max(min(y, wa.Y+wa.Height-o.h), wa.Y)
	o.win.SetMinimumSize(o.w, o.h)
	o.win.SetMaximumSize(o.w, o.h)
	o.win.SetBounds(mygo.Rectangle{X: x, Y: y, Width: o.w, Height: o.h})
}

// Drag moves the window with the pointer until the button is released,
// and keeps where it went.
func (o *Overlay) Drag() {
	o.mu.Lock()
	win := o.win
	if win == nil || o.dragging {
		o.mu.Unlock()
		return
	}
	o.dragging = true
	o.mu.Unlock()
	go func() {
		defer func() {
			o.mu.Lock()
			o.dragging = false
			o.mu.Unlock()
		}()
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
		b := win.Bounds()
		wa := mygo.Screen.DisplayNearestPoint(mygo.Point{X: x + b.Width/2, Y: y + b.Height/2}).WorkArea
		x = min(max(x, wa.X), wa.X+wa.Width-b.Width)
		y = min(max(y, wa.Y), wa.Y+wa.Height-b.Height)
		win.SetPosition(x, y)
		o.settings.placeOverlay(x, y)
	}()
}

// Menu shows the window's menu at the pointer.
func (o *Overlay) Menu() {
	o.mu.Lock()
	win := o.win
	o.mu.Unlock()
	if win == nil {
		return
	}
	s := o.settings.current().Monitor.Overlay
	set := func(change func(*OverlaySettings)) func(*mygo.MenuItem, *mygo.Window) {
		return func(*mygo.MenuItem, *mygo.Window) {
			go o.settings.update(func(s *AppSettings) { change(&s.Monitor.Overlay) })
		}
	}
	mygo.NewMenu([]*mygo.MenuItem{
		{Label: "打开系统监控", Click: func(*mygo.MenuItem, *mygo.Window) { o.open() }},
		mygo.Separator(),
		{Label: "竖着排", Type: mygo.MenuItemCheckbox, Checked: s.Vertical, Click: set(func(s *OverlaySettings) { s.Vertical = !s.Vertical })},
		{Label: "鼠标穿透（之后用托盘或快捷键关掉悬浮窗）", Type: mygo.MenuItemCheckbox, Checked: s.ClickThrough, Click: set(func(s *OverlaySettings) { s.ClickThrough = !s.ClickThrough })},
		mygo.Separator(),
		{Label: "隐藏悬浮窗", Click: set(func(s *OverlaySettings) { s.Show = false })},
	}).Popup(win)
}

// Toggle shows or hides the window, as the shortcut and the tray ask.
func (o *Overlay) Toggle() {
	o.settings.update(func(s *AppSettings) { s.Monitor.Overlay.Show = !s.Monitor.Overlay.Show })
}

// remake closes the window, for apply to make another: after its display
// changed its scale, the window keeps a black box behind its page.
func (o *Overlay) remake() {
	o.mu.Lock()
	win := o.win
	if win == nil || o.dragging {
		o.mu.Unlock()
		return
	}
	o.win = nil
	o.mu.Unlock()
	win.Destroy()
}

// apply shows, hides or changes the window as the settings say.
func (o *Overlay) apply(s OverlaySettings) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if !s.Show {
		if o.win != nil {
			o.win.Hide()
		}
		o.monitor.Watch("overlay", false)
		return
	}
	w, h := o.w, o.h
	if w == 0 {
		w, h = 420, 34
	}
	x, y := s.X, s.Y
	if !s.Placed || !onDisplay(x+w/2, y+h/2) {
		x, y = overlayCorner(w)
	}
	if o.win == nil {
		o.win = mygo.NewWindow(mygo.WindowOptions{
			Title:           "系统监控悬浮窗",
			URL:             "/?overlay",
			X:               x,
			Y:               y,
			Width:           w,
			Height:          h,
			MinWidth:        w,
			MinHeight:       h,
			MaxWidth:        w,
			MaxHeight:       h,
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
		o.win.SetVisibleOnAllWorkspaces(true)
		win := o.win
		// Alt+F4 closes it for good; the next apply makes another.
		win.OnClose(func(*mygo.CloseEvent) {
			o.mu.Lock()
			if o.win == win {
				o.win = nil
			}
			o.mu.Unlock()
		})
	}
	if !o.dragging {
		o.win.SetPosition(x, y)
	}
	o.win.SetOpacity(s.Opacity)
	o.win.SetIgnoreMouseEvents(s.ClickThrough)
	if !o.win.IsVisible() {
		o.win.ShowInactive()
	}
	o.monitor.Watch("overlay", true)
}

// overlayCorner is where a window w wide starts: top right, clear of the
// screen's corner.
func overlayCorner(w int) (x, y int) {
	wa := mygo.Screen.PrimaryDisplay().WorkArea
	return wa.X + wa.Width - w - 24, wa.Y + 16
}
