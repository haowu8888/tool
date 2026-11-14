package main

import (
	"encoding/binary"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

var (
	pdh                          = syscall.NewLazyDLL("pdh.dll")
	pdhOpenQuery                 = pdh.NewProc("PdhOpenQueryW")
	pdhAddEnglishCounter         = pdh.NewProc("PdhAddEnglishCounterW")
	pdhCollectQueryData          = pdh.NewProc("PdhCollectQueryData")
	pdhGetFormattedCounterValue  = pdh.NewProc("PdhGetFormattedCounterValue")
	pdhGetFormattedCounterArray  = pdh.NewProc("PdhGetFormattedCounterArrayW")
	pdhCloseQuery                = pdh.NewProc("PdhCloseQuery")
	globalMemoryStatusEx         = kernel32.NewProc("GlobalMemoryStatusEx")
	getDiskFreeSpaceEx           = kernel32.NewProc("GetDiskFreeSpaceExW")
	getLogicalDrives             = kernel32.NewProc("GetLogicalDrives")
	getDriveType                 = kernel32.NewProc("GetDriveTypeW")
	getTickCount64               = kernel32.NewProc("GetTickCount64")
	getSystemPowerStatus         = kernel32.NewProc("GetSystemPowerStatus")
	k32GetProcessMemoryInfo      = kernel32.NewProc("K32GetProcessMemoryInfo")
	setupapi                     = syscall.NewLazyDLL("setupapi.dll")
	setupDiGetClassDevs          = setupapi.NewProc("SetupDiGetClassDevsW")
	setupDiEnumDeviceInterfaces  = setupapi.NewProc("SetupDiEnumDeviceInterfaces")
	setupDiGetDeviceInterfaceDtl = setupapi.NewProc("SetupDiGetDeviceInterfaceDetailW")
	setupDiDestroyDeviceInfoList = setupapi.NewProc("SetupDiDestroyDeviceInfoList")
)

const (
	pdhFmtDouble   = 0x200
	pdhFmtNoCap100 = 0x8000
	pdhMoreData    = 0x800007D2
)

var virtualAdapter = regexp.MustCompile(`(?i)virtual|tunnel|tailscale|vmware|vethernet|hyper-v|loopback|isatap|teredo|wintun|tap-|vpn|wsl|bluetooth|meta|clash|zerotier|wireguard`)

func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
}

// sampler reads the system: performance counters through PDH, which
// need no administrator, and a few Win32 calls.
type sampler struct {
	query    uintptr
	counters map[string]uintptr

	disks     []nvmeDisk
	temps     []SensorReading
	tempsAt   time.Time
	battery   *batteryReader
	processes processTimes
	procs     []ProcessSample
}

var counterPaths = map[string]string{
	"usage": `\Processor Information(_Total)\% Processor Utility`,
	"perf":  `\Processor Information(_Total)\% Processor Performance`,
	"base":  `\Processor Information(_Total)\Processor Frequency`,
	"cores": `\Processor Information(*)\% Processor Utility`,
	"gpu":   `\GPU Engine(*)\Utilization Percentage`,
	"gpuSh": `\GPU Adapter Memory(*)\Shared Usage`,
	"gpuDd": `\GPU Adapter Memory(*)\Dedicated Usage`,
	"down":  `\Network Interface(*)\Bytes Received/sec`,
	"up":    `\Network Interface(*)\Bytes Sent/sec`,
	"read":  `\PhysicalDisk(_Total)\Disk Read Bytes/sec`,
	"write": `\PhysicalDisk(_Total)\Disk Write Bytes/sec`,
}

func newSampler() *sampler {
	s := &sampler{counters: map[string]uintptr{}}
	if r, _, _ := pdhOpenQuery.Call(0, 0, uintptr(unsafe.Pointer(&s.query))); r == 0 {
		for name, path := range counterPaths {
			p, _ := syscall.UTF16PtrFromString(path)
			var c uintptr
			if r, _, _ := pdhAddEnglishCounter.Call(s.query, uintptr(unsafe.Pointer(p)), 0, uintptr(unsafe.Pointer(&c))); r == 0 {
				s.counters[name] = c
			}
		}
		// Rates need two collections: the first sample has none.
		pdhCollectQueryData.Call(s.query)
	}
	s.disks = nvmeDisks()
	s.battery = openBattery()
	s.processes = processTimes{}
	return s
}

func (s *sampler) close() {
	if s.query != 0 {
		pdhCloseQuery.Call(s.query)
	}
	s.battery.close()
}

