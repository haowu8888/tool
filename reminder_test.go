package main

import (
	"testing"

	"github.com/egoist/mygo"
)

func TestClearOf(t *testing.T) {
	wa := mygo.Rectangle{X: 0, Y: 0, Width: 1920, Height: 1080}
	chat := mygo.Rectangle{X: 1400, Y: 500, Width: 380, Height: 520}
	cases := []struct {
		name       string
		x, y, h    int
		chat       mygo.Rectangle
		wantX, wan int
	}{
		{"apart stays", 900, 100, 160, chat, 900, 100},
		{"over goes above", 1420, 600, 160, chat, 1420, 500 - 8 - 160},
		{"no room above goes below", 1420, 100, 160, mygo.Rectangle{X: 1400, Y: 100, Width: 380, Height: 520}, 1420, 628},
		{"tall chat: past it, away from the right edge", 1420, 300, 300, mygo.Rectangle{X: 1400, Y: 100, Width: 380, Height: 900}, 1400 - 8 - bubbleWidth, 300},
		{"tall chat on the left: past it to the right", 100, 300, 300, mygo.Rectangle{X: 80, Y: 100, Width: 380, Height: 900}, 80 + 380 + 8, 300},
	}
	for _, c := range cases {
		x, y := clearOf(c.x, c.y, bubbleWidth, c.h, c.chat, wa)
		if x != c.wantX || y != c.wan {
			t.Errorf("%s: got %d,%d, want %d,%d", c.name, x, y, c.wantX, c.wan)
		}
	}
}
