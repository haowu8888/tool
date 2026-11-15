package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

// The virtual display is Amyuni's indirect display driver usbmmidd, the one
// RustDesk installs for its privacy mode 2. Its displays show up with this
// device string, and its device takes a 4-byte command to plug a monitor in
// (0x10) or out (0x00).
const (
	virtualDeviceString = "USB Mobile Monitor Virtual Display"
	plugMonitorIoctl    = 2307084
)

var usbmmiddInterface = syscall.GUID{Data1: 0xb5ffd75f, Data2: 0xda40, Data3: 0x4353, Data4: [8]byte{0x8f, 0xf8, 0xb6, 0xda, 0xf6, 0xf1, 0xd8, 0xca}}

var (
	cfgmgr32                     = syscall.NewLazyDLL("cfgmgr32.dll")
	cmGetDeviceInterfaceListSize = cfgmgr32.NewProc("CM_Get_Device_Interface_List_SizeW")
	cmGetDeviceInterfaceList     = cfgmgr32.NewProc("CM_Get_Device_Interface_ListW")
	enumDisplayDevices           = user32.NewProc("EnumDisplayDevicesW")
	enumDisplaySettingsEx        = user32.NewProc("EnumDisplaySettingsExW")
	changeDisplaySettingsEx      = user32.NewProc("ChangeDisplaySettingsExW")
	setDisplayConfig             = user32.NewProc("SetDisplayConfig")
	getDisplayConfigBufferSizes  = user32.NewProc("GetDisplayConfigBufferSizes")
	queryDisplayConfig           = user32.NewProc("QueryDisplayConfig")
)

const (
	displayDeviceActive  = 0x1 // DISPLAY_DEVICE_ATTACHED_TO_DESKTOP
	displayDevicePrimary = 0x4
	displayDeviceMirror  = 0x8

	enumCurrentSettings = 0xffffffff

	dmPosition   = 0x20
	dmPelsWidth  = 0x80000
	dmPelsHeight = 0x100000

	cdsUpdateRegistry = 0x1
	cdsSetPrimary     = 0x10
	cdsNoReset        = 0x10000000
	cdsReset          = 0x40000000

	sdcTopologyInternal         = 0x1
	sdcTopologyExtend           = 0x4
	sdcUseSuppliedDisplayConfig = 0x20
	sdcApply                    = 0x80
	sdcSaveToDatabase           = 0x200
	sdcAllowChanges             = 0x400

	qdcOnlyActivePaths = 0x2

	// The sizes of DISPLAYCONFIG_PATH_INFO and DISPLAYCONFIG_MODE_INFO,
	// which saveDisplayConfig hands back to Windows as they are.
	pathInfoSize = 72
	modeInfoSize = 64
)

type displayDevice struct {
	cb           uint32
	deviceName   [32]uint16
	deviceString [128]uint16
	stateFlags   uint32
	deviceID     [128]uint16
	deviceKey    [128]uint16
}

// devMode is DEVMODEW with the display fields of its unions.
type devMode struct {
	deviceName       [32]uint16
	specVersion      uint16
	driverVersion    uint16
	size             uint16
	driverExtra      uint16
	fields           uint32
	positionX        int32
	positionY        int32
	orientation      uint32
	fixedOutput      uint32
	color            int16
	duplex           int16
	yResolution      int16
	ttOption         int16
	collate          int16
	formName         [32]uint16
	logPixels        uint16
	bitsPerPel       uint32
	pelsWidth        uint32
	pelsHeight       uint32
	displayFlags     uint32
	displayFrequency uint32
	icmMethod        uint32
	icmIntent        uint32
	mediaType        uint32
	ditherType       uint32
	reserved1        uint32
	reserved2        uint32
	panningWidth     uint32
	panningHeight    uint32
}

// display is a display attached to the desktop, as it was.
type display struct {
	Name    string `json:"name"`
	Primary bool   `json:"primary"`
	Virtual bool   `json:"virtual"`
	Mode    []byte `json:"mode"` // the devMode
}

