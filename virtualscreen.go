package main

import (
	"log"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// VirtualScreenChanged is sent whenever the virtual screen turns on or off.
var VirtualScreenChanged = mygo.NewEvent[bool]("virtualScreenChanged")

// VirtualScreenFailed is sent with the reason when the shortcut, the tray
// or the floating ball could not turn the virtual screen on.
var VirtualScreenFailed = mygo.NewEvent[string]("virtualScreenFailed")

// VirtualScreen works like RustDesk's privacy mode 2: the desktop moves to
// a virtual display and the physical displays are detached, so their
// screens get no signal at all, while screen capture, and so remote
// desktop tools, see and work the virtual display.
type VirtualScreen struct {
	mu   sync.Mutex
	sw   *virtualSwitch
	done chan struct{} // closed by Stop

	// onChange, when set, is called after the virtual screen turns on or off.
	onChange func(active bool)
}

// Start moves the desktop to the virtual display, plugging it in if need
// be, and detaches the physical displays. It does nothing when it is on
// already.
func (v *VirtualScreen) Start() error {
	v.mu.Lock()
	if v.sw != nil {
		v.mu.Unlock()
		return nil
	}
	sw, err := switchToVirtual()
	if err != nil {
		v.mu.Unlock()
		return err
	}
	v.sw = sw
	v.done = make(chan struct{})
	go v.watch(sw, v.done)
	v.mu.Unlock()
	v.changed(true)
	return nil
}

// Stop brings the physical displays back as they were.
func (v *VirtualScreen) Stop() {
	if v.stop() {
		v.changed(false)
	}
}

// Toggle turns the virtual screen on or off. When it is off but no
// physical display shows, as when RustDesk left its virtual display with
// the physical ones detached, it brings them back instead.
func (v *VirtualScreen) Toggle() {
	if v.IsActive() {
		v.Stop()
		return
	}
	if rescued, err := v.rescue(); err != nil {
		log.Println("rescue displays:", err)
		notify("找回物理屏失败", err.Error())
		return
	} else if rescued {
		notify("已找回物理屏", "刚才没有亮着的物理屏（RustDesk 的隐私模式或残留的虚拟显示器占着桌面），已点亮并拔掉虚拟显示器。")
		return
	}
	if err := v.Start(); err != nil {
		log.Println("virtual screen:", err)
		// The window may be hidden: a notification tells, and the page
		// shows it too.
		VirtualScreenFailed.Broadcast(err.Error())
		notify("断开物理屏失败", err.Error())
	}
}

// notify shows a desktop notification of the virtual screen.
func notify(title, body string) {
	n := mygo.NewNotification(mygo.NotificationOptions{ID: "virtual-screen", Title: title, Body: body})
	if err := n.Show(); err != nil {
		log.Println("notify:", err)
	}
}

// Rescue brings the physical displays back when none shows though the
// virtual screen is off, and reports whether it had to.
func (v *VirtualScreen) Rescue() (bool, error) {
	return v.rescue()
}

func (v *VirtualScreen) rescue() (bool, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.sw != nil {
		return false, nil
	}
	return rescueDisplays()
}

// DisplayInfo is a monitor as the page lists it.
type DisplayInfo struct {
	Name    string `json:"name"`    // the output, as \\.\DISPLAY1
	Monitor string `json:"monitor"` // the monitor's name
	Adapter string `json:"adapter"` // the graphics adapter or the virtual display driver
	Virtual bool   `json:"virtual"` // a monitor of usbmmidd, the virtual display driver
	// Mine is whether it is the virtual display this app moved the
	// desktop to; another virtual display is RustDesk's, mostly.
	Mine    bool  `json:"mine"`
	Active  bool  `json:"active"` // attached to the desktop, so showing
	Primary bool  `json:"primary"`
	Width   int32 `json:"width"`
	Height  int32 `json:"height"`
}

// Displays lists the monitors, physical and virtual, and whether they
// show.
func (v *VirtualScreen) Displays() []DisplayInfo {
	list := listDisplays()
	active := v.IsActive()
	for i := range list {
		list[i].Mine = active && list[i].Virtual && list[i].Active
	}
	return list
}

// IsActive reports whether the desktop is on the virtual display.
func (v *VirtualScreen) IsActive() bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.sw != nil
}

func (v *VirtualScreen) stop() bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.sw == nil {
		return false
	}
	close(v.done)
	v.sw.restore()
	v.sw = nil
	return true
}

// watch ends the virtual screen when the displays change under it:
// something else, RustDesk say, unplugged the virtual display or attached
// a physical display again.
func (v *VirtualScreen) watch(sw *virtualSwitch, done <-chan struct{}) {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	misses := 0
	for {
		select {
		case <-done:
			return
		case <-t.C:
		}
		if !sw.broken() {
			misses = 0
		} else if misses++; misses == 2 {
			log.Println("the displays changed under the virtual display")
			v.mu.Lock()
			current := v.sw == sw
			v.mu.Unlock()
			if current {
				v.Stop()
			}
			return
		}
	}
}

func (v *VirtualScreen) changed(active bool) {
	VirtualScreenChanged.Broadcast(active)
	if v.onChange != nil {
		v.onChange(active)
	}
}
