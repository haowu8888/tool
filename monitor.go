package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os/exec"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// MonitorSampled is sent with every sample while the monitor page or the
// overlay watches.
var MonitorSampled = mygo.NewEvent[MonitorSample]("monitorSampled")

// MonitorSample is the system's state at a moment.
type MonitorSample struct {
	Time      int64           `json:"time"` // Unix milliseconds
	CPU       CPUSample       `json:"cpu"`
	Memory    MemorySample    `json:"memory"`
	GPU       GPUSample       `json:"gpu"`
	Disks     []DiskSample    `json:"disks"`
	DiskRead  float64         `json:"diskRead"`  // bytes a second, all disks
	DiskWrite float64         `json:"diskWrite"` // bytes a second
	NetDown   float64         `json:"netDown"`   // bytes a second
	NetUp     float64         `json:"netUp"`     // bytes a second
	Battery   *BatterySample  `json:"battery,omitempty"`
	Temps     []SensorReading `json:"temps"`
	Fans      []SensorReading `json:"fans"`
	Processes []ProcessSample `json:"processes"` // the busiest, by name
	Uptime    int64           `json:"uptime"`    // seconds
	// Sensors is whether LibreHardwareMonitor answered, which gives the
	// CPU's temperatures, power and the fans.
	Sensors bool `json:"sensors"`
}

// CPUSample is the processor's load.
type CPUSample struct {
	Usage float64   `json:"usage"` // percent, as Task Manager shows it
	Freq  float64   `json:"freq"`  // the current speed, GHz
	Cores []float64 `json:"cores"` // each logical processor's percent
	Temp  float64   `json:"temp"`  // °C, 0 without LibreHardwareMonitor
	Power float64   `json:"power"` // W, 0 without LibreHardwareMonitor
}

// MemorySample is the physical memory in use.
type MemorySample struct {
	Used    uint64  `json:"used"`
	Total   uint64  `json:"total"`
	Percent float64 `json:"percent"`
}

// GPUSample is the graphics processor's load.
type GPUSample struct {
	Usage  float64 `json:"usage"`  // percent of its busiest engine, as Task Manager
	Memory uint64  `json:"memory"` // bytes in use, shared and dedicated
	Temp   float64 `json:"temp"`   // °C, 0 when unknown
	Power  float64 `json:"power"`  // W, 0 without LibreHardwareMonitor
	Clock  float64 `json:"clock"`  // MHz, 0 without LibreHardwareMonitor
}

// DiskSample is a drive's space.
type DiskSample struct {
	Name  string `json:"name"` // C:
	Used  uint64 `json:"used"`
	Total uint64 `json:"total"`
}

// BatterySample is the battery's charge and health.
type BatterySample struct {
	Percent  float64 `json:"percent"`
	Charging bool    `json:"charging"`
	AC       bool    `json:"ac"`
	Rate     float64 `json:"rate"`   // W: positive while charging, negative while discharging
	Health   float64 `json:"health"` // percent of the designed capacity it holds
	Cycles   int     `json:"cycles"`
}

// SensorReading is a temperature in °C or a fan's RPM.
type SensorReading struct {
	Group string  `json:"group"` // CPU, GPU, 硬盘, 主板, 电池…
	Name  string  `json:"name"`
	Value float64 `json:"value"`
	Max   float64 `json:"max,omitempty"` // the critical temperature, when known
}

// ProcessSample is the processes of a program together.
type ProcessSample struct {
	Name   string  `json:"name"`
	Count  int     `json:"count"`
	CPU    float64 `json:"cpu"` // percent of all processors
	Memory uint64  `json:"memory"`
	PIDs   []int   `json:"pids"`
}

// SystemInfo describes the computer, read once.
type SystemInfo struct {
	OS       string   `json:"os"`
	Version  string   `json:"version"`
	Computer string   `json:"computer"`
	Model    string   `json:"model"`
	Board    string   `json:"board"`
	BIOS     string   `json:"bios"`
	CPU      string   `json:"cpu"`
	CPUCores string   `json:"cpuCores"`
	Memory   string   `json:"memory"`
	GPUs     []string `json:"gpus"`
	Disks    []string `json:"disks"`
	Displays []string `json:"displays"`
	Network  []string `json:"network"`
	Battery  string   `json:"battery"`
	Boot     string   `json:"boot"`
}

