package main

import (
	"cmp"
	"errors"
	"os"
	"slices"

	"github.com/egoist/mygo"
)

// PortEntry is a port a process listens on or is bound to, or with all a
// TCP connection.
type PortEntry struct {
	Proto  string `json:"proto"` // TCP or UDP
	Local  string `json:"local"` // the local address: 0.0.0.0 and :: for every one
	Port   int    `json:"port"`
	Remote string `json:"remote,omitempty"` // a connection's other end, host:port
	State  string `json:"state,omitempty"`  // a TCP port's: LISTEN, ESTABLISHED…
	PID    int    `json:"pid"`
	Name   string `json:"name"`
	Path   string `json:"path,omitempty"` // empty when not ours to see, as a service's
}

// Ports lists the ports listened on and bound, by port; with all, every
// TCP connection too.
func (m *Monitor) Ports(all bool) ([]PortEntry, error) {
	list, err := listPorts(all)
	if err != nil {
		return nil, err
	}
	// :: and ::1 read as 0.0.0.0 and 127.0.0.1 do: a program listening on
	// both is said once.
	for i := range list {
		switch list[i].Local {
		case "::":
			list[i].Local = "0.0.0.0"
		case "::1":
			list[i].Local = "127.0.0.1"
		}
	}
	slices.SortFunc(list, func(a, b PortEntry) int {
		return cmp.Or(cmp.Compare(a.Port, b.Port), cmp.Compare(a.Proto, b.Proto), cmp.Compare(a.Local, b.Local), cmp.Compare(a.Remote, b.Remote))
	})
	// Rows alike in all are said once.
	return slices.CompactFunc(list, func(a, b PortEntry) bool { return a == b }), nil
}

// ShowProgram shows a program's file in Explorer.
func (m *Monitor) ShowProgram(path string) error {
	if _, err := os.Stat(path); err != nil {
		return errors.New("找不到程序文件")
	}
	mygo.Shell.ShowItemInFolder(path)
	return nil
}
