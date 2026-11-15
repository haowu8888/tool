package main

import (
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/egoist/mygo"
)

// VirtualScreenChanged is sent whenever the virtual screen turns on or off.
var VirtualScreenChanged = mygo.NewEvent[bool]("virtualScreenChanged")

// VirtualScreenFailed is sent with the reason when the shortcut, the tray
// or the floating ball could not turn the virtual screen on.
var VirtualScreenFailed = mygo.NewEvent[string]("virtualScreenFailed")

// holdDelay is how long the displays must stay changed before the virtual
// screen is put back: changes come several in a row, as RustDesk's when
// its session ends.
const holdDelay = 600 * time.Millisecond

// lockGrace is how long after the screen locked the keyboard and mouse do
// not count as someone at the computer: RustDesk locks it as its session
// ends, right after the remote side's last keys.
const lockGrace = 3 * time.Second

// maxHolds is how many times a minute the virtual screen is put back
// before it gives up: something keeps changing the displays.
const maxHolds = 5

// rustdeskHolds is why the shortcut leaves the displays alone while
// RustDesk has them. The page's dialog looks for 物理显示器 in it.
const rustdeskHolds = "RustDesk 正连着，物理显示器已经是断开的（多半是它的隐私模式开着），没有再断开一次。"

// gaveUp is why the virtual screen ended by itself. The page's dialog
// looks for 保持不住 in it.
const gaveUp = "别的程序一直在改显示器，断开物理屏保持不住，已经把本机屏幕恢复了。"

// VirtualScreen works like RustDesk's privacy mode 2: the desktop moves to
// a virtual display and the physical displays are detached, so their
// screens get no signal at all, while screen capture, and so remote
// desktop tools, see and work the virtual display. It stays so until the
// user turns it off: when something else changes the displays under it, as
// RustDesk does when its session ends, it detaches the physical displays
// again.
type VirtualScreen struct {
	mu   sync.Mutex
	sw   *virtualSwitch
	done chan struct{} // closed by Stop
	// nudge wakes the watch when Windows tells that the displays changed.
	nudge chan struct{}
	// locked is when the screen locked, in Unix nanoseconds, 0 while it is
	// not; idle tells how long ago the keyboard or mouse were last used.
	locked atomic.Int64
	idle   func() time.Duration

	// onChange, when set, is called after the virtual screen turns on or off.
	onChange func(active bool)
	// show, when set, brings the toolbox's window up, for the page to tell
	// what the shortcut could not do: notifications may be turned off.
	show func()
}

// NewVirtualScreen returns the virtual screen, off.
func NewVirtualScreen() *VirtualScreen {
	return &VirtualScreen{nudge: make(chan struct{}, 1)}
}

// setLocked tells that the screen locked or unlocked. Locked, the global
// shortcut does not work, and with the physical displays detached nobody
// at the computer sees where to sign in: the watch brings them back once
// someone uses its keyboard or mouse (someoneHere).
func (v *VirtualScreen) setLocked(locked bool) {
	// On the main thread, which the displays' changes wait for: it takes no
	// lock here.
	log.Println("screen locked:", locked)
	if locked {
		v.locked.Store(time.Now().UnixNano())
	} else {
		v.locked.Store(0)
	}
}

// someoneHere reports whether someone uses this computer's own keyboard
// or mouse at the lock screen: they were used since it locked, and not by
// RustDesk's remote side, which signs in through them too.
func (v *VirtualScreen) someoneHere() bool {
	at := v.locked.Load()
	if at == 0 || v.idle == nil {
		return false
	}
	used := time.Now().Add(-v.idle())
	return used.After(time.Unix(0, at).Add(lockGrace)) && !rustdeskConnected()
}

// displaysChanged has the watch look at the displays now rather than at
// its next second.
func (v *VirtualScreen) displaysChanged() {
	select {
	case v.nudge <- struct{}{}:
	default:
	}
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
	if v.stop(nil) {
		v.changed(false)
	}
}

// Toggle turns the virtual screen on or off. When it is off but no
// physical display shows, as when a virtual display was left with the
// physical ones detached or no display is left at all, it brings them back
// instead; unless RustDesk is connected, whose privacy mode it then is,
// mostly: the displays stay as they are and the page offers to bring the
// physical ones back.
func (v *VirtualScreen) Toggle() {
	log.Println("toggle the virtual screen, active:", v.IsActive(), "displays:", describeDisplays())
	if v.IsActive() {
		v.Stop()
		return
	}
	if heldByRustDesk() {
		v.failed("断开物理屏失败", rustdeskHolds)
		return
	}
	if rescued, err := v.rescue(); err != nil {
		log.Println("rescue displays:", err)
		notify("找回物理屏失败", err.Error())
		return
	} else if rescued {
		notify("已找回物理屏", "刚才没有亮着的物理屏（残留的虚拟显示器占着桌面，或者一块显示器都没有），已点亮并拔掉虚拟显示器。")
		return
	}
	if err := v.Start(); err != nil {
		v.failed("断开物理屏失败", err.Error())
	}
}

// failed tells why the shortcut, the tray or the floating ball could not
// do it: in the page's dialog, with the window brought up, since the
// notification may be turned off.
func (v *VirtualScreen) failed(title, reason string) {
	log.Println("virtual screen:", reason)
	VirtualScreenFailed.Broadcast(reason)
	notify(title, reason)
	if v.show != nil {
		v.show()
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

// stop brings the physical displays back and reports whether the virtual
// screen was on; with only, just when that switch is still the one on.
func (v *VirtualScreen) stop(only *virtualSwitch) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.sw == nil || only != nil && v.sw != only {
		return false
	}
	close(v.done)
	v.sw.restore()
	v.sw = nil
	return true
}

// watch keeps the virtual screen on when the displays change under it:
// something else, RustDesk say, unplugged the virtual display or attached
// a physical display again. It puts the desktop back on a virtual display
// and detaches the physical ones; when that keeps happening, it gives up
// and brings the physical displays back. So it does for someone at the
// locked computer.
func (v *VirtualScreen) watch(sw *virtualSwitch, done <-chan struct{}) {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	var holds []time.Time
	for {
		select {
		case <-done:
			return
		case <-t.C:
		case <-v.nudge:
		}
		if v.someoneHere() {
			log.Println("someone is at the locked computer: bringing the physical displays back")
			if v.stop(sw) {
				v.changed(false)
			}
			return
		}
		if !v.broken(sw) {
			continue
		}
		select {
		case <-done:
			return
		case <-time.After(holdDelay):
		}
		if !v.broken(sw) {
			continue
		}
		for len(holds) > 0 && time.Since(holds[0]) > time.Minute {
			holds = holds[1:]
		}
		if len(holds) == maxHolds {
			log.Println("the displays keep changing under the virtual display: giving up")
			if v.stop(sw) {
				v.changed(false)
				v.failed("断开物理屏已结束", gaveUp)
			}
			return
		}
		holds = append(holds, time.Now())
		v.mu.Lock()
		if v.sw != sw {
			v.mu.Unlock()
			return
		}
		err := sw.hold()
		v.mu.Unlock()
		if err != nil {
			log.Println("hold the virtual display:", err)
		}
	}
}

// broken reports whether the displays changed under the switch, while it
// is the current one.
func (v *VirtualScreen) broken(sw *virtualSwitch) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.sw == sw && sw.broken()
}

func (v *VirtualScreen) changed(active bool) {
	VirtualScreenChanged.Broadcast(active)
	if v.onChange != nil {
		v.onChange(active)
	}
}