// virtualSwitch is the desktop moved to the virtual display, with the
// physical displays detached, until restore.
type virtualSwitch struct {
	Added    bool      `json:"added"` // whether it plugged the virtual display in
	Displays []display `json:"displays"`
	// Size is the virtual display's resolution, which one plugged in anew
	// gets again.
	Size [2]uint32 `json:"size"`
}

// switchToVirtual moves the desktop to a virtual display and detaches the
// physical ones, as RustDesk's privacy mode 2 does: their screens get no
// signal, while screen capture, and so remote desktop tools, see the
// virtual display. It plugs a virtual display in unless one is attached.
func switchToVirtual() (*virtualSwitch, error) {
	displays, err := activeDisplays()
	if err != nil {
		return nil, err
	}
	if count(displays, false) == 0 {
		return nil, errors.New("没有在显示的物理显示器（RustDesk 的隐私模式是否已开启？）")
	}
	v := &virtualSwitch{}
	if count(displays, true) == 0 {
		before := displays
		if err := plugMonitor(true); err != nil {
			return nil, fmt.Errorf("插入虚拟显示器失败（需要 RustDesk 自带的 usbmmidd 驱动）：%w", err)
		}
		v.Added = true
		for start := time.Now(); count(displays, true) == 0; {
			if time.Since(start) > 5*time.Second {
				plugMonitor(false)
				return nil, errors.New("虚拟显示器没有出现")
			}
			time.Sleep(200 * time.Millisecond)
			if displays, err = activeDisplays(); err != nil {
				plugMonitor(false)
				return nil, err
			}
		}
		// Windows may detach the physical displays the moment the virtual
		// one is in, by the layout it remembers for them together: they
		// are kept as they were before, for restore.
		now := displays
		displays = append([]display(nil), before...)
		for _, d := range now {
			if d.Virtual {
				displays = append(displays, d)
			}
		}
	}
	v.Displays = displays
	v.Size = virtualSize(displays)
	log.Println("switch to the virtual display, now:", describeDisplays())
	// A file remembers the displays, so that the next launch brings them
	// back should the app end without restore.
	if err := v.save(); err != nil {
		v.unplug()
		return nil, err
	}
	if err := v.detach(displays, true); err != nil {
		v.restore()
		return nil, err
	}
	log.Println("switched to the virtual display:", describeDisplays())
	return v, nil
}

// virtualSize picks the virtual display's resolution: the primary physical
// display's if it has it, else 1920×1080, which RustDesk gives it too, and
// failing both the one it has, 1024×768 when just plugged in.
func virtualSize(displays []display) [2]uint32 {
	virt, want := "", [2]uint32{1920, 1080}
	for _, d := range displays {
		if d.Virtual && virt == "" {
			virt = d.Name
		}
		if !d.Virtual && d.Primary {
			m := d.mode()
			want = [2]uint32{m.pelsWidth, m.pelsHeight}
		}
	}
	for _, size := range [][2]uint32{want, {1920, 1080}} {
		if hasMode(virt, size[0], size[1]) {
			return size
		}
	}
	return [2]uint32{}
}

