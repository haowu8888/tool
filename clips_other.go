//go:build !windows

package main

import "time"

func clipboardSeq() uint32 { return 0 }

func clipboardPrivate() bool { return false }

func foregroundWindow() uintptr { return 0 }

func clipboardApp() string { return "" }

func focusWindow(uintptr) {}

func forceFocus(uintptr) {}

func waitModifiersUp(time.Duration) {}

func pressPaste() {}
