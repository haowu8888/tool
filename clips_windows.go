package main

import (
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

var (
	getClipboardSequenceNumber  = user32.NewProc("GetClipboardSequenceNumber")
	isClipboardFormatAvailable  = user32.NewProc("IsClipboardFormatAvailable")
	registerClipboardFormat     = user32.NewProc("RegisterClipboardFormatW")
	getForegroundWindow         = user32.NewProc("GetForegroundWindow")
	getClipboardOwner           = user32.NewProc("GetClipboardOwner")
	setForegroundWindow         = user32.NewProc("SetForegroundWindow")
	getWindowThreadProcessID    = user32.NewProc("GetWindowThreadProcessId")
	attachThreadInput           = user32.NewProc("AttachThreadInput")
	getCurrentThreadID          = kernel32.NewProc("GetCurrentThreadId")
	queryFullProcessImageName   = kernel32.NewProc("QueryFullProcessImageNameW")
	clipboardPrivateFormatNames = []string{
		// Password managers mark what they copy so that history tools
		// leave it out.
		"ExcludeClipboardContentFromMonitorProcessing",
		"Clipboard Viewer Ignore",
		"CanIncludeInClipboardHistory",
	}
)

// clipboardSeq changes whenever the clipboard does.
func clipboardSeq() uint32 {
	r, _, _ := getClipboardSequenceNumber.Call()
	return uint32(r)
}

// clipboardPrivate is whether what was copied asks not to be kept.
func clipboardPrivate() bool {
	for _, name := range clipboardPrivateFormatNames {
		p, _ := syscall.UTF16PtrFromString(name)
		id, _, _ := registerClipboardFormat.Call(uintptr(unsafe.Pointer(p)))
		if id == 0 {
			continue
		}
		if r, _, _ := isClipboardFormatAvailable.Call(id); r != 0 {
			return true
		}
	}
	return false
}

func foregroundWindow() uintptr {
	h, _, _ := getForegroundWindow.Call()
	return h
}

// clipboardApp is the name of the program that put what is on the
// clipboard there, as chrome: the clipboard's owner, or for programs that
// name none, the one whose window has the keys.
func clipboardApp() string {
	if h, _, _ := getClipboardOwner.Call(); h != 0 {
		if name := windowApp(h); name != "" {
			return name
		}
	}
	return windowApp(foregroundWindow())
}

// windowApp is the name of a window's program.
func windowApp(h uintptr) string {
	if h == 0 {
		return ""
	}
	var pid uint32
	getWindowThreadProcessID.Call(h, uintptr(unsafe.Pointer(&pid)))
	proc, err := syscall.OpenProcess(0x1000, false, pid) // PROCESS_QUERY_LIMITED_INFORMATION
	if err != nil {
		return ""
	}
	defer syscall.CloseHandle(proc)
	buf := make([]uint16, 520)
	n := uint32(len(buf))
	if r, _, _ := queryFullProcessImageName.Call(uintptr(proc), 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&n))); r == 0 {
		return ""
	}
	name := filepath.Base(syscall.UTF16ToString(buf[:n]))
	return strings.TrimSuffix(name, filepath.Ext(name))
}

// forceFocus brings one of the app's windows to the front when Windows
// would not let it come by itself: joined to the input of the window in
// front, it may take the keys from it.
func forceFocus(h uintptr) {
	fg := foregroundWindow()
	if h == 0 || fg == h {
		return
	}
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	cur, _, _ := getCurrentThreadID.Call()
	other, _, _ := getWindowThreadProcessID.Call(fg, 0)
	if other != 0 && other != cur {
		attachThreadInput.Call(cur, other, 1)
		defer attachThreadInput.Call(cur, other, 0)
	}
	setForegroundWindow.Call(h)
}

// waitModifiersUp waits until Alt, Shift and the Windows keys are let go,
// or for so long: keys pressed for the user would combine with them.
func waitModifiersUp(limit time.Duration) {
	end := time.Now().Add(limit)
	for time.Now().Before(end) {
		held := false
		for _, vk := range []uintptr{0x12, 0x10, 0x5B, 0x5C} { // VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN
			if r, _, _ := getAsyncKeyState.Call(vk); r&0x8000 != 0 {
				held = true
			}
		}
		if !held {
			return
		}
		time.Sleep(15 * time.Millisecond)
	}
}

// focusWindow gives a window the keys back.
func focusWindow(h uintptr) {
	if h != 0 {
		setForegroundWindow.Call(h)
	}
}

// pressPaste presses Ctrl+V.
func pressPaste() {
	type keyInput struct {
		typ      uint32
		_        uint32
		vk, scan uint16
		flags    uint32
		time     uint32
		_        uint32
		extra    uintptr
		_        [8]byte // INPUT is as large as its largest member, MOUSEINPUT
	}
	const vkControl, vkV, keyUp = 0x11, 0x56, 0x0002
	in := []keyInput{
		{typ: 1, vk: vkControl},
		{typ: 1, vk: vkV},
		{typ: 1, vk: vkV, flags: keyUp},
		{typ: 1, vk: vkControl, flags: keyUp},
	}
	sendInput.Call(uintptr(len(in)), uintptr(unsafe.Pointer(&in[0])), unsafe.Sizeof(in[0]))
}