func (s *sampler) sample(tick int) MonitorSample {
	out := MonitorSample{Time: time.Now().UnixMilli(), Disks: []DiskSample{}, Temps: []SensorReading{}, Fans: []SensorReading{}}
	if s.query != 0 {
		pdhCollectQueryData.Call(s.query)
	}
	out.CPU.Usage = min(s.value("usage"), 100)
	if base := s.value("base"); base > 0 {
		out.CPU.Freq = base * s.value("perf") / 100 / 1000
	}
	out.CPU.Cores = sortedCores(s.values("cores"))
	// Task Manager's GPU usage: the busiest kind of engine, its engines'
	// usage added up.
	byType := map[string]float64{}
	for name, v := range s.values("gpu") {
		if i := strings.LastIndex(name, "engtype_"); i >= 0 {
			byType[name[i+8:]] += v
		}
	}
	for _, v := range byType {
		out.GPU.Usage = max(out.GPU.Usage, min(v, 100))
	}
	for _, v := range s.values("gpuSh") {
		out.GPU.Memory += uint64(v)
	}
	for _, v := range s.values("gpuDd") {
		out.GPU.Memory += uint64(v)
	}
	// Real adapters only: a VPN's or proxy's tunnel carries what the Wi-Fi
	// carries too.
	for name, v := range s.values("down") {
		if !virtualAdapter.MatchString(name) {
			out.NetDown += v
		}
	}
	for name, v := range s.values("up") {
		if !virtualAdapter.MatchString(name) {
			out.NetUp += v
		}
	}
	out.DiskRead = s.value("read")
	out.DiskWrite = s.value("write")
	out.Memory = memory()
	out.Disks = drives()
	up, _, _ := getTickCount64.Call()
	out.Uptime = int64(up / 1000)
	out.Battery = s.battery.read()
	// Disk temperatures change slowly: every 5 seconds.
	if time.Since(s.tempsAt) > 5*time.Second {
		s.tempsAt = time.Now()
		s.temps = s.temps[:0]
		for _, d := range s.disks {
			s.temps = append(s.temps, d.read()...)
		}
	}
	out.Temps = append(out.Temps, s.temps...)
	// The processes every other tick: there are hundreds.
	if tick%2 == 0 || s.procs == nil {
		s.procs = topProcesses(s.processes.sample(), 8)
	}
	out.Processes = s.procs
	return out
}

// sortedCores orders the processors' usage: each is named "group,number",
// and the totals end with _Total.
func sortedCores(vals map[string]float64) []float64 {
	type core struct {
		group, n int
		v        float64
	}
	var cores []core
	for name, v := range vals {
		g, n, ok := strings.Cut(name, ",")
		if !ok || n == "_Total" {
			continue
		}
		gi, n1 := atoi(g), atoi(n)
		cores = append(cores, core{gi, n1, min(v, 100)})
	}
	for i := 1; i < len(cores); i++ {
		for j := i; j > 0 && (cores[j].group < cores[j-1].group || cores[j].group == cores[j-1].group && cores[j].n < cores[j-1].n); j-- {
			cores[j], cores[j-1] = cores[j-1], cores[j]
		}
	}
	out := make([]float64, len(cores))
	for i, c := range cores {
		out[i] = c.v
	}
	return out
}

func atoi(s string) int {
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return n
		}
		n = n*10 + int(r-'0')
	}
	return n
}

// fmtValue is PDH_FMT_COUNTERVALUE with a double.
type fmtValue struct {
	status uint32
	_      uint32
	value  float64
}

func (s *sampler) value(name string) float64 {
	c, ok := s.counters[name]
	if !ok {
		return 0
	}
	var v fmtValue
	if r, _, _ := pdhGetFormattedCounterValue.Call(c, pdhFmtDouble|pdhFmtNoCap100, 0, uintptr(unsafe.Pointer(&v))); r != 0 || v.status > 1 {
		return 0
	}
	return v.value
}