// Monitor samples the system while someone watches: the monitor page,
// the overlay.
type Monitor struct {
	mu       sync.Mutex
	watchers map[string]bool
	hidden   bool // the toolbox's window cannot be seen: its page does not count
	stop     chan struct{}
	last     MonitorSample
	info     *SystemInfo

	settings *Settings
}

// Watch starts or stops a watcher; sampling runs while any watches.
func (m *Monitor) Watch(who string, on bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.watchers == nil {
		m.watchers = map[string]bool{}
	}
	if on {
		m.watchers[who] = true
	} else {
		delete(m.watchers, who)
	}
	m.update()
}

// setHidden tells whether the toolbox's window is hidden or minimized. Its
// page does not watch then, though it says so: on Windows the page of a
// hidden window still finds itself visible.
func (m *Monitor) setHidden(hidden bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.hidden = hidden
	m.update()
}

// update starts or stops sampling for the watchers. Call with m.mu held.
func (m *Monitor) update() {
	watched := false
	for who := range m.watchers {
		if who != "page" || !m.hidden {
			watched = true
		}
	}
	switch {
	case watched && m.stop == nil:
		m.stop = make(chan struct{})
		go m.run(m.stop)
	case !watched && m.stop != nil:
		close(m.stop)
		m.stop = nil
	}
}

// Last returns the latest sample, for a page that just opened.
func (m *Monitor) Last() MonitorSample {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.last
}

// Info describes the computer; refresh reads it again.
func (m *Monitor) Info(refresh bool) (SystemInfo, error) {
	m.mu.Lock()
	cached := m.info
	m.mu.Unlock()
	if cached != nil && !refresh {
		return *cached, nil
	}
	info, err := systemInfo()
	if err != nil {
		return SystemInfo{}, err
	}
	for _, d := range mygo.Screen.Displays() {
		b := d.Bounds
		info.Displays = append(info.Displays, strconv.Itoa(int(float64(b.Width)*d.ScaleFactor))+"×"+strconv.Itoa(int(float64(b.Height)*d.ScaleFactor))+"，缩放 "+strconv.Itoa(int(d.ScaleFactor*100+0.5))+"%")
	}
	m.mu.Lock()
	m.info = &info
	m.mu.Unlock()
	return info, nil
}

// EndProcesses ends processes, as the busiest program's.
func (m *Monitor) EndProcesses(pids []int) error {
	var failed []string
	for _, pid := range pids {
		if err := endProcess(pid); err != nil {
			failed = append(failed, strconv.Itoa(pid))
		}
	}
	if len(failed) > 0 {
		return errors.New("有进程结束不了（可能需要管理员权限）：" + strings.Join(failed, ", "))
	}
	return nil
}

func (m *Monitor) run(stop <-chan struct{}) {
	s := newSampler()
	defer s.close()
	sensors := &lhmReader{}
	for tick := 0; ; tick++ {
		sample := s.sample(tick)
		sensors.add(&sample, m.settings.current().Monitor.SensorsURL)
		m.mu.Lock()
		m.last = sample
		m.mu.Unlock()
		MonitorSampled.Broadcast(sample)
		interval := time.Duration(m.settings.current().Monitor.Interval) * time.Millisecond
		select {
		case <-stop:
			return
		case <-time.After(interval):
		}
	}
}

// lhmReader reads LibreHardwareMonitor's web server: Windows has no
// interface for the CPU's temperature, which LibreHardwareMonitor reads
// with its driver. Failing, it tries again every 10 seconds.
type lhmReader struct {
	retry time.Time
}

type lhmNode struct {
	Text     string    `json:"Text"`
	Value    string    `json:"Value"`
	Max      string    `json:"Max"`
	Type     string    `json:"Type"`
	ImageURL string    `json:"ImageURL"`
	Children []lhmNode `json:"Children"`
}

