package main

import (
	"encoding/binary"
	"fmt"
	"net"
	"syscall"
	"unsafe"
)

var (
	getExtendedTCPTable = iphlpapi.NewProc("GetExtendedTcpTable")
	getExtendedUDPTable = iphlpapi.NewProc("GetExtendedUdpTable")
)

const (
	afInet6                = 23
	tcpTableOwnerPIDListen = 3
	tcpTableOwnerPIDAll    = 5
	udpTableOwnerPID       = 1
)

// tcpStates are MIB_TCP_STATE's names.
var tcpStates = map[uint32]string{
	1: "CLOSED", 2: "LISTEN", 3: "SYN_SENT", 4: "SYN_RCVD", 5: "ESTABLISHED", 6: "FIN_WAIT1",
	7: "FIN_WAIT2", 8: "CLOSE_WAIT", 9: "CLOSING", 10: "LAST_ACK", 11: "TIME_WAIT", 12: "DELETE_TCB",
}

// listPorts lists the TCP ports listened on, or every TCP connection with
// all, and the UDP ports bound, with their processes. It needs no
// administrator.
func listPorts(all bool) ([]PortEntry, error) {
	var out []PortEntry
	class := uintptr(tcpTableOwnerPIDListen)
	if all {
		class = tcpTableOwnerPIDAll
	}
	for _, af := range []uintptr{syscall.AF_INET, afInet6} {
		b, err := ipTable(getExtendedTCPTable, af, class)
		if err != nil {
			return nil, fmt.Errorf("读不到 TCP 端口：%w", err)
		}
		size, read := 24, tcpRow4
		if af == afInet6 {
			size, read = 56, tcpRow6
		}
		out = append(out, rows(b, size, read)...)
		b, err = ipTable(getExtendedUDPTable, af, udpTableOwnerPID)
		if err != nil {
			return nil, fmt.Errorf("读不到 UDP 端口：%w", err)
		}
		size, read = 12, udpRow4
		if af == afInet6 {
			size, read = 28, udpRow6
		}
		out = append(out, rows(b, size, read)...)
	}
	names := processNames()
	paths := map[int]string{}
	for i := range out {
		e := &out[i]
		switch e.PID {
		case 0:
			e.Name = "系统空闲进程"
		case 4:
			e.Name = "System"
		default:
			e.Name = names[uint32(e.PID)]
			p, ok := paths[e.PID]
			if !ok {
				p = processPath(uint32(e.PID))
				paths[e.PID] = p
			}
			e.Path = p
		}
	}
	return out, nil
}

// ipTable calls GetExtendedTcpTable or GetExtendedUdpTable until the buffer
// is large enough: the table may grow between two calls.
func ipTable(proc *syscall.LazyProc, af, class uintptr) ([]byte, error) {
	size := uint32(16 << 10)
	for range 5 {
		b := make([]byte, size)
		r, _, _ := proc.Call(uintptr(unsafe.Pointer(&b[0])), uintptr(unsafe.Pointer(&size)), 0, af, class, 0)
		switch r {
		case 0:
			return b, nil
		case 122: // ERROR_INSUFFICIENT_BUFFER
			size += 4 << 10
			continue
		default:
			return nil, syscall.Errno(r)
		}
	}
	return nil, syscall.Errno(122)
}

// rows reads a table: a count, then rows of size bytes.
func rows(b []byte, size int, read func([]byte) PortEntry) []PortEntry {
	n := int(binary.LittleEndian.Uint32(b))
	out := make([]PortEntry, 0, n)
	for i := range n {
		at := 4 + i*size
		if at+size > len(b) {
			break
		}
		out = append(out, read(b[at:at+size]))
	}
	return out
}

// netPort is a port of the tables, in network order in a DWORD.
func netPort(b []byte) int { return int(b[0])<<8 | int(b[1]) }

func tcpRow4(b []byte) PortEntry {
	le := binary.LittleEndian
	e := PortEntry{Proto: "TCP", Local: net.IP(b[4:8]).String(), Port: netPort(b[8:]), State: tcpStates[le.Uint32(b)], PID: int(le.Uint32(b[20:]))}
	if e.State != "LISTEN" {
		e.Remote = net.JoinHostPort(net.IP(b[12:16]).String(), fmt.Sprint(netPort(b[16:])))
	}
	return e
}

func tcpRow6(b []byte) PortEntry {
	le := binary.LittleEndian
	e := PortEntry{Proto: "TCP", Local: net.IP(b[0:16]).String(), Port: netPort(b[20:]), State: tcpStates[le.Uint32(b[48:])], PID: int(le.Uint32(b[52:]))}
	if e.State != "LISTEN" {
		e.Remote = net.JoinHostPort(net.IP(b[24:40]).String(), fmt.Sprint(netPort(b[44:])))
	}
	return e
}

func udpRow4(b []byte) PortEntry {
	return PortEntry{Proto: "UDP", Local: net.IP(b[0:4]).String(), Port: netPort(b[4:]), PID: int(binary.LittleEndian.Uint32(b[8:]))}
}

func udpRow6(b []byte) PortEntry {
	return PortEntry{Proto: "UDP", Local: net.IP(b[0:16]).String(), Port: netPort(b[20:]), PID: int(binary.LittleEndian.Uint32(b[24:]))}
}

// processNames maps the running processes to their programs' names.
func processNames() map[uint32]string {
	out := map[uint32]string{}
	snap, err := syscall.CreateToolhelp32Snapshot(syscall.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return out
	}
	defer syscall.CloseHandle(snap)
	var e syscall.ProcessEntry32
	e.Size = uint32(unsafe.Sizeof(e))
	for err = syscall.Process32First(snap, &e); err == nil; err = syscall.Process32Next(snap, &e) {
		out[e.ProcessID] = syscall.UTF16ToString(e.ExeFile[:])
	}
	return out
}

// processPath is a process's program file, empty when it is not ours to
// see, as a service's.
func processPath(pid uint32) string {
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
	return syscall.UTF16ToString(buf[:n])
}