// values reads a counter of every instance, by instance name.
func (s *sampler) values(name string) map[string]float64 {
	out := map[string]float64{}
	c, ok := s.counters[name]
	if !ok {
		return out
	}
	var size, count uint32
	r, _, _ := pdhGetFormattedCounterArray.Call(c, pdhFmtDouble|pdhFmtNoCap100, uintptr(unsafe.Pointer(&size)), uintptr(unsafe.Pointer(&count)), 0)
	if uint32(r) != pdhMoreData || size == 0 {
		return out
	}
	buf := make([]byte, size)
	if r, _, _ := pdhGetFormattedCounterArray.Call(c, pdhFmtDouble|pdhFmtNoCap100, uintptr(unsafe.Pointer(&size)), uintptr(unsafe.Pointer(&count)), uintptr(unsafe.Pointer(&buf[0]))); r != 0 {
		return out
	}
	// PDH_FMT_COUNTERVALUE_ITEM_W: a name pointer, then the value.
	type item struct {
		name  *uint16
		value fmtValue
	}
	items := unsafe.Slice((*item)(unsafe.Pointer(&buf[0])), count)
	for _, it := range items {
		if it.value.status <= 1 {
			out[syscall.UTF16ToString(unsafe.Slice(it.name, 256))] += it.value.value
		}
	}
	return out
}

func memory() MemorySample {
	var m struct {
		length, load                            uint32
		total, avail, totalPage, availPage      uint64
		totalVirtual, availVirtual, availExtVir uint64
	}
	m.length = uint32(unsafe.Sizeof(m))
	globalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&m)))
	used := m.total - m.avail
	return MemorySample{Used: used, Total: m.total, Percent: float64(used) / float64(max(m.total, 1)) * 100}
}