// detach makes the first virtual display of the displays the primary one
// at the origin, with resize at the switch's size, and detaches the
// physical ones.
func (v *virtualSwitch) detach(displays []display, resize bool) error {
	var virt *display
	for i, d := range displays {
		if d.Virtual {
			virt = &displays[i]
			break
		}
	}
	if virt == nil {
		return errors.New("虚拟显示器没有出现")
	}
	m := virt.mode()
	offX, offY := m.positionX, m.positionY
	m.positionX, m.positionY = 0, 0
	m.fields |= dmPosition
	if resize && v.Size[0] > 0 && hasMode(virt.Name, v.Size[0], v.Size[1]) {
		m.pelsWidth, m.pelsHeight = v.Size[0], v.Size[1]
		m.fields |= dmPelsWidth | dmPelsHeight
	}
	// Windows 11 24H2 wants the new primary display set first, RustDesk
	// found.
	if err := changeDisplay(virt.Name, m, cdsUpdateRegistry|cdsNoReset|cdsSetPrimary); err != nil {
		return err
	}
	for _, d := range displays {
		if d.Name == virt.Name {
			continue
		}
		m := d.mode()
		if d.Virtual {
			// Other virtual displays keep their place next to the primary.
			m.positionX -= offX
			m.positionY -= offY
		} else {
			m.positionX, m.positionY = 10000, 10000
			m.pelsWidth, m.pelsHeight = 0, 0
			m.fields |= dmPelsWidth | dmPelsHeight
		}
		m.fields |= dmPosition
		if err := changeDisplay(d.Name, m, cdsUpdateRegistry|cdsNoReset); err != nil {
			return err
		}
	}
	return changeDisplay("", nil, cdsReset)
}

// hold puts the desktop back on a virtual display with the physical ones
// detached, after something else changed the displays under the switch:
// RustDesk plugs every virtual display out when its last session ends, the
// one of this app too, and Windows then lights the physical displays.
func (v *virtualSwitch) hold() error {
	log.Println("hold the virtual display, now:", describeDisplays())
	displays, err := activeDisplays()
	if err != nil {
		return err
	}
	fresh := false
	if count(displays, true) == 0 {
		if err := plugMonitor(true); err != nil {
			return fmt.Errorf("插入虚拟显示器失败：%w", err)
		}
		v.Added, fresh = true, true
		for start := time.Now(); count(displays, true) == 0; {
			if time.Since(start) > 5*time.Second {
				return errors.New("虚拟显示器没有出现")
			}
			time.Sleep(200 * time.Millisecond)
			if displays, err = activeDisplays(); err != nil {
				return err
			}
		}
	}
	// A physical display the switch has not seen, as a monitor plugged in
	// meanwhile, comes back with the others.
	for _, d := range displays {
		if !d.Virtual && !v.knows(d.Name) {
			d.Primary = false
			v.Displays = append(v.Displays, d)
		}
	}
	if err := v.save(); err != nil {
		log.Println("save the displays:", err)
	}
	if err := v.detach(displays, fresh); err != nil {
		return err
	}
	log.Println("held the virtual display:", describeDisplays())
	return nil
}

func (v *virtualSwitch) knows(name string) bool {
	for _, d := range v.Displays {
		if d.Name == name {
			return true
		}
	}
	return false
}

// restore brings the displays back as they were and unplugs the virtual
// display it plugged in.
func (v *virtualSwitch) restore() {
	log.Println("restore displays, now:", describeDisplays())
	defer func() { log.Println("restored displays:", describeDisplays()) }()
	for _, d := range v.Displays {
		flags := uint32(cdsUpdateRegistry | cdsNoReset)
		if d.Primary {
			flags |= cdsSetPrimary
		}
		changeDisplay(d.Name, d.mode(), flags)
	}
	if err := changeDisplay("", nil, 0); err != nil {
		log.Println("restore displays:", err)
	}
	// Windows keeps a layout for every set of monitors, and the switch made
	// "physical displays detached" the layout of the physical displays
	// with the virtual one. Attaching them again does not always replace
	// it, and then the next virtual display plugged in, as RustDesk's
	// privacy mode plugs in, detaches them at once: RustDesk then finds
	// no physical display and fails with "This only virtual display cannot
	// be plugged out", leaving the screen dark. So, while the virtual
	// display is still in, the physical displays are attached for sure and
	// that layout is saved.
	// With the virtual display gone already, as after RustDesk plugged it
	// out, one is plugged in for that.
	if displays, err := activeDisplays(); err == nil && count(displays, true) == 0 && plugMonitor(true) == nil {
		v.Added = true
		for start := time.Now(); time.Since(start) < 3*time.Second; time.Sleep(200 * time.Millisecond) {
			if displays, err := activeDisplays(); err == nil && count(displays, true) > 0 {
				break
			}
		}
	}
	if lightPhysical(2 * time.Second) {
		if err := saveDisplayConfig(); err != nil {
			log.Println("save display layout:", err)
		}
	}
	v.unplug()
	if !lightPhysical(3 * time.Second) {
		log.Println("restore displays: no physical display came back")
	}
	if p, err := switchFile(); err == nil {
		os.Remove(p)
	}
}