var lhmNumber = regexp.MustCompile(`-?[\d.,]+`)

func lhmValue(s string) (float64, bool) {
	n := lhmNumber.FindString(s)
	if n == "" {
		return 0, false
	}
	v, err := strconv.ParseFloat(strings.ReplaceAll(n, ",", "."), 64)
	return v, err == nil
}

func (r *lhmReader) add(s *MonitorSample, url string) {
	if url == "" || time.Now().Before(r.retry) {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 600*time.Millisecond)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(url, "/")+"/data.json", nil)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		r.retry = time.Now().Add(10 * time.Second)
		return
	}
	defer res.Body.Close()
	var root lhmNode
	if json.NewDecoder(res.Body).Decode(&root) != nil {
		r.retry = time.Now().Add(10 * time.Second)
		return
	}
	addSensors(s, root)
}

// addSensors adds LibreHardwareMonitor's sensors to a sample.
func addSensors(s *MonitorSample, root lhmNode) {
	s.Sensors = true
	// The tree is root → computer → hardware → kind of sensor → sensors;
	// hardware may hold more, as a mainboard its chip.
	var walk func(n lhmNode, depth int, hardware lhmNode, kind string)
	walk = func(n lhmNode, depth int, hardware lhmNode, kind string) {
		if depth == 2 {
			hardware = n
		}
		if len(n.Children) == 0 && n.Value != "" {
			v, ok := lhmValue(n.Value)
			if !ok {
				return
			}
			group := lhmGroup(hardware.ImageURL)
			switch {
			case strings.Contains(n.Text, "Distance to TjMax"):
				// Headroom below the hottest allowed, not a temperature.
			case strings.HasSuffix(n.Value, "°C") || kind == "Temperatures":
				if group == "CPU" && (n.Text == "CPU Package" || (s.CPU.Temp == 0 && strings.HasPrefix(n.Text, "Core Max"))) {
					s.CPU.Temp = v
				}
				if group == "GPU" && s.GPU.Temp == 0 && strings.Contains(n.Text, "GPU") {
					s.GPU.Temp = v
				}
				if group != "硬盘" { // the disks' own sensors are read already
					s.Temps = append(s.Temps, SensorReading{Group: group, Name: hardware.Text + " · " + n.Text, Value: v})
				}
			case strings.HasSuffix(n.Value, "RPM"):
				s.Fans = append(s.Fans, SensorReading{Group: group, Name: hardware.Text + " · " + n.Text, Value: v})
			case strings.HasSuffix(n.Value, " W") && group == "CPU" && n.Text == "CPU Package":
				s.CPU.Power = v
			case strings.HasSuffix(n.Value, " W") && group == "GPU" && strings.Contains(n.Text, "GPU") && s.GPU.Power == 0:
				s.GPU.Power = v
			case strings.HasSuffix(n.Value, "MHz") && group == "GPU" && kind == "Clocks" && n.Text == "GPU Core":
				s.GPU.Clock = v
			}
			return
		}
		for _, c := range n.Children {
			walk(c, depth+1, hardware, n.Text)
		}
	}
	walk(root, 0, lhmNode{}, "")
}

func lhmGroup(image string) string {
	switch {
	case strings.Contains(image, "cpu"):
		return "CPU"
	case strings.Contains(image, "nvidia"), strings.Contains(image, "ati"), strings.Contains(image, "intel"), strings.Contains(image, "gpu"):
		return "GPU"
	case strings.Contains(image, "hdd"), strings.Contains(image, "nvme"), strings.Contains(image, "ssd"):
		return "硬盘"
	case strings.Contains(image, "mainboard"), strings.Contains(image, "chip"):
		return "主板"
	case strings.Contains(image, "battery"):
		return "电池"
	case strings.Contains(image, "ram"):
		return "内存"
	}
	return "其他"
}

