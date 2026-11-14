package main

import "syscall"

var (
	user32           = syscall.NewLazyDLL("user32.dll")
	getAsyncKeyState = user32.NewProc("GetAsyncKeyState")
	getSystemMetrics = user32.NewProc("GetSystemMetrics")
)

const (
	vkLButton    = 0x01
	vkRButton    = 0x02
	smSwapButton = 23
)

// mouseDown reports whether the primary mouse button is down.
func mouseDown() bool {
	vk := uintptr(vkLButton)
	if swapped, _, _ := getSystemMetrics.Call(smSwapButton); swapped != 0 {
		vk = vkRButton
	}
	r, _, _ := getAsyncKeyState.Call(vk)
	return r&0x8000 != 0
}