// lightPhysical waits for a physical display to show and, when none does,
// brings them back: the desktop extended over all the displays, as Win+P
// does, failing that the laptop's own screen only, and at last every
// output with a monitor attached by its own settings. It reports whether a
// physical display shows.
func lightPhysical(wait time.Duration) bool {
	if waitPhysical(wait) {
		return true
	}
	for _, topology := range []uintptr{sdcTopologyExtend, sdcTopologyInternal} {
		r, _, _ := setDisplayConfig.Call(0, 0, 0, 0, sdcApply|topology)
		log.Printf("no physical display shows: SetDisplayConfig(%#x) = %d", topology, int32(r))
		if waitPhysical(3 * time.Second) {
			return true
		}
	}
	attachPhysical()
	return waitPhysical(3 * time.Second)
}

// attachPhysical attaches the outputs with a physical monitor on them to
// the desktop, at the monitor's largest resolution, the first of them as
// the primary display at the origin and the others to its right. Windows
// lists a laptop's screen under several outputs: the first that takes it.
func attachPhysical() {
	x := int32(0)
	attached := map[string]bool{} // by the monitor's device ID
	for i := uint32(0); ; i++ {
		dd := displayDevice{cb: uint32(unsafe.Sizeof(displayDevice{}))}
		if r, _, _ := enumDisplayDevices.Call(0, uintptr(i), uintptr(unsafe.Pointer(&dd)), 0); r == 0 {
			break
		}
		if dd.stateFlags&displayDeviceMirror != 0 || strings.HasPrefix(syscall.UTF16ToString(dd.deviceString[:]), virtualDeviceString) {
			continue
		}
		md := displayDevice{cb: uint32(unsafe.Sizeof(displayDevice{}))}
		if r, _, _ := enumDisplayDevices.Call(uintptr(unsafe.Pointer(&dd.deviceName[0])), 0, uintptr(unsafe.Pointer(&md)), 0); r == 0 {
			continue // no monitor on this output
		}
		id := syscall.UTF16ToString(md.deviceID[:])
		if attached[id] {
			continue
		}
		name := syscall.UTF16ToString(dd.deviceName[:])
		var best devMode
		for j := uint32(0); ; j++ {
			m := devMode{size: uint16(unsafe.Sizeof(devMode{}))}
			if r, _, _ := enumDisplaySettingsEx.Call(uintptr(unsafe.Pointer(&dd.deviceName[0])), uintptr(j), uintptr(unsafe.Pointer(&m)), 0); r == 0 {
				break
			}
			if a, b := uint64(m.pelsWidth)*uint64(m.pelsHeight), uint64(best.pelsWidth)*uint64(best.pelsHeight); a > b || a == b && m.displayFrequency > best.displayFrequency {
				best = m
			}
		}
		if best.pelsWidth == 0 {
			continue
		}
		best.positionX, best.positionY = x, 0
		best.fields |= dmPosition | dmPelsWidth | dmPelsHeight
		flags := uint32(cdsUpdateRegistry | cdsNoReset)
		if x == 0 {
			flags |= cdsSetPrimary
		}
		err := changeDisplay(name, &best, flags)
		log.Printf("attach %s at %dx%d: %v", name, best.pelsWidth, best.pelsHeight, err)
		if err == nil {
			attached[id] = true
			x += int32(best.pelsWidth)
		}
	}
	if x == 0 {
		return
	}
	if err := changeDisplay("", nil, 0); err != nil {
		log.Println("attach the physical displays:", err)
	}
}

