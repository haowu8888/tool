//go:build windows

package main

import (
	"encoding/json"
	"flag"
	"image"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
	"unsafe"
)

// The tests here change the displays of the desktop they run on, so they
// only run when asked for by -desk, through .dev\desktest.ps1:
//
//	-test.run TestDeskDisplays -test.v -desk res        the primary display to 1920×1080 for a few seconds
//	-test.run TestDeskDisplays -test.v -desk rd-on      what RustDesk's privacy mode 2 does when it turns on
//	-test.run TestDeskDisplays -test.v -desk rd-off     and when it turns off
//	-test.run TestDeskDisplays -test.v -desk unplug     a virtual display plugged out, as RustDesk does when its last session ends
//	-test.run TestDeskDisplays -test.v -desk plug       a virtual display plugged in, as RustDesk does for a computer without displays
//	-test.run TestDeskDisplays -test.v -desk lock       the screen locked, which the user has to unlock
//	-test.run TestDeskDisplays -test.v -desk attach     the outputs with a monitor attached to the desktop, as the last way to light them
//	-test.run TestDeskDisplays -test.v -desk probe      the floating ball's window, as Windows has it
//	-test.run TestDeskDisplays -test.v -desk close-ball the floating ball's window closed
//	-test.run TestDeskDisplays -test.v -desk shot       only the picture
//
// Each leaves a picture of the screen in .dev\desk-<step>.png.
var deskStep = flag.String("desk", "", "the display test to run on this desktop")

const (
	cdsGlobal        = 0x8
	deskStateFile    = ".dev/desk-rd.json"
	smCxVirtual      = 78
	smCyVirtual      = 79
	smXVirtual       = 76
	smYVirtual       = 77
	deskSettleTime   = 4 * time.Second
	enumRegistryMode = 0xfffffffe
)

// rdDisplay is a display as RustDesk's privacy mode remembers it.
type rdDisplay struct {
	Name    string `json:"name"`
	Primary bool   `json:"primary"`
	Virtual bool   `json:"virtual"`
	Mode    []byte `json:"mode"`
}

func TestDeskDisplays(t *testing.T) {
	if *deskStep == "" {
		t.Skip("changes the displays: run with -desk")
	}
	user32.NewProc("SetProcessDPIAware").Call()
	logDisplays(t, "before")
	switch *deskStep {
	case "shot":
	case "probe":
		deskProbe(t)
		return
	case "fake-cm":
		// A stand-in for RustDesk's connection manager, for a minute:
		// cmd.exe copied to .dev\rd-fake\rustdesk.exe.
		cmd := exec.Command(`.dev\rd-fake\rustdesk.exe`)
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CmdLine: `rustdesk.exe /c ping -n 60 127.0.0.1 >nul & rem --cm`}
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		time.Sleep(500 * time.Millisecond)
		t.Log("RustDesk connected:", rustdeskConnected())
		return
	case "lock":
		// Locks the screen, as RustDesk does when its session ends.
		if r, _, err := user32.NewProc("LockWorkStation").Call(); r == 0 {
			t.Fatal(err)
		}
		return
	case "attach":
		attachPhysical()
		time.Sleep(deskSettleTime)
	case "close-ball":
		title, _ := syscall.UTF16PtrFromString("工具箱悬浮球")
		hwnd, _, _ := user32.NewProc("FindWindowW").Call(0, uintptr(unsafe.Pointer(title)))
		user32.NewProc("PostMessageW").Call(hwnd, 0x10, 0, 0)
		return
	case "res":
		deskResolution(t)
	case "rd-on":
		deskRustDeskOn(t)
	case "rd-off":
		deskRustDeskOff(t)
	case "unplug":
		if err := plugMonitor(false); err != nil {
			t.Fatal(err)
		}
		time.Sleep(deskSettleTime)
	case "plug":
		if err := plugMonitor(true); err != nil {
			t.Fatal(err)
		}
		time.Sleep(deskSettleTime)
	default:
		t.Fatalf("unknown step %q", *deskStep)
	}
	logDisplays(t, "after")
	deskPicture(t, *deskStep)
}

// deskResolution sets the primary display to 1920×1080, as RustDesk does to
// the virtual display of its privacy mode, takes a picture and sets it back.
func deskResolution(t *testing.T) {
	var primary *display
	displays, _ := activeDisplays()
	for i, d := range displays {
		if d.Primary {
			primary = &displays[i]
		}
	}
	if primary == nil {
		t.Fatal("no primary display")
	}
	w, h := uint32(1920), uint32(1080)
	if !hasMode(primary.Name, w, h) {
		h = 1200
		if !hasMode(primary.Name, w, h) {
			t.Fatal("the primary display has neither 1920×1080 nor 1920×1200")
		}
	}
	old := primary.mode()
	defer func() {
		if err := changeDisplay(primary.Name, old, cdsUpdateRegistry|cdsGlobal|cdsReset); err != nil {
			t.Error("set back:", err)
		}
		time.Sleep(deskSettleTime)
		logDisplays(t, "set back")
		deskPicture(t, "res-back")
	}()
	if err := rdChangeResolution(primary.Name, w, h); err != nil {
		t.Fatal(err)
	}
	time.Sleep(deskSettleTime)
	logDisplays(t, "changed")
	deskPicture(t, "res-changed")
}