// topProcesses groups processes by name and keeps the busiest ones by
// CPU, then the biggest by memory.
func topProcesses(all []ProcessSample, n int) []ProcessSample {
	byName := map[string]*ProcessSample{}
	for _, p := range all {
		g := byName[p.Name]
		if g == nil {
			g = &ProcessSample{Name: p.Name}
			byName[p.Name] = g
		}
		g.Count++
		g.CPU += p.CPU
		g.Memory += p.Memory
		g.PIDs = append(g.PIDs, p.PIDs...)
	}
	groups := make([]ProcessSample, 0, len(byName))
	for _, g := range byName {
		groups = append(groups, *g)
	}
	slices.SortFunc(groups, func(a, b ProcessSample) int {
		if a.CPU != b.CPU {
			if a.CPU > b.CPU {
				return -1
			}
			return 1
		}
		if a.Memory > b.Memory {
			return -1
		}
		if a.Memory < b.Memory {
			return 1
		}
		return 0
	})
	return groups[:min(n, len(groups))]
}

// systemInfoScript prints the computer's description as JSON; the WMI
// classes it reads need no administrator.
const systemInfoScript = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$bb = Get-CimInstance Win32_BaseBoard
$bios = Get-CimInstance Win32_BIOS
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$mem = @(Get-CimInstance Win32_PhysicalMemory)
$gb = { param($b) [math]::Round($b / 1GB) }
$bat = Get-CimInstance -Namespace root/wmi BatteryStaticData | Select-Object -First 1
$full = Get-CimInstance -Namespace root/wmi BatteryFullChargedCapacity | Select-Object -First 1
$cyc = Get-CimInstance -Namespace root/wmi BatteryCycleCount | Select-Object -First 1
[pscustomobject]@{
  os = $os.Caption
  version = "$($cv.DisplayVersion)（版本 $($cv.CurrentBuild).$($cv.UBR)）"
  computer = "$($env:COMPUTERNAME) · $($env:USERNAME)"
  model = "$($cs.Manufacturer) $($cs.Model)".Trim()
  board = "$($bb.Manufacturer) $($bb.Product)".Trim()
  bios = "$($bios.Manufacturer) $($bios.SMBIOSBIOSVersion)".Trim()
  cpu = $cpu.Name.Trim()
  cpuCores = "$($cpu.NumberOfCores) 核 $($cpu.NumberOfLogicalProcessors) 线程，基准 $([math]::Round($cpu.MaxClockSpeed / 1000, 2)) GHz"
  memory = "$(& $gb $cs.TotalPhysicalMemory) GB（$($mem.Count) 条 × $(& $gb ($mem | Select-Object -First 1).Capacity) GB，$(($mem | Select-Object -First 1).ConfiguredClockSpeed) MT/s）"
  gpus = @(Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notmatch 'Virtual|Mirage|Remote' } | ForEach-Object { "$($_.Name)（驱动 $($_.DriverVersion)）" })
  disks = @(Get-PhysicalDisk | ForEach-Object { "$($_.FriendlyName) · $(& $gb $_.Size) GB · $($_.BusType) $($_.MediaType) · 健康：$($_.HealthStatus)" })
  network = @(Get-CimInstance Win32_NetworkAdapterConfiguration -Filter 'IPEnabled=True' | ForEach-Object { "$($_.Description) · $(@($_.IPAddress | Where-Object { $_ -match '^\d+\.' }) -join ', ') · $($_.MACAddress)" })
  battery = $(if ($full) { "满电 $([math]::Round($full.FullChargedCapacity / 1000, 1)) Wh$(if ($bat.DesignedCapacity) { " / 设计 $([math]::Round($bat.DesignedCapacity / 1000, 1)) Wh" })$(if ($cyc) { "，已循环 $($cyc.CycleCount) 次" })" } else { '' })
  boot = $os.LastBootUpTime.ToString('yyyy-MM-dd HH:mm')
} | ConvertTo-Json -Depth 3 -Compress
`

func systemInfo() (SystemInfo, error) {
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", systemInfoScript)
	hideWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		return SystemInfo{}, errors.New("读取系统信息失败：" + err.Error())
	}
	var info SystemInfo
	if err := json.Unmarshal(out, &info); err != nil {
		return SystemInfo{}, errors.New("读取系统信息失败：" + err.Error())
	}
	return info, nil
}
