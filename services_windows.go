package main

import (
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"
)

var (
	iphlpapi        = syscall.NewLazyDLL("iphlpapi.dll")
	icmpCreateFile  = iphlpapi.NewProc("IcmpCreateFile")
	icmpCloseHandle = iphlpapi.NewProc("IcmpCloseHandle")
	icmpSendEcho    = iphlpapi.NewProc("IcmpSendEcho")
)

// ping sends one echo request with Windows' ICMP helper, which, unlike a
// raw socket, needs no administrator.
func ping(host string, timeout time.Duration) error {
	ips, err := net.LookupIP(host)
	if err != nil {
		return errors.New("域名解析失败")
	}
	var ip4 net.IP
	for _, ip := range ips {
		if v := ip.To4(); v != nil {
			ip4 = v
			break
		}
	}
	if ip4 == nil {
		return errors.New("只支持 IPv4 地址")
	}
	h, _, _ := icmpCreateFile.Call()
	if h == 0 || h == ^uintptr(0) {
		return errors.New("IcmpCreateFile 失败")
	}
	defer icmpCloseHandle.Call(h)
	addr := uint32(ip4[0]) | uint32(ip4[1])<<8 | uint32(ip4[2])<<16 | uint32(ip4[3])<<24
	data := []byte("toolbox-ping")
	// A reply: ICMP_ECHO_REPLY (28 bytes on 32 bits, 32 on 64), the data,
	// and room for an ICMP error.
	reply := make([]byte, 64+len(data)+8)
	n, _, _ := icmpSendEcho.Call(h, uintptr(addr), uintptr(unsafe.Pointer(&data[0])), uintptr(len(data)), 0,
		uintptr(unsafe.Pointer(&reply[0])), uintptr(len(reply)), uintptr(timeout.Milliseconds()))
	if n == 0 {
		return errors.New("没有回应（超时）")
	}
	// ICMP_ECHO_REPLY: Address uint32, Status uint32, RoundTripTime uint32…
	status := *(*uint32)(unsafe.Pointer(&reply[4]))
	switch status {
	case 0:
		return nil
	case 11002, 11003:
		return errors.New("网络不可达")
	case 11010:
		return errors.New("没有回应（超时）")
	}
	return fmt.Errorf("Ping 失败（状态 %d）", status)
}

// tailscaleExe is the Tailscale client's command line, or "".
func tailscaleExe() string {
	for _, dir := range []string{os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)")} {
		if dir == "" {
			continue
		}
		p := filepath.Join(dir, "Tailscale", "tailscale.exe")
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}