// rdChangeResolution is RustDesk's platform::change_resolution.
func rdChangeResolution(name string, w, h uint32) error {
	m := &devMode{size: uint16(unsafe.Sizeof(devMode{})), pelsWidth: w, pelsHeight: h, fields: dmPelsWidth | dmPelsHeight}
	return changeDisplay(name, m, cdsUpdateRegistry|cdsGlobal|cdsReset)
}

// rdDisplays is set_displays of RustDesk's privacy mode: the displays
// attached to the desktop, a detached 0×0 one too.
func rdDisplays() (physical, virtual []rdDisplay) {
	for i := uint32(0); ; i++ {
		dd := displayDevice{cb: uint32(unsafe.Sizeof(displayDevice{}))}
		if r, _, _ := enumDisplayDevices.Call(0, uintptr(i), uintptr(unsafe.Pointer(&dd)), 0); r == 0 {
			break
		}
		if dd.stateFlags&displayDeviceActive == 0 || dd.stateFlags&displayDeviceMirror != 0 {
			continue
		}
		m := devMode{size: uint16(unsafe.Sizeof(devMode{}))}
		if r, _, _ := enumDisplaySettingsEx.Call(uintptr(unsafe.Pointer(&dd.deviceName[0])), enumCurrentSettings, uintptr(unsafe.Pointer(&m)), 0); r == 0 {
			if r, _, _ := enumDisplaySettingsEx.Call(uintptr(unsafe.Pointer(&dd.deviceName[0])), enumRegistryMode, uintptr(unsafe.Pointer(&m)), 0); r == 0 {
				continue
			}
		}
		d := rdDisplay{
			Name:    syscall.UTF16ToString(dd.deviceName[:]),
			Primary: dd.stateFlags&displayDevicePrimary != 0,
			Virtual: strings.HasPrefix(syscall.UTF16ToString(dd.deviceString[:]), virtualDeviceString),
			Mode:    append([]byte(nil), unsafe.Slice((*byte)(unsafe.Pointer(&m)), unsafe.Sizeof(m))...),
		}
		if d.Virtual {
			virtual = append(virtual, d)
		} else {
			physical = append(physical, d)
		}
	}
	return physical, virtual
}

func (d rdDisplay) mode() *devMode {
	m := new(devMode)
	copy(unsafe.Slice((*byte)(unsafe.Pointer(m)), unsafe.Sizeof(*m)), d.Mode)
	return m
}

// deskRustDeskOn is turn_on_privacy of RustDesk's privacy mode 2, without
// its keyboard and mouse hooks.
func deskRustDeskOn(t *testing.T) {
	physical, virtual := rdDisplays()
	t.Logf("RustDesk sees %d physical and %d virtual displays", len(physical), len(virtual))
	if len(physical) == 0 {
		t.Fatal("RustDesk: no physical displays")
	}
	added := 0
	if len(virtual) == 0 {
		if err := plugMonitor(true); err != nil {
			t.Fatal(err)
		}
		added = 1
		for start := time.Now(); len(virtual) == 0 && time.Since(start) < 6*time.Second; {
			time.Sleep(500 * time.Millisecond)
			physical, virtual = rdDisplays()
		}
		if len(virtual) == 0 {
			t.Fatal("RustDesk: no virtual displays")
		}
	}
	b, _ := json.Marshal(map[string]any{"physical": physical, "virtual": virtual, "added": added})
	if err := os.WriteFile(deskStateFile, b, 0o644); err != nil {
		t.Fatal(err)
	}
	// set_primary_display
	virt := virtual[0]
	m := virt.mode()
	offX, offY := m.positionX, m.positionY
	m.positionX, m.positionY = 0, 0
	m.fields |= dmPosition
	if err := changeDisplay(virt.Name, m, cdsUpdateRegistry|cdsNoReset|cdsSetPrimary); err != nil {
		t.Fatal(err)
	}
	for _, d := range append(physical, virtual[1:]...) {
		m := d.mode()
		m.positionX -= offX
		m.positionY -= offY
		m.fields |= dmPosition
		if err := changeDisplay(d.Name, m, cdsUpdateRegistry|cdsNoReset); err != nil {
			t.Fatal(err)
		}
	}
	// disable_physical_displays
	for _, d := range physical {
		m := d.mode()
		m.positionX, m.positionY = 10000, 10000
		m.pelsWidth, m.pelsHeight = 0, 0
		if err := changeDisplay(d.Name, m, cdsUpdateRegistry|cdsNoReset); err != nil {
			t.Fatal(err)
		}
	}
	if err := changeDisplay("", nil, cdsReset); err != nil {
		t.Fatal(err)
	}
	if err := rdChangeResolution(virt.Name, 1920, 1080); err != nil {
		t.Log("change_resolution:", err)
	}
	time.Sleep(deskSettleTime)
}

