//go:build windows

package main

import (
	"flag"
	"syscall"
	"testing"
	"time"
	"unsafe"
)

// deskSave is the file to type into the app's save dialog, for testing
// what is saved through one (合并文档, 拼图) without a person there:
//
//	-test.run TestDeskSaveDialog -test.v -save D:\…\out.pdf
//
// It waits for a save dialog of the app, puts the path in its file name
// box and presses its Save button, by the dialog's own window, never by
// keys sent to whatever window is in front.
var deskSave = flag.String("save", "", "the file to save through the app's save dialog")

func TestDeskSaveDialog(t *testing.T) {
	if *deskSave == "" {
		t.Skip("fills in a save dialog: run with -save")
	}
	findWindowW := user32.NewProc("FindWindowW")
	enumChild := user32.NewProc("EnumChildWindows")
	getClassName := user32.NewProc("GetClassNameW")
	getParent := user32.NewProc("GetParent")
	getDlgItem := user32.NewProc("GetDlgItem")
	sendMessage := user32.NewProc("SendMessageW")
	isWindow := user32.NewProc("IsWindow")
	class := func(h uintptr) string {
		var b [64]uint16
		getClassName.Call(h, uintptr(unsafe.Pointer(&b[0])), 64)
		return syscall.UTF16ToString(b[:])
	}
	dialog := uintptr(0)
	for deadline := time.Now().Add(20 * time.Second); dialog == 0 && time.Now().Before(deadline); time.Sleep(200 * time.Millisecond) {
		for _, title := range []string{"导出文档", "保存图片"} {
			p, _ := syscall.UTF16PtrFromString(title)
			cls, _ := syscall.UTF16PtrFromString("#32770")
			if h, _, _ := findWindowW.Call(uintptr(unsafe.Pointer(cls)), uintptr(unsafe.Pointer(p))); h != 0 {
				dialog = h
			}
		}
	}
	if dialog == 0 {
		t.Fatal("no save dialog")
	}
	// The file name box: the Edit in a ComboBox.
	var edit uintptr
	cb := syscall.NewCallback(func(h, _ uintptr) uintptr {
		if p, _, _ := getParent.Call(h); class(h) == "Edit" && class(p) == "ComboBox" {
			edit = h
			return 0
		}
		return 1
	})
	enumChild.Call(dialog, cb, 0)
	if edit == 0 {
		t.Fatal("no file name box")
	}
	const wmSetText, bmClick = 0x000C, 0x00F5
	path, _ := syscall.UTF16PtrFromString(*deskSave)
	sendMessage.Call(edit, wmSetText, 0, uintptr(unsafe.Pointer(path)))
	ok, _, _ := getDlgItem.Call(dialog, 1)
	if ok == 0 {
		t.Fatal("no Save button")
	}
	sendMessage.Call(ok, bmClick, 0, 0)
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); time.Sleep(100 * time.Millisecond) {
		if alive, _, _ := isWindow.Call(dialog); alive == 0 {
			t.Logf("saved as %s", *deskSave)
			return
		}
	}
	t.Fatal("the dialog stayed")
}
