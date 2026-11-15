package main

import (
	"testing"
	"time"
)

func TestSomeoneHere(t *testing.T) {
	if rustdeskConnected() {
		t.Skip("someone is connected through RustDesk")
	}
	v := NewVirtualScreen()
	idle := time.Duration(0)
	v.idle = func() time.Duration { return idle }
	if v.someoneHere() {
		t.Error("someone here while the screen is not locked")
	}
	// Locked 10 seconds ago by RustDesk, right after the remote side's
	// last key.
	v.locked.Store(time.Now().Add(-10 * time.Second).UnixNano())
	idle = 10 * time.Second
	if v.someoneHere() {
		t.Error("the key before the lock counts as someone here")
	}
	idle = 8 * time.Second // within the grace after the lock
	if v.someoneHere() {
		t.Error("a key right after the lock counts as someone here")
	}
	idle = time.Second
	if !v.someoneHere() {
		t.Error("a key at the lock screen does not count as someone here")
	}
	v.setLocked(false)
	if v.someoneHere() {
		t.Error("someone here after the screen unlocked")
	}
}