// deskRustDeskOff is turn_off_privacy: the displays as they were when the
// privacy mode turned on, and the virtual displays it plugged in out.
func deskRustDeskOff(t *testing.T) {
	b, err := os.ReadFile(deskStateFile)
	if err != nil {
		t.Fatal(err)
	}
	var s struct {
		Physical, Virtual []rdDisplay
		Added             int
	}
	if err := json.Unmarshal(b, &s); err != nil {
		t.Fatal(err)
	}
	os.Remove(deskStateFile)
	for _, d := range append(s.Physical, s.Virtual...) {
		flags := uint32(cdsUpdateRegistry | cdsNoReset)
		if d.Primary {
			flags |= cdsSetPrimary
		}
		if err := changeDisplay(d.Name, d.mode(), flags); err != nil {
			t.Log(err)
		}
	}
	if err := changeDisplay("", nil, 0); err != nil {
		t.Log(err)
	}
	for range s.Added {
		if err := plugMonitor(false); err != nil {
			t.Log(err)
		}
	}
	time.Sleep(deskSettleTime)
}

func logDisplays(t *testing.T, when string) {
	physical, virtual := rdDisplays()
	for _, d := range append(physical, virtual...) {
		m := d.mode()
		t.Logf("%s: %s virtual=%v primary=%v %dx%d@%d,%d", when, d.Name, d.Virtual, d.Primary, m.pelsWidth, m.pelsHeight, m.positionX, m.positionY)
	}
	if len(physical)+len(virtual) == 0 {
		t.Logf("%s: no displays", when)
	}
}

// deskPicture saves a picture of the whole screen.
func deskPicture(t *testing.T, name string) {
	metric := func(i uintptr) int {
		r, _, _ := getSystemMetrics.Call(i)
		return int(int32(r))
	}
	x, y, w, h := metric(smXVirtual), metric(smYVirtual), metric(smCxVirtual), metric(smCyVirtual)
	if w <= 0 || h <= 0 {
		t.Logf("picture %s: no screen", name)
		return
	}
	img, err := captureScreen(image.Rect(x, y, x+w, y+h))
	if err != nil {
		t.Logf("picture %s: %v", name, err)
		return
	}
	f, err := os.Create(filepath.Join(".dev", "desk-"+name+".png"))
	if err != nil {
		t.Log(err)
		return
	}
	defer f.Close()
	if err := png.Encode(f, img); err != nil {
		t.Log(err)
	}
	t.Logf("picture %s: %dx%d", name, w, h)
}

// deskProbe tells what Windows says of the floating ball's window, and
// whether it takes the size it should have.
func deskProbe(t *testing.T) {
	title, _ := syscall.UTF16PtrFromString("工具箱悬浮球")
	hwnd, _, _ := user32.NewProc("FindWindowW").Call(0, uintptr(unsafe.Pointer(title)))
	if hwnd == 0 {
		t.Fatal("no floating ball")
	}
	getRect := func() [4]int32 {
		var r [4]int32
		user32.NewProc("GetWindowRect").Call(hwnd, uintptr(unsafe.Pointer(&r)))
		return r
	}
	dpi, _, _ := user32.NewProc("GetDpiForWindow").Call(hwnd)
	style, _, _ := user32.NewProc("GetWindowLongW").Call(hwnd, ^uintptr(15))
	ex, _, _ := user32.NewProc("GetWindowLongW").Call(hwnd, ^uintptr(19))
	var info [10]int32
	user32.NewProc("SendMessageW").Call(hwnd, 0x24, 0, uintptr(unsafe.Pointer(&info)))
	r := getRect()
	t.Logf("rect %v (%dx%d) dpi %d style %#x ex %#x minmax: maxsize %v maxpos %v mintrack %v maxtrack %v", r, r[2]-r[0], r[3]-r[1], dpi, uint32(style), uint32(ex), info[2:4], info[4:6], info[6:8], info[8:10])
	for i := uintptr(0); i < 80; i++ {
		if i == 28 || i == 29 || i == 34 || i == 35 || i == 30 || i == 31 || i == 32 || i == 33 {
			v, _, _ := user32.NewProc("GetSystemMetricsForDpi").Call(i, dpi)
			t.Logf("metric %d at the window's dpi: %d", i, int32(v))
		}
	}
	side := int32(52 * dpi / 96)
	ok, _, err := user32.NewProc("SetWindowPos").Call(hwnd, 0, uintptr(r[0]), uintptr(r[1]), uintptr(side), uintptr(side), 0x4|0x10)
	r = getRect()
	t.Logf("asked for %d wide: %v %v, now %dx%d", side, ok, err, r[2]-r[0], r[3]-r[1])
}

// TestRustDeskCommandLines reads the command lines of RustDesk's processes,
// the user's own: its service's are not this user's to read.
func TestRustDeskCommandLines(t *testing.T) {
	lines := processCommandLines("rustdesk.exe")
	if len(lines) == 0 {
		t.Skip("RustDesk is not running as this user")
	}
	for _, l := range lines {
		t.Log(l)
		if !strings.Contains(strings.ToLower(l), "rustdesk") {
			t.Errorf("not a command line of RustDesk: %q", l)
		}
	}
	t.Log("connected:", rustdeskConnected())
}