// rescueDisplays brings the physical displays back when none shows though
// this app did not detach them: a virtual display left over, by RustDesk
// or by a layout Windows remembered, has the whole desktop and the screen
// is dark, or no display is left at all, as after RustDesk plugged the
// virtual display out while the physical ones were detached. It attaches
// the physical displays, saves that layout and unplugs the virtual
// displays. It reports false when a physical display shows, so there is
// nothing to rescue.
func rescueDisplays() (bool, error) {
	displays, err := activeDisplays()
	if err != nil || count(displays, false) > 0 {
		return false, err
	}
	log.Println("no physical display shows: bringing them back, now:", describeDisplays())
	defer func() { log.Println("rescued displays:", describeDisplays()) }()
	if !lightPhysical(0) {
		return true, errors.New("没能点亮物理显示器")
	}
	if err := saveDisplayConfig(); err != nil {
		log.Println("save display layout:", err)
	}
	if displays, err := activeDisplays(); err == nil {
		for n := count(displays, true); n > 0; n-- {
			if err := plugMonitor(false); err != nil {
				log.Println("unplug virtual display:", err)
				break
			}
		}
	}
	if !lightPhysical(3 * time.Second) {
		return true, errors.New("拔掉虚拟显示器后物理显示器没有亮")
	}
	return true, nil
}

// heldByRustDesk reports whether no physical display shows while a virtual
// one has the desktop and someone is connected through RustDesk: its
// privacy mode, mostly, which is not this app's to end.
func heldByRustDesk() bool {
	displays, err := activeDisplays()
	return err == nil && count(displays, false) == 0 && count(displays, true) > 0 && rustdeskConnected()
}

var (
	ntdll                     = syscall.NewLazyDLL("ntdll.dll")
	ntQueryInformationProcess = ntdll.NewProc("NtQueryInformationProcess")
)

const (
	processQueryLimited    = 0x1000
	processCommandLineInfo = 60
)

// rustdeskConnected reports whether someone controls this computer through
// RustDesk: its connection manager, rustdesk.exe --cm, runs as the user
// for as long as a session is connected.
func rustdeskConnected() bool {
	for _, cmd := range processCommandLines("rustdesk.exe") {
		if strings.Contains(cmd, "--cm") {
			return true
		}
	}
	return false
}

// processCommandLines returns the command lines of the processes of a
// program, those it may read: the user's own.
func processCommandLines(exe string) []string {
	snap, err := syscall.CreateToolhelp32Snapshot(syscall.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil
	}
	defer syscall.CloseHandle(snap)
	var lines []string
	e := syscall.ProcessEntry32{Size: uint32(unsafe.Sizeof(syscall.ProcessEntry32{}))}
	for err := syscall.Process32First(snap, &e); err == nil; err = syscall.Process32Next(snap, &e) {
		if !strings.EqualFold(syscall.UTF16ToString(e.ExeFile[:]), exe) {
			continue
		}
		if cmd, ok := processCommandLine(e.ProcessID); ok {
			lines = append(lines, cmd)
		}
	}
	return lines
}

func processCommandLine(pid uint32) (string, bool) {
	h, err := syscall.OpenProcess(processQueryLimited, false, pid)
	if err != nil {
		return "", false
	}
	defer syscall.CloseHandle(h)
	// A UNICODE_STRING, and the text it points to after it.
	buf := make([]byte, 8192)
	for range 4 {
		var n uint32
		r, _, _ := ntQueryInformationProcess.Call(uintptr(h), processCommandLineInfo, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)), uintptr(unsafe.Pointer(&n)))
		if r == 0 {
			us := (*struct {
				length, max uint16
				text        *uint16
			})(unsafe.Pointer(&buf[0]))
			if us.text == nil {
				return "", true
			}
			return syscall.UTF16ToString(unsafe.Slice(us.text, us.length/2)), true
		}
		if int(n) <= len(buf) {
			break
		}
		buf = make([]byte, n)
	}
	return "", false
}

