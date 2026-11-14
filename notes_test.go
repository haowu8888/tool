package main

import (
	"testing"
	"time"
)

func TestNextRepeat(t *testing.T) {
	for _, c := range []struct{ due, repeat, want string }{
		{"2026-11-13T09:00", "day", "2026-11-14T09:00"},
		{"2026-11-13", "weekday", "2026-11-16"}, // a Friday
		{"2026-11-13", "week", "2026-11-20"},
		{"2026-01-31", "month", "2026-02-28"},
		{"2026-12-15T08:30", "month", "2027-01-15T08:30"},
		{"2028-02-29", "year", "2029-02-28"},
		{"2026-11-13", "", "2026-11-13"},
	} {
		if got := nextRepeat(c.due, c.repeat); got != c.want {
			t.Errorf("nextRepeat(%s, %s) = %s, want %s", c.due, c.repeat, got, c.want)
		}
	}
}

func TestRepeatMovesOn(t *testing.T) {
	now := time.Date(2026, 11, 13, 10, 0, 0, 0, time.Local)
	for _, c := range []struct{ name, got, want string }{
		{"passed time starts next", repeatAfter("2026-11-13T09:00", "day", now), "2026-11-14T09:00"},
		{"later today stays", repeatAfter("2026-11-13T11:00", "day", now), "2026-11-13T11:00"},
		{"today's date stays", repeatAfter("2026-11-13", "day", now), "2026-11-13"},
		{"once stays", repeatAfter("2026-11-01T09:00", "", now), "2026-11-01T09:00"},
		{"latest came", repeatLatest("2026-11-10T09:00", "day", now), "2026-11-13T09:00"},
		{"latest date", repeatLatest("2026-11-10", "day", now), "2026-11-13"},
		{"latest weekly", repeatLatest("2026-11-01T09:00", "week", now), "2026-11-08T09:00"},
		{"latest not yet", repeatLatest("2026-11-13T11:00", "day", now), "2026-11-13T11:00"},
	} {
		if c.got != c.want {
			t.Errorf("%s: %s, want %s", c.name, c.got, c.want)
		}
	}
}
