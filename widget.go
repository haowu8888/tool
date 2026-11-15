package main

import (
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// ShowTool asks the toolbox's page to show a tool.
var ShowTool = mygo.NewEvent[string]("showTool")

// widgetPad is the transparent margin around the ball, for its shadow.
const widgetPad = 6

// snapDistance is how close to a screen edge a dropped ball sticks to it.
const snapDistance = 32

// tuckDelay is how long the pointer is away before the ball tucks in.
const tuckDelay = 250 * time.Millisecond

// Widget is the floating ball: a small window that stays on top of the
// others like a desktop pet. A click opens the toolbox, a right click its
// menu, and dragging moves it. Stuck to a screen edge, it can tuck half of
// itself behind the edge until the pointer comes over it.
type Widget struct {
	mu       sync.Mutex
	win      *mygo.Window
	dragging bool
	menuOpen bool

	x, y   int  // where the ball shows whole
	edge   int  // the screen edge it tucks behind: -1 left, 1 right, 0 none
	tucked bool // half behind the edge
	alert  bool // todos ring: the ball stays out to show its badge
	slides int  // counts slides, so that a new one stops the one before
	timer  *time.Timer

	settings *Settings
	open     func()
	menu     func() *mygo.Menu
	onMove   func() // after the ball was dragged elsewhere
}

// Open opens the toolbox.
func (w *Widget) Open() {
	w.open()
}

// Menu shows the ball's menu at the pointer.
func (w *Widget) Menu() {
	w.mu.Lock()
	win := w.win
	w.menuOpen = true
	w.mu.Unlock()
	if win != nil {
		w.menu().Popup(win)
	}
	w.mu.Lock()
	w.menuOpen = false
	w.mu.Unlock()
	w.Peek(false)
}

// Peek slides a tucked ball out as the pointer comes over it, and tucks it
// in again a moment after the pointer leaves.
func (w *Widget) Peek(over bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.win == nil {
		return // being made anew
	}
	if w.timer != nil {
		w.timer.Stop()
		w.timer = nil
	}
	if over {
		if w.tucked {
			w.tucked = false
			w.slide(w.x)
		}
		return
	}
	if w.edge != 0 && !w.tucked {
		w.timer = time.AfterFunc(tuckDelay, w.tuck)
	}
}

// tuck slides the ball half behind its edge, unless the pointer is over it
// or the user is busy with it.
func (w *Widget) tuck() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.timer = nil
	if w.win == nil || w.edge == 0 || w.tucked || w.dragging || w.menuOpen || w.alert || w.pointerOver() {
		return
	}
	w.tucked = true
	w.slide(w.tuckedX())
}

// slide moves the ball to x in a few steps, easing out. Call with w.mu held.
func (w *Widget) slide(to int) {
	w.slides++
	n, win, y := w.slides, w.win, w.y
	from, _ := win.Position()
	go func() {
		const steps = 6
		for i := 1; i <= steps; i++ {
			time.Sleep(10 * time.Millisecond)
			w.mu.Lock()
			stale := n != w.slides
			w.mu.Unlock()
			if stale {
				return
			}
			left := steps - i
			win.SetPosition(to-(to-from)*left*left/(steps*steps), y)
		}
	}()
}

// tuckedX is where half of the ball is behind its edge.
func (w *Widget) tuckedX() int {
	half := w.win.Bounds().Width / 2
	return w.x + w.edge*half
}

// pointerOver reports whether the pointer is over the whole ball's place.
func (w *Widget) pointerOver() bool {
	c := mygo.Screen.CursorScreenPoint()
	size := w.win.Bounds().Width
	return c.X >= w.x && c.X < w.x+size && c.Y >= w.y && c.Y < w.y+size
}

// Drag moves the ball with the pointer until the mouse button is released,
// then sticks it to a near screen edge and keeps its position.
func (w *Widget) Drag() {
	w.mu.Lock()
	win := w.win
	if win == nil || w.dragging {
		w.mu.Unlock()
		return
	}
	w.dragging = true
	w.slides++ // stop a slide
	w.mu.Unlock()

	go func() {
		defer func() {
			w.mu.Lock()
			w.dragging = false
			w.mu.Unlock()
		}()
		x, y := win.Position()
		c := mygo.Screen.CursorScreenPoint()
		dx, dy := c.X-x, c.Y-y
		t := time.NewTicker(10 * time.Millisecond)
		defer t.Stop()
		for mouseDown() {
			<-t.C
			c := mygo.Screen.CursorScreenPoint()
			if c.X-dx != x || c.Y-dy != y {
				x, y = c.X-dx, c.Y-dy
				win.SetPosition(x, y)
			}
		}
		x, y = keepOnScreen(x, y, w.windowSize(), w.settings.current().Widget.Snap)
		win.SetPosition(x, y)
		// Saving applies the settings: the ball tucks in once the pointer
		// leaves it.
		w.settings.placeWidget(x, y)
		if w.onMove != nil {
			w.onMove()
		}
	}()
}

