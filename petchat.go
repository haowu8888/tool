package main

import (
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// The pet chat's window size, in DIPs.
const (
	petChatWidth  = 380
	petChatHeight = 520
)

// PetChatOpened tells the chat's page it came up, to take the keys.
var PetChatOpened = mygo.NewEvent[int]("petChatOpened")

// PetChat is the chat with the floating ball's pet: a long press on it, or
// its menu, brings it up beside the ball, and the AI of the settings
// answers as the pet (AI.Chat). Closing it hides it, the chat kept. It is
// not on top of the others: clicked away, it goes behind the window clicked
// rather than covering it, and the next long press brings it back.
type PetChat struct {
	mu  sync.Mutex
	win *mygo.Window

	widget       *Widget
	openSettings func() // shows the AI's settings
	onMove       func() // after it showed, moved or hid: the reminder bubble keeps clear of it
}

// Open shows the chat beside the ball, or in the work area's corner when
// the ball is hidden, and gives it the keys.
func (p *PetChat) Open() {
	p.mu.Lock()
	if p.win == nil {
		p.win = mygo.NewWindow(mygo.WindowOptions{
			Title:           "和桌宠聊天",
			URL:             "/?petchat",
			Width:           petChatWidth,
			Height:          petChatHeight,
			MinWidth:        petChatWidth,
			MinHeight:       petChatHeight,
			MaxWidth:        petChatWidth,
			MaxHeight:       petChatHeight,
			Hidden:          true,
			Frameless:       true,
			SkipTaskbar:     true,
			DisableResize:   true,
			DisableMinimize: true,
			DisableMaximize: true,
			BackgroundColor: "light-dark(#ffffff, #1a1d23)", // the page's --card
		})
		// Alt+F4 hides it, the chat kept; quitting lets it close.
		p.win.OnClose(func(e *mygo.CloseEvent) {
			if appQuitting.Load() {
				return
			}
			e.PreventDefault()
			go p.Hide()
		})
	}
	win := p.win
	if !win.IsVisible() {
		x, y := p.place()
		win.SetBounds(mygo.Rectangle{X: x, Y: y, Width: petChatWidth, Height: petChatHeight})
	}
	p.mu.Unlock()
	win.Show()
	win.Focus()
	PetChatOpened.Broadcast(0)
	p.moved()
	// The ball is a window of its own; the chat may come up behind the
	// window in front, without the keys.
	time.Sleep(60 * time.Millisecond)
	forceFocus(win.NativeHandle())
}

// bounds is where the chat shows, or false when it is hidden.
func (p *PetChat) bounds() (mygo.Rectangle, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.win == nil || !p.win.IsVisible() {
		return mygo.Rectangle{}, false
	}
	return p.win.Bounds(), true
}

func (p *PetChat) moved() {
	if p.onMove != nil {
		p.onMove()
	}
}

// place is where the chat shows: beside the ball on the side with room,
// its bottom by the ball's.
func (p *PetChat) place() (int, int) {
	bx, by, size, ok := p.widget.anchor()
	if !ok {
		wa := mygo.Screen.PrimaryDisplay().WorkArea
		return wa.X + wa.Width - petChatWidth - 16, wa.Y + wa.Height - petChatHeight - 16
	}
	wa := mygo.Screen.DisplayNearestPoint(mygo.Point{X: bx + size/2, Y: by + size/2}).WorkArea
	x := bx + size + 8
	if bx+size/2 > wa.X+wa.Width/2 {
		x = bx - petChatWidth - 8
	}
	y := by + size - petChatHeight
	x = min(max(x, wa.X), wa.X+wa.Width-petChatWidth)
	y = min(max(y, wa.Y), wa.Y+wa.Height-petChatHeight)
	return x, y
}

// Hide hides the chat.
func (p *PetChat) Hide() {
	p.mu.Lock()
	win := p.win
	p.mu.Unlock()
	if win != nil {
		win.Hide()
		p.moved()
	}
}

// Drag moves the chat with the pointer until the mouse button is released.
func (p *PetChat) Drag() {
	p.mu.Lock()
	win := p.win
	p.mu.Unlock()
	if win == nil {
		return
	}
	go func() {
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
		x, y = keepOnScreen(x, y, petChatWidth, false)
		win.SetPosition(x, y)
		p.moved()
	}()
}

// OpenSettings shows the AI's settings in the toolbox.
func (p *PetChat) OpenSettings() {
	p.Hide()
	if p.openSettings != nil {
		p.openSettings()
	}
}