func drives() []DiskSample {
	out := []DiskSample{}
	mask, _, _ := getLogicalDrives.Call()
	for i := 0; i < 26; i++ {
		if mask&(1<<i) == 0 {
			continue
		}
		root := string(rune('A'+i)) + `:\`
		p, _ := syscall.UTF16PtrFromString(root)
		if t, _, _ := getDriveType.Call(uintptr(unsafe.Pointer(p))); t != 3 { // DRIVE_FIXED
			continue
		}
		var free, total, totalFree uint64
		if r, _, _ := getDiskFreeSpaceEx.Call(uintptr(unsafe.Pointer(p)), uintptr(unsafe.Pointer(&free)), uintptr(unsafe.Pointer(&total)), uintptr(unsafe.Pointer(&totalFree))); r != 0 && total > 0 {
			out = append(out, DiskSample{Name: root[:2], Used: total - totalFree, Total: total})
		}
	}
	return out
}

// nvmeDisk is a physical disk that reports its temperature.
type nvmeDisk struct {
	index int
	name  string
}

const ioctlStorageQueryProperty = 0x2D1400

func openPhysicalDrive(i int) (syscall.Handle, error) {
	p, _ := syscall.UTF16PtrFromString(`\\.\PhysicalDrive` + itoa(i))
	// No access asked for: querying properties needs none, nor an
	// administrator.
	return syscall.CreateFile(p, 0, syscall.FILE_SHARE_READ|syscall.FILE_SHARE_WRITE, nil, syscall.OPEN_EXISTING, 0, 0)
}

func itoa(i int) string {
	if i < 10 {
		return string(rune('0' + i))
	}
	return itoa(i/10) + string(rune('0'+i%10))
}

// nvmeDisks finds the disks with temperatures and their product names.
func nvmeDisks() []nvmeDisk {
	var out []nvmeDisk
	for i := 0; i < 8; i++ {
		h, err := openPhysicalDrive(i)
		if err != nil {
			continue
		}
		q := make([]byte, 12) // StorageDeviceProperty, PropertyStandardQuery
		buf := make([]byte, 1024)
		var n uint32
		name := "硬盘 " + itoa(i)
		if syscall.DeviceIoControl(h, ioctlStorageQueryProperty, &q[0], 12, &buf[0], uint32(len(buf)), &n, nil) == nil {
			if off := binary.LittleEndian.Uint32(buf[16:]); off > 0 && int(off) < len(buf) {
				name = strings.TrimSpace(string(buf[off : off+uint32(cstrlen(buf[off:]))]))
			}
		}
		syscall.CloseHandle(h)
		d := nvmeDisk{index: i, name: name}
		if len(d.read()) > 0 {
			out = append(out, d)
		}
	}
	return out
}

func cstrlen(b []byte) int {
	for i, c := range b {
		if c == 0 {
			return i
		}
	}
	return len(b)
}

// read asks a disk for its temperatures (StorageDeviceTemperatureProperty):
// the first sensor is the drive's, as NVMe's composite temperature.
func (d nvmeDisk) read() []SensorReading {
	h, err := openPhysicalDrive(d.index)
	if err != nil {
		return nil
	}
	defer syscall.CloseHandle(h)
	q := make([]byte, 12)
	binary.LittleEndian.PutUint32(q, 52)
	buf := make([]byte, 512)
	var n uint32
	if syscall.DeviceIoControl(h, ioctlStorageQueryProperty, &q[0], 12, &buf[0], uint32(len(buf)), &n, nil) != nil || n < 24 {
		return nil
	}
	critical := float64(int16(binary.LittleEndian.Uint16(buf[8:])))
	count := int(binary.LittleEndian.Uint16(buf[12:]))
	var out []SensorReading
	for i := 0; i < count && 24+i*16+4 <= int(n); i++ {
		t := float64(int16(binary.LittleEndian.Uint16(buf[24+i*16+2:])))
		if t <= 0 || t > 150 {
			continue
		}
		name := d.name
		if i > 0 {
			name += " · 传感器 " + itoa(i)
		}
		out = append(out, SensorReading{Group: "硬盘", Name: name, Value: t, Max: critical})
	}
	return out
}

// batteryReader reads the battery through its device: charge, power and
// health, which GetSystemPowerStatus does not give.
type batteryReader struct {
	h        syscall.Handle
	tag      uint32
	design   uint32 // mWh
	full     uint32 // mWh
	cycles   uint32
	relative bool // capacities in percent rather than mWh
}

var batteryGUID = syscall.GUID{Data1: 0x72631e54, Data2: 0x78a4, Data3: 0x11d0, Data4: [8]byte{0xbc, 0xf7, 0x00, 0xaa, 0x00, 0xb7, 0xb3, 0x2a}}

const (
	ioctlBatteryQueryTag    = 0x294040
	ioctlBatteryQueryInfo   = 0x294044
	ioctlBatteryQueryStatus = 0x29404C
)

func openBattery() *batteryReader {
	devs, _, _ := setupDiGetClassDevs.Call(uintptr(unsafe.Pointer(&batteryGUID)), 0, 0, 0x2|0x10) // DIGCF_PRESENT | DIGCF_DEVICEINTERFACE
	if devs == 0 || devs == ^uintptr(0) {
		return nil
	}
	defer setupDiDestroyDeviceInfoList.Call(devs)
	var did struct {
		size     uint32
		class    syscall.GUID
		flags    uint32
		reserved uintptr
	}
	did.size = uint32(unsafe.Sizeof(did))
	if r, _, _ := setupDiEnumDeviceInterfaces.Call(devs, 0, uintptr(unsafe.Pointer(&batteryGUID)), 0, uintptr(unsafe.Pointer(&did))); r == 0 {
		return nil
	}
	var need uint32
	setupDiGetDeviceInterfaceDtl.Call(devs, uintptr(unsafe.Pointer(&did)), 0, 0, uintptr(unsafe.Pointer(&need)), 0)
	if need == 0 {
		return nil
	}
	detail := make([]byte, need)
	binary.LittleEndian.PutUint32(detail, 8) // cbSize of SP_DEVICE_INTERFACE_DETAIL_DATA_W on 64-bit
	if r, _, _ := setupDiGetDeviceInterfaceDtl.Call(devs, uintptr(unsafe.Pointer(&did)), uintptr(unsafe.Pointer(&detail[0])), uintptr(need), 0, 0); r == 0 {
		return nil
	}
	path := (*uint16)(unsafe.Pointer(&detail[4]))
	h, err := syscall.CreateFile(path, syscall.GENERIC_READ|syscall.GENERIC_WRITE, syscall.FILE_SHARE_READ|syscall.FILE_SHARE_WRITE, nil, syscall.OPEN_EXISTING, 0, 0)
	if err != nil {
		return nil
	}
	b := &batteryReader{h: h}
	var wait uint32
	var n uint32
	if syscall.DeviceIoControl(h, ioctlBatteryQueryTag, (*byte)(unsafe.Pointer(&wait)), 4, (*byte)(unsafe.Pointer(&b.tag)), 4, &n, nil) != nil || b.tag == 0 {
		syscall.CloseHandle(h)
		return nil
	}
	// BATTERY_QUERY_INFORMATION for BatteryInformation; BATTERY_INFORMATION.
	q := make([]byte, 12)
	binary.LittleEndian.PutUint32(q, b.tag)
	info := make([]byte, 36)
	if syscall.DeviceIoControl(h, ioctlBatteryQueryInfo, &q[0], 12, &info[0], 36, &n, nil) == nil {
		b.relative = binary.LittleEndian.Uint32(info)&0x40000000 != 0 // BATTERY_CAPACITY_RELATIVE
		b.design = binary.LittleEndian.Uint32(info[12:])
		b.full = binary.LittleEndian.Uint32(info[16:])
		b.cycles = binary.LittleEndian.Uint32(info[32:])
	}
	return b
}

func (b *batteryReader) read() *BatterySample {
	if b == nil {
		return nil
	}
	wait := make([]byte, 20) // BATTERY_WAIT_STATUS: no waiting
	binary.LittleEndian.PutUint32(wait, b.tag)
	st := make([]byte, 16) // BATTERY_STATUS
	var n uint32
	if syscall.DeviceIoControl(b.h, ioctlBatteryQueryStatus, &wait[0], 20, &st[0], 16, &n, nil) != nil {
		return nil
	}
	state := binary.LittleEndian.Uint32(st)
	capacity := binary.LittleEndian.Uint32(st[4:])
	rate := int32(binary.LittleEndian.Uint32(st[12:]))
	out := &BatterySample{AC: state&1 != 0, Charging: state&4 != 0, Cycles: int(b.cycles)}
	if b.full > 0 && capacity != 0xFFFFFFFF {
		out.Percent = min(float64(capacity)/float64(b.full)*100, 100)
	}
	if !b.relative && rate != -0x80000000 {
		out.Rate = float64(rate) / 1000
	}
	if b.design > 0 {
		out.Health = min(float64(b.full)/float64(b.design)*100, 100)
	}
	// The status's percent, should the capacity be unknown.
	if out.Percent == 0 {
		var ps struct {
			ac, flag, percent, saver uint8
			life, full               uint32
		}
		getSystemPowerStatus.Call(uintptr(unsafe.Pointer(&ps)))
		if ps.percent <= 100 {
			out.Percent = float64(ps.percent)
		}
	}
	return out
}

func (b *batteryReader) close() {
	if b != nil {
		syscall.CloseHandle(b.h)
	}
}

// processTimes keeps the processes' CPU times between samples.
type processTimes map[uint32]procTime

type procTime struct {
	cpu  uint64 // 100 ns
	at   time.Time
	name string
}

func (pt processTimes) sample() []ProcessSample {
	snap, err := syscall.CreateToolhelp32Snapshot(syscall.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil
	}
	defer syscall.CloseHandle(snap)
	var e syscall.ProcessEntry32
	e.Size = uint32(unsafe.Sizeof(e))
	now := time.Now()
	cpus := float64(runtime.NumCPU())
	seen := map[uint32]bool{}
	var out []ProcessSample
	for err = syscall.Process32First(snap, &e); err == nil; err = syscall.Process32Next(snap, &e) {
		pid := e.ProcessID
		if pid == 0 || pid == 4 {
			continue
		}
		seen[pid] = true
		h, err := syscall.OpenProcess(0x1000, false, pid) // PROCESS_QUERY_LIMITED_INFORMATION
		if err != nil {
			continue
		}
		var c, x, k, u syscall.Filetime
		var mem struct {
			cb, faults                       uint32
			peakWS, ws, qpp, qp, qnpp, qnp   uintptr
			pagefile, peakPagefile, private_ uintptr
		}
		mem.cb = uint32(unsafe.Sizeof(mem))
		syscall.GetProcessTimes(h, &c, &x, &k, &u)
		k32GetProcessMemoryInfo.Call(uintptr(h), uintptr(unsafe.Pointer(&mem)), uintptr(mem.cb))
		syscall.CloseHandle(h)
		cpu := (uint64(k.HighDateTime)<<32 | uint64(k.LowDateTime)) + (uint64(u.HighDateTime)<<32 | uint64(u.LowDateTime))
		name := syscall.UTF16ToString(e.ExeFile[:])
		usage := 0.0
		if prev, ok := pt[pid]; ok && prev.name == name && cpu >= prev.cpu {
			if wall := now.Sub(prev.at).Seconds(); wall > 0 {
				usage = float64(cpu-prev.cpu) / 1e7 / wall / cpus * 100
			}
		}
		pt[pid] = procTime{cpu: cpu, at: now, name: name}
		out = append(out, ProcessSample{Name: name, CPU: usage, Memory: uint64(mem.ws), PIDs: []int{int(pid)}})
	}
	for pid := range pt {
		if !seen[pid] {
			delete(pt, pid)
		}
	}
	return out
}

func endProcess(pid int) error {
	h, err := syscall.OpenProcess(syscall.PROCESS_TERMINATE, false, uint32(pid))
	if err != nil {
		return err
	}
	defer syscall.CloseHandle(h)
	return syscall.TerminateProcess(h, 1)
}
