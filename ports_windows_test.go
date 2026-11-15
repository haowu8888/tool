package main

import (
	"fmt"
	"net"
	"os"
	"testing"
)

func TestPorts(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	c, err := net.Dial("tcp", l.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	port := l.Addr().(*net.TCPAddr).Port
	find := func(all bool, state string) *PortEntry {
		list, err := (&Monitor{}).Ports(all)
		if err != nil {
			t.Fatal(err)
		}
		for i, e := range list {
			if e.Port == port && e.State == state && e.PID == os.Getpid() {
				return &list[i]
			}
		}
		return nil
	}
	if e := find(false, "LISTEN"); e == nil || e.Local != "127.0.0.1" || e.Name == "" || e.Path == "" {
		t.Errorf("listening port: %+v", e)
	}
	if find(false, "ESTABLISHED") != nil {
		t.Error("connections listed without all")
	}
	// The accepting end's local port is the listening one.
	if e := find(true, "ESTABLISHED"); e == nil || e.Remote == "" {
		t.Errorf("connection: %+v", e)
	}
}

func TestPortsDualStack(t *testing.T) {
	l4, err := net.Listen("tcp4", "0.0.0.0:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l4.Close()
	port := l4.Addr().(*net.TCPAddr).Port
	l6, err := net.Listen("tcp6", net.JoinHostPort("::", fmt.Sprint(port)))
	if err != nil {
		t.Skip("no IPv6:", err)
	}
	defer l6.Close()
	list, err := (&Monitor{}).Ports(false)
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, e := range list {
		if e.Port == port && e.Proto == "TCP" && e.PID == os.Getpid() {
			n++
		}
	}
	if n != 1 {
		t.Errorf("port %d listed %d times", port, n)
	}
}
