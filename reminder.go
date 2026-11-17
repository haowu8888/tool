package main

import (
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// bubbleWidth is the reminder bubble's width; its page sets the height.
const bubbleWidth = 340

// Reminder is the bubble that pops up beside the floating ball when todos
// ring, since Windows' own notifications may be turned off. It stays until
// the user handles the todos, folds it away, or the minutes of the settings
// pass, as the user may be away; the ball keeps a red badge while any
// rings, and a click on it shows the todos.
type Reminder struct {
	mu        sync.Mutex
	win       *mygo.Window
	height    int
	alerts    int
	down      int         // services that went down, which it lists too
	builds    int         // Flow runs that failed, which it lists too
	collapsed bool        // folded away until another todo rings or service goes down
	hide      *time.Timer // folds it away after the minutes of the settings

	widget   *Widget
	chat     *PetChat // the bubble keeps clear of the pet's chat
	settings *Settings
	open     func() // shows the todos in the toolbox
}

// Collapse folds the bubble away; the ball keeps its badge.
func (r *Reminder) Collapse() {
	r.mu.Lock()
	r.collapsed = true
	r.stopHide()
	win := r.win
	r.mu.Unlock()
	if win != nil {
		win.Hide()
	}
}

// Open shows the todos in the toolbox and folds the bubble away.
func (r *Reminder) Open() {
	r.Collapse()
	if r.open != nil {
		r.open()
	}
}

// Resize fits the bubble to its page's content.
func (r *Reminder) Resize(height int) {
	r.mu.Lock()
	r.height = min(max(height, 60), 600)
	r.mu.Unlock()
	r.place()
}

// update shows or hides the bubble for the ringing todos; a todo that
// starts ringing unfolds it.
func (r *Reminder) update(alerts []Todo, fresh bool) {
	r.mu.Lock()
	r.alerts = len(alerts)
	if fresh {
		r.collapsed = false
		// A new todo gives the bubble its minutes again.
		r.armHide()
	}
	any := r.alerts+r.down+r.builds > 0
	r.mu.Unlock()
	r.widget.setAlert(any)
	r.place()
}

// services shows or hides the bubble for the services that are down; one
// that just went down unfolds it.
func (r *Reminder) services(down []ServiceView, fresh bool) {
	r.mu.Lock()
	r.down = len(down)
	if fresh {
		r.collapsed = false
		r.armHide()
	}
	any := r.alerts+r.down+r.builds > 0
	r.mu.Unlock()
	r.widget.setAlert(any)
	r.place()
}

// flow shows or hides the bubble for the Flow runs that failed; one that
// just failed unfolds it.
func (r *Reminder) flow(failed []FlowAlert, fresh bool) {
	r.mu.Lock()
	r.builds = len(failed)
	if fresh {
		r.collapsed = false
		r.armHide()
	}
	any := r.alerts+r.down+r.builds > 0
	r.mu.Unlock()
	r.widget.setAlert(any)
	r.place()
}

// remake closes the bubble's window, for place to make another: after its
// display changed its scale, the window keeps a black box behind its page.
// It stays unfolded or folded away as it was.
func (r *Reminder) remake() {
	r.mu.Lock()
	win := r.win
	r.win = nil
	r.mu.Unlock()
	if win != nil {
		win.Destroy()
	}
}

// place shows the bubble beside the ball, on the side with room, or in the
// work area's corner when the ball is hidden; or hides it.
func (r *Reminder) place() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.alerts+r.down+r.builds == 0 || r.collapsed {
		if r.win != nil {
			r.win.Hide()
		}
		return
	}
	h := r.height
	if h == 0 {
		h = 160
	}
	var x, y int
	if bx, by, size, ok := r.widget.anchor(); ok {
		wa := mygo.Screen.DisplayNearestPoint(mygo.Point{X: bx + size/2, Y: by + size/2}).WorkArea
		if bx+size/2 > wa.X+wa.Width/2 {
			x = bx - bubbleWidth - 4
		} else {
			x = bx + size + 4
		}
		y = by + size/2 - h/2
		x = min(max(x, wa.X), wa.X+wa.Width-bubbleWidth)
		y = min(max(y, wa.Y), wa.Y+wa.Height-h)
		if r.chat != nil {
			if c, ok := r.chat.bounds(); ok {
				x, y = clearOf(x, y, bubbleWidth, h, c, wa)
			}
		}
	} else {
		wa := mygo.Screen.PrimaryDisplay().WorkArea
		x, y = wa.X+wa.Width-bubbleWidth-16, wa.Y+wa.Height-h-16
	}
	if r.win == nil {
		r.win = mygo.NewWindow(mygo.WindowOptions{
			Title:           "待办提醒",
			URL:             "/?bubble",
			X:               x,
			Y:               y,
			Width:           bubbleWidth,
			Height:          h,
			MinWidth:        bubbleWidth,
			MaxWidth:        bubbleWidth,
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
		r.win.SetVisibleOnAllWorkspaces(true)
		win := r.win
		// Alt+F4 folds it away like its ×; the next place makes another.
		win.OnClose(func(*mygo.CloseEvent) {
			r.mu.Lock()
			if r.win == win {
				r.win, r.collapsed = nil, true
			}
			r.mu.Unlock()
		})
	}
	r.win.SetMinimumSize(bubbleWidth, h)
	r.win.SetMaximumSize(bubbleWidth, h)
	r.win.SetBounds(mygo.Rectangle{X: x, Y: y, Width: bubbleWidth, Height: h})
	if !r.win.IsVisible() {
		// Without the focus, so that typing elsewhere goes on.
		r.win.ShowInactive()
		r.armHide()
	}
}

// armHide folds the bubble away after the minutes of the settings, unless
// they are 0. Call with r.mu held.
func (r *Reminder) armHide() {
	r.stopHide()
	if m := r.settings.current().Reminder.AutoHide; m > 0 {
		r.hide = time.AfterFunc(time.Duration(m)*time.Minute, r.Collapse)
	}
}

func (r *Reminder) stopHide() {
	if r.hide != nil {
		r.hide.Stop()
		r.hide = nil
	}
}

// clearOf moves a window of the size at x, y off the rectangle c: above it,
// below it, or past it on the side away from the screen's nearer edge, as
// the work area has room; it stays where it is when there is none.
func clearOf(x, y, w, h int, c, wa mygo.Rectangle) (int, int) {
	if x >= c.X+c.Width || x+w <= c.X || y >= c.Y+c.Height || y+h <= c.Y {
		return x, y
	}
	const gap = 8
	if c.Y-gap-h >= wa.Y {
		return x, c.Y - gap - h
	}
	if c.Y+c.Height+gap+h <= wa.Y+wa.Height {
		return x, c.Y + c.Height + gap
	}
	if c.X-gap-w >= wa.X && c.X+c.Width/2 > wa.X+wa.Width/2 {
		return c.X - gap - w, y
	}
	if c.X+c.Width+gap+w <= wa.X+wa.Width {
		return c.X + c.Width + gap, y
	}
	if c.X-gap-w >= wa.X {
		return c.X - gap - w, y
	}
	return x, y
}