// waitPhysical waits up to timeout for a physical display to show and
// reports whether one does.
func waitPhysical(timeout time.Duration) bool {
	for start := time.Now(); ; time.Sleep(200 * time.Millisecond) {
		if displays, err := activeDisplays(); err == nil && count(displays, false) > 0 {
			return true
		}
		if time.Since(start) >= timeout {
			return false
		}
	}
}

// saveDisplayConfig makes the current layout the one Windows remembers for
// the monitors connected now.
func saveDisplayConfig() error {
	for {
		var nPaths, nModes uint32
		if r, _, _ := getDisplayConfigBufferSizes.Call(qdcOnlyActivePaths, uintptr(unsafe.Pointer(&nPaths)), uintptr(unsafe.Pointer(&nModes))); r != 0 {
			return fmt.Errorf("GetDisplayConfigBufferSizes: %d", r)
		}
		if nPaths == 0 {
			return errors.New("no active display paths")
		}
		paths := make([]byte, nPaths*pathInfoSize)
		modes := make([]byte, max(nModes, 1)*modeInfoSize)
		r, _, _ := queryDisplayConfig.Call(qdcOnlyActivePaths, uintptr(unsafe.Pointer(&nPaths)), uintptr(unsafe.Pointer(&paths[0])), uintptr(unsafe.Pointer(&nModes)), uintptr(unsafe.Pointer(&modes[0])), 0)
		if r == 122 { // ERROR_INSUFFICIENT_BUFFER: the displays changed meanwhile
			continue
		}
		if r != 0 {
			return fmt.Errorf("QueryDisplayConfig: %d", r)
		}
		r, _, _ = setDisplayConfig.Call(uintptr(nPaths), uintptr(unsafe.Pointer(&paths[0])), uintptr(nModes), uintptr(unsafe.Pointer(&modes[0])), sdcApply|sdcUseSuppliedDisplayConfig|sdcSaveToDatabase|sdcAllowChanges)
		if r != 0 {
			return fmt.Errorf("SetDisplayConfig: %d", r)
		}
		return nil
	}
}

// broken reports whether the displays changed under it: the virtual display
// is gone or a physical one is attached again. While they are as it left
// them, it keeps the virtual display's resolution, which the remote side
// may have changed, for the one hold plugs in.
func (v *virtualSwitch) broken() bool {
	displays, err := activeDisplays()
	if err != nil {
		return false
	}
	if count(displays, true) == 0 || count(displays, false) > 0 {
		return true
	}
	for _, d := range displays {
		if d.Primary {
			m := d.mode()
			v.Size = [2]uint32{m.pelsWidth, m.pelsHeight}
		}
	}
	return false
}

func (v *virtualSwitch) unplug() {
	if v.Added {
		if err := plugMonitor(false); err != nil {
			log.Println("unplug virtual display:", err)
		}
		v.Added = false
	}
}

func (v *virtualSwitch) save() error {
	p, err := switchFile()
	if err != nil {
		return err
	}
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	return os.WriteFile(p, b, 0o644)
}

// restoreDisplaysLeftOver brings back the displays that a switch to the
// virtual display left detached when the app ended without restoring them.
func restoreDisplaysLeftOver() {
	p, err := switchFile()
	if err != nil {
		return
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return
	}
	var v virtualSwitch
	if err := json.Unmarshal(b, &v); err != nil {
		os.Remove(p)
		return
	}
	log.Println("restoring the displays a virtual display switch left")
	v.restore()
}

func switchFile() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "Toolbox", "virtual-display.json"), nil
}

func (d *display) mode() *devMode {
	m := new(devMode)
	copy(unsafe.Slice((*byte)(unsafe.Pointer(m)), unsafe.Sizeof(*m)), d.Mode)
	return m
}