// setAlert keeps the ball out of its edge while todos ring, so that its
// badge shows, and lets it tuck in again after.
func (w *Widget) setAlert(on bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.alert == on {
		return
	}
	w.alert = on
	if w.win == nil {
		return
	}
	if on && w.tucked {
		w.tucked = false
		w.slide(w.x)
	} else if !on && w.edge != 0 && !w.tucked && w.timer == nil {
		w.timer = time.AfterFunc(tuckDelay, w.tuck)
	}
}

// anchor returns where the ball shows whole and its size, or false when it
// is hidden.
func (w *Widget) anchor() (x, y, size int, ok bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.win == nil || !w.win.IsVisible() {
		return 0, 0, 0, false
	}
	return w.x, w.y, w.win.Bounds().Width, true
}

// remake closes the ball's window, for apply to make another: after its
// display changed its scale, the window keeps a black box behind the ball.
func (w *Widget) remake() {
	w.mu.Lock()
	win := w.win
	if win == nil || w.dragging || w.menuOpen {
		w.mu.Unlock()
		return
	}
	w.win = nil
	w.slides++ // stop a slide
	if w.timer != nil {
		w.timer.Stop()
		w.timer = nil
	}
	w.mu.Unlock()
	win.Destroy()
}

// apply shows, hides or resizes the ball as the settings say.
func (w *Widget) apply(s WidgetSettings) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if !s.Show {
		if w.win != nil {
			w.win.Hide()
		}
		return
	}
	size := s.Size + 2*widgetPad
	x, y := s.X, s.Y
	if !s.Placed || !onScreen(x, y, size) {
		wa := mygo.Screen.PrimaryDisplay().WorkArea
		x, y = wa.X+wa.Width-size-24, wa.Y+wa.Height*2/3
	}
	if w.win == nil {
		w.win = mygo.NewWindow(mygo.WindowOptions{
			Title:  "工具箱悬浮球",
			URL:    "/?widget",
			X:      x,
			Y:      y,
			Width:  size,
			Height: size,
			// Without them Windows keeps a window at least 136 wide.
			MinWidth:        size,
			MinHeight:       size,
			MaxWidth:        size,
			MaxHeight:       size,
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
		w.win.SetVisibleOnAllWorkspaces(true)
		win := w.win
		// Alt+F4 closes it for good; the next apply makes another.
		win.OnClose(func(*mygo.CloseEvent) {
			w.mu.Lock()
			if w.win == win {
				w.win = nil
			}
			w.mu.Unlock()
		})
	} else {
		w.win.SetMinimumSize(size, size)
		w.win.SetMaximumSize(size, size)
	}
	w.x, w.y = x, y
	w.edge = 0
	if s.Snap && s.Tuck {
		// Windows may keep the window a little wider than asked.
		w.edge = edgeOf(x, y, w.win.Bounds().Width)
	}
	w.slides++ // stop a slide
	w.tucked = w.edge != 0 && !w.dragging && !w.menuOpen && !w.alert && !w.pointerOver()
	w.win.SetBounds(mygo.Rectangle{X: x, Y: y, Width: size, Height: size})
	w.win.SetOpacity(s.Opacity)
	if !w.win.IsVisible() {
		w.win.ShowInactive()
	}
	// SetBounds and showing keep the window on the screen; SetPosition
	// lets half of it go past the edge.
	if w.tucked {
		w.win.SetPosition(w.tuckedX(), y)
	}
}

func (w *Widget) windowSize() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.win == nil {
		return 0
	}
	return w.win.Bounds().Width
}

// onScreen reports whether a window of the size at x, y shows on a display.
func onScreen(x, y, size int) bool {
	return onDisplay(x+size/2, y+size/2)
}

// onDisplay reports whether a point is on a display.
func onDisplay(x, y int) bool {
	for _, d := range mygo.Screen.Displays() {
		b := d.Bounds
		if x >= b.X && x < b.X+b.Width && y >= b.Y && y < b.Y+b.Height {
			return true
		}
	}
	return false
}

// keepOnScreen keeps a window of the size in the work area of the display
// nearest to it, and with snap against its left or right edge when it is
// close.
func keepOnScreen(x, y, size int, snap bool) (int, int) {
	wa := mygo.Screen.DisplayNearestPoint(mygo.Point{X: x + size/2, Y: y + size/2}).WorkArea
	x = min(max(x, wa.X), wa.X+wa.Width-size)
	y = min(max(y, wa.Y), wa.Y+wa.Height-size)
	if !snap {
		return x, y
	}
	if x-wa.X < snapDistance {
		x = wa.X
	} else if wa.X+wa.Width-size-x < snapDistance {
		x = wa.X + wa.Width - size
	}
	return x, y
}

// edgeOf tells the screen edge a window of the size at x, y is against:
// -1 left, 1 right, 0 none, or an edge another display continues.
func edgeOf(x, y, size int) int {
	d := mygo.Screen.DisplayNearestPoint(mygo.Point{X: x + size/2, Y: y + size/2})
	wa, b, mid := d.WorkArea, d.Bounds, y+size/2
	switch {
	case x == wa.X && !onDisplay(b.X-1, mid):
		return -1
	case x+size == wa.X+wa.Width && !onDisplay(b.X+b.Width, mid):
		return 1
	}
	return 0
}