func count(displays []display, virtual bool) int {
	n := 0
	for _, d := range displays {
		if d.Virtual == virtual {
			n++
		}
	}
	return n
}

// activeDisplays lists the displays attached to the desktop.
func activeDisplays() ([]display, error) {
	var displays []display
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
			continue
		}
		if m.pelsWidth == 0 || m.pelsHeight == 0 {
			continue
		}
		displays = append(displays, display{
			Name:    syscall.UTF16ToString(dd.deviceName[:]),
			Primary: dd.stateFlags&displayDevicePrimary != 0,
			Virtual: strings.HasPrefix(syscall.UTF16ToString(dd.deviceString[:]), virtualDeviceString),
			Mode:    append([]byte(nil), unsafe.Slice((*byte)(unsafe.Pointer(&m)), unsafe.Sizeof(m))...),
		})
	}
	return displays, nil
}

// describeDisplays tells, for the log, every display attached to the
// desktop with its mode, the detached 0×0 ones too.
func describeDisplays() string {
	var b strings.Builder
	for i := uint32(0); ; i++ {
		dd := displayDevice{cb: uint32(unsafe.Sizeof(displayDevice{}))}
		if r, _, _ := enumDisplayDevices.Call(0, uintptr(i), uintptr(unsafe.Pointer(&dd)), 0); r == 0 {
			break
		}
		if dd.stateFlags&displayDeviceActive == 0 || dd.stateFlags&displayDeviceMirror != 0 {
			continue
		}
		m := devMode{size: uint16(unsafe.Sizeof(devMode{}))}
		enumDisplaySettingsEx.Call(uintptr(unsafe.Pointer(&dd.deviceName[0])), enumCurrentSettings, uintptr(unsafe.Pointer(&m)), 0)
		kind := "physical"
		if strings.HasPrefix(syscall.UTF16ToString(dd.deviceString[:]), virtualDeviceString) {
			kind = "virtual"
		}
		if dd.stateFlags&displayDevicePrimary != 0 {
			kind += " primary"
		}
		fmt.Fprintf(&b, "[%s %s %dx%d@%d,%d] ", strings.TrimPrefix(syscall.UTF16ToString(dd.deviceName[:]), `\\.\`), kind, m.pelsWidth, m.pelsHeight, m.positionX, m.positionY)
	}
	if b.Len() == 0 {
		return "none"
	}
	return strings.TrimSpace(b.String())
}

// listDisplays lists the monitors of every output, attached to the desktop
// or not, once each: Windows may list a laptop's screen under several
// outputs of its adapter, and the one that shows counts.
func listDisplays() []DisplayInfo {
	var list []DisplayInfo
	seen := map[string]int{} // a monitor's device ID → its index in list
	for i := uint32(0); ; i++ {
		ad := displayDevice{cb: uint32(unsafe.Sizeof(displayDevice{}))}
		if r, _, _ := enumDisplayDevices.Call(0, uintptr(i), uintptr(unsafe.Pointer(&ad)), 0); r == 0 {
			break
		}
		if ad.stateFlags&displayDeviceMirror != 0 {
			continue
		}
		d := DisplayInfo{
			Name:    syscall.UTF16ToString(ad.deviceName[:]),
			Adapter: syscall.UTF16ToString(ad.deviceString[:]),
			Active:  ad.stateFlags&displayDeviceActive != 0,
			Primary: ad.stateFlags&displayDevicePrimary != 0,
		}
		d.Virtual = strings.HasPrefix(d.Adapter, virtualDeviceString)
		md := displayDevice{cb: uint32(unsafe.Sizeof(displayDevice{}))}
		hasMonitor := false
		if r, _, _ := enumDisplayDevices.Call(uintptr(unsafe.Pointer(&ad.deviceName[0])), 0, uintptr(unsafe.Pointer(&md)), 0); r != 0 {
			hasMonitor = true
			d.Monitor = syscall.UTF16ToString(md.deviceString[:])
		}
		if d.Active {
			m := devMode{size: uint16(unsafe.Sizeof(devMode{}))}
			if r, _, _ := enumDisplaySettingsEx.Call(uintptr(unsafe.Pointer(&ad.deviceName[0])), enumCurrentSettings, uintptr(unsafe.Pointer(&m)), 0); r != 0 {
				d.Width, d.Height = int32(m.pelsWidth), int32(m.pelsHeight)
			}
			// Detached the way this app and RustDesk do it: 0×0.
			d.Active = d.Width > 0 && d.Height > 0
		}
		if !hasMonitor && !d.Active {
			continue // an unused output
		}
		id := syscall.UTF16ToString(md.deviceID[:])
		if j, ok := seen[id]; ok && id != "" {
			if d.Active && !list[j].Active {
				list[j] = d
			}
			continue
		}
		seen[id] = len(list)
		list = append(list, d)
	}
	return list
}

// hasMode reports whether the display supports a resolution.
func hasMode(name string, width, height uint32) bool {
	dev, _ := syscall.UTF16PtrFromString(name)
	for i := uint32(0); ; i++ {
		m := devMode{size: uint16(unsafe.Sizeof(devMode{}))}
		if r, _, _ := enumDisplaySettingsEx.Call(uintptr(unsafe.Pointer(dev)), uintptr(i), uintptr(unsafe.Pointer(&m)), 0); r == 0 {
			return false
		}
		if m.pelsWidth == width && m.pelsHeight == height {
			return true
		}
	}
}

// changeDisplay calls ChangeDisplaySettingsExW; an empty name and nil mode
// apply the changes saved with cdsNoReset.
func changeDisplay(name string, m *devMode, flags uint32) error {
	var dev *uint16
	if name != "" {
		dev, _ = syscall.UTF16PtrFromString(name)
	}
	r, _, err := changeDisplaySettingsEx.Call(uintptr(unsafe.Pointer(dev)), uintptr(unsafe.Pointer(m)), 0, uintptr(flags), 0)
	if rc := int32(r); rc != 0 { // DISP_CHANGE_SUCCESSFUL
		return fmt.Errorf("ChangeDisplaySettingsEx %s: %d (%v)", name, rc, err)
	}
	return nil
}

// plugMonitor plugs a virtual monitor into the usbmmidd device, or out.
func plugMonitor(in bool) error {
	path, err := usbmmiddPath()
	if err != nil {
		return err
	}
	h, err := syscall.CreateFile(path, syscall.GENERIC_READ|syscall.GENERIC_WRITE, 0, nil, syscall.OPEN_EXISTING, 0, 0)
	if err != nil {
		return fmt.Errorf("打开虚拟显示器设备：%w", err)
	}
	defer syscall.CloseHandle(h)
	cmd := [4]byte{}
	if in {
		cmd[0] = 0x10
	}
	var n uint32
	return syscall.DeviceIoControl(h, plugMonitorIoctl, &cmd[0], uint32(len(cmd)), nil, 0, &n, nil)
}

// usbmmiddPath returns the path of the usbmmidd device's interface.
func usbmmiddPath() (*uint16, error) {
	var size uint32
	if r, _, _ := cmGetDeviceInterfaceListSize.Call(uintptr(unsafe.Pointer(&size)), uintptr(unsafe.Pointer(&usbmmiddInterface)), 0, 0); r != 0 {
		return nil, fmt.Errorf("CM_Get_Device_Interface_List_Size: %d", r)
	}
	buf := make([]uint16, size)
	if r, _, _ := cmGetDeviceInterfaceList.Call(uintptr(unsafe.Pointer(&usbmmiddInterface)), 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(size), 0); r != 0 {
		return nil, fmt.Errorf("CM_Get_Device_Interface_List: %d", r)
	}
	if buf[0] == 0 {
		return nil, errors.New("没有安装虚拟显示器驱动")
	}
	return &buf[0], nil
}
