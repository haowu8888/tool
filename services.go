package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// ServicesChanged is sent with the services and their states whenever a
// check ends or the list changes.
var ServicesChanged = mygo.NewEvent[[]ServiceView]("servicesChanged")

// Service is an address checked every little while: a web page (http), a
// port (tcp) or a host answering ping.
type Service struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Kind     string `json:"kind"`     // http, tcp or ping
	Target   string `json:"target"`   // a URL, host:port, or a host
	Interval int    `json:"interval"` // seconds between checks
	// Keyword, for a web page, must be in it.
	Keyword string `json:"keyword,omitempty"`
	// Insecure accepts a page's certificate however it is, as a NAS's
	// own.
	Insecure bool `json:"insecure,omitempty"`
	Paused   bool `json:"paused,omitempty"`
	// Quiet does not pop up when it goes down.
	Quiet bool `json:"quiet,omitempty"`
}

// ServiceState is how a service's checks went.
type ServiceState struct {
	// Status is up, down, pending before the first check, or away: this
	// computer is not on the service's network, or has none, which says
	// nothing of the service.
	Status  string `json:"status"`
	Latency int    `json:"latency"` // milliseconds, of the last check
	Message string `json:"message,omitempty"`
	Checked int64  `json:"checked,omitempty"` // Unix milliseconds
	Since   int64  `json:"since,omitempty"`   // when the status last changed
	// History is the last checks' latencies, oldest first; -1 for a failed
	// one.
	History []int `json:"history"`
	// Alert is whether it went down and the user has not acknowledged it.
	Alert bool `json:"alert,omitempty"`
}

// ServiceView is a service with its state, for the pages.
type ServiceView struct {
	Service
	State ServiceState `json:"state"`
}

// serviceHistory is how many checks a service's history keeps.
const serviceHistory = 60

// ServiceIncident is a time a service was down, for the log.
type ServiceIncident struct {
	ID      string `json:"id"` // the service's
	Name    string `json:"name"`
	Target  string `json:"target"`
	From    int64  `json:"from"` // Unix milliseconds
	To      int64  `json:"to"`   // 0 while it is down; -1 when the app ended before it came back
	Message string `json:"message,omitempty"`
}

// maxIncidents is how many the log keeps.
const maxIncidents = 200

type serviceRun struct {
	state    ServiceState
	fails    int       // failed checks in a row
	next     time.Time // when to check again
	checking bool
}

// Services checks the user's services and tells, beside the floating ball,
// when one goes down.
type Services struct {
	mu        sync.Mutex
	list      []Service
	runs      map[string]*serviceRun
	incidents []ServiceIncident // oldest first
	loaded    bool
	onAlerts  func(down []ServiceView, fresh bool)
	open      func()     // shows the tool's page
	tellMu    sync.Mutex // one telling of the alerts at a time, in order
	// hold is until when nothing is checked: the network takes a moment
	// to come back after the computer starts or wakes up, and every
	// service would seem down.
	hold time.Time
}

// serviceGrace is how long the checks wait for the network after the
// computer wakes up, or starts with the app.
const serviceGrace = 20 * time.Second

func (s *Services) load() {
	if s.loaded {
		return
	}
	s.loaded = true
	s.runs = map[string]*serviceRun{}
	if err := readJSON("services.json", &s.list); err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Println("services:", err)
	}
	if err := readJSON("services-log.json", &s.incidents); err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Println("services log:", err)
	}
	// When the ones still open ended, the app was not there to see.
	for i := range s.incidents {
		if s.incidents[i].To == 0 {
			s.incidents[i].To = -1
		}
	}
}

// Incidents returns the times services were down, newest first.
func (s *Services) Incidents() []ServiceIncident {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.load()
	out := slices.Clone(s.incidents)
	slices.Reverse(out)
	return out
}

// ClearIncidents empties the log.
func (s *Services) ClearIncidents() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.load()
	s.incidents = []ServiceIncident{}
	s.saveLog()
	s.changed(false)
}

func (s *Services) saveLog() {
	if len(s.incidents) > maxIncidents {
		s.incidents = s.incidents[len(s.incidents)-maxIncidents:]
	}
	if err := writeJSON("services-log.json", s.incidents); err != nil {
		log.Println("services log:", err)
	}
}

// went notes in the log that a service went down, or came back. Call it
// with mu held.
func (s *Services) went(svc Service, down bool, at int64, msg string) {
	open := slices.IndexFunc(s.incidents, func(i ServiceIncident) bool { return i.ID == svc.ID && i.To == 0 })
	switch {
	case down && open < 0:
		s.incidents = append(s.incidents, ServiceIncident{ID: svc.ID, Name: svc.Name, Target: svc.Target, From: at, Message: msg})
	case !down && open >= 0:
		s.incidents[open].To = at
	default:
		return
	}
	s.saveLog()
}

func (s *Services) run(id string) *serviceRun {
	r := s.runs[id]
	if r == nil {
		r = &serviceRun{state: ServiceState{Status: "pending", History: []int{}}}
		s.runs[id] = r
	}
	return r
}

func (s *Services) views() []ServiceView {
	out := make([]ServiceView, len(s.list))
	for i, svc := range s.list {
		r := s.run(svc.ID)
		st := r.state
		st.History = slices.Clone(st.History)
		out[i] = ServiceView{Service: svc, State: st}
	}
	return out
}

// List returns the services with their states.
func (s *Services) List() []ServiceView {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.load()
	return s.views()
}

// Alerts returns the services that went down and are not acknowledged.
func (s *Services) Alerts() []ServiceView {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.load()
	return s.alerts()
}

func (s *Services) alerts() []ServiceView {
	var out []ServiceView
	for _, v := range s.views() {
		if v.State.Alert {
			out = append(out, v)
		}
	}
	return out
}

// changed tells the pages, and the bubble which services are down. Call
// it with mu held.
func (s *Services) changed(fresh bool) {
	ServicesChanged.Broadcast(s.views())
	if s.onAlerts != nil {
		go s.tell(fresh)
	}
}

// tell tells onAlerts which services are down now. One at a time, so
// that the last told is the latest.
func (s *Services) tell(fresh bool) {
	s.tellMu.Lock()
	defer s.tellMu.Unlock()
	s.mu.Lock()
	down := s.alerts()
	s.mu.Unlock()
	s.onAlerts(down, fresh)
}

func (s *Services) save() {
	if err := writeJSON("services.json", s.list); err != nil {
		log.Println("services:", err)
	}
}

// normalize checks a service as the user wrote it, and fills in what it
// left out.
func normalizeService(svc *Service) error {
	svc.Name = strings.TrimSpace(svc.Name)
	svc.Target = strings.TrimSpace(svc.Target)
	svc.Keyword = strings.TrimSpace(svc.Keyword)
	if svc.Target == "" {
		return errors.New("要填地址")
	}
	switch svc.Kind {
	case "http":
		if !strings.Contains(svc.Target, "://") {
			svc.Target = "http://" + svc.Target
		}
		u, err := url.Parse(svc.Target)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return errors.New("网址不对，要像 https://example.com 这样")
		}
	case "tcp":
		host, port, err := net.SplitHostPort(svc.Target)
		if err != nil || host == "" || port == "" {
			return errors.New("端口要写成 主机:端口，如 192.168.1.209:3000")
		}
	case "ping":
		if strings.ContainsAny(svc.Target, "/: ") {
			return errors.New("Ping 只填主机名或 IP，如 192.168.1.209")
		}
	default:
		return errors.New("不认识的类型：" + svc.Kind)
	}
	if svc.Name == "" {
		svc.Name = svc.Target
		if u, err := url.Parse(svc.Target); err == nil && svc.Kind == "http" {
			svc.Name = u.Host
		}
	}
	if !slices.Contains([]int{30, 60, 300, 600}, svc.Interval) {
		svc.Interval = 60
	}
	return nil
}

// Save adds a service, when it has no ID, or replaces the one with its ID,
// and checks it at once.
func (s *Services) Save(svc Service) (Service, error) {
	if err := normalizeService(&svc); err != nil {
		return svc, err
	}
	s.mu.Lock()
	s.load()
	if svc.ID == "" {
		svc.ID = newID()
		s.list = append(s.list, svc)
	} else {
		i := slices.IndexFunc(s.list, func(o Service) bool { return o.ID == svc.ID })
		if i < 0 {
			s.mu.Unlock()
			return svc, errors.New("找不到这个服务")
		}
		old := s.list[i]
		s.list[i] = svc
		// Another address starts its history over.
		if old.Kind != svc.Kind || old.Target != svc.Target || old.Keyword != svc.Keyword || old.Insecure != svc.Insecure {
			delete(s.runs, svc.ID)
		}
		if svc.Paused || svc.Quiet {
			s.run(svc.ID).state.Alert = false
		}
	}
	s.run(svc.ID).next = time.Time{}
	s.save()
	s.changed(false)
	s.mu.Unlock()
	return svc, nil
}

// Delete removes a service.
func (s *Services) Delete(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.load()
	s.list = slices.DeleteFunc(s.list, func(o Service) bool { return o.ID == id })
	delete(s.runs, id)
	s.save()
	s.changed(false)
}

// Move moves a service up or down the list.
func (s *Services) Move(id string, by int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.load()
	i := slices.IndexFunc(s.list, func(o Service) bool { return o.ID == id })
	j := i + by
	if i < 0 || j < 0 || j >= len(s.list) {
		return
	}
	s.list[i], s.list[j] = s.list[j], s.list[i]
	s.save()
	s.changed(false)
}

// Ack stops a down service's alert; it alerts again the next time it goes
// down.
func (s *Services) Ack(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.load()
	if r := s.runs[id]; r != nil {
		r.state.Alert = false
	}
	s.changed(false)
}

// AckAll stops every alert.
func (s *Services) AckAll() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.load()
	for _, r := range s.runs {
		r.state.Alert = false
	}
	s.changed(false)
}

// Check checks a service now, or every one for "".
func (s *Services) Check(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.load()
	// The user asks: now, whatever the checks wait for.
	s.hold = time.Time{}
	for _, svc := range s.list {
		if id == "" || svc.ID == id {
			s.run(svc.ID).next = time.Time{}
		}
	}
}

// Open shows the tool's page, as the bubble asks.
func (s *Services) Open() {
	if s.open != nil {
		s.open()
	}
}

// watch checks every service when its time comes, as long as the app
// runs. Started with the computer, it gives the network a moment first.
func (s *Services) watch(atLogin bool) {
	s.mu.Lock()
	if atLogin {
		s.hold = time.Now().Add(serviceGrace)
	}
	s.mu.Unlock()
	// The clock on the wall, which goes on while the computer sleeps.
	last := time.Now().Round(0)
	for {
		now := time.Now().Round(0)
		s.mu.Lock()
		s.load()
		if slept(last, now) {
			s.resumed(now)
		}
		last = now
		var due []Service
		for _, svc := range s.list {
			r := s.run(svc.ID)
			if svc.Paused || r.checking || now.Before(r.next) || now.Before(s.hold) {
				continue
			}
			r.checking = true
			due = append(due, svc)
		}
		s.mu.Unlock()
		for _, svc := range due {
			go s.check(svc)
		}
		time.Sleep(time.Second)
	}
}

// slept is whether the computer slept between two looks at the clock a
// second apart.
func slept(last, now time.Time) bool {
	d := now.Sub(last)
	return d > 10*time.Second || d < -10*time.Second
}

// resumed gives the network a moment after the computer woke up: checks
// wait, and a failure from before or while it went to sleep does not
// count toward being down. Call it with mu held.
func (s *Services) resumed(now time.Time) {
	s.hold = now.Add(serviceGrace)
	for _, r := range s.runs {
		r.fails = 0
	}
}

// check checks a service and keeps the result. A service is down after
// two failed checks in a row, the second soon after the first, so that a
// moment's trouble does not alert.
func (s *Services) check(svc Service) {
	start := time.Now()
	err := probeService(svc)
	ms := int(time.Since(start).Milliseconds())
	// Not reached: is it the service, or this computer's network?
	away := ""
	if err != nil {
		away = whyAway(svc)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.runs[svc.ID]
	i := slices.IndexFunc(s.list, func(o Service) bool { return o.ID == svc.ID })
	if r == nil || i < 0 || s.list[i] != svc {
		// Changed or deleted meanwhile: the new one is checked anew.
		if r != nil {
			r.checking = false
		}
		return
	}
	r.checking = false
	if err != nil && (time.Now().Before(s.hold) || time.Now().Round(0).Sub(start.Round(0)) > time.Minute) {
		// It ran while the computer went to sleep or woke up: again once
		// the network is back.
		r.next = s.hold
		return
	}
	r.next = time.Now().Add(time.Duration(svc.Interval) * time.Second)
	st := &r.state
	st.Checked = time.Now().UnixMilli()
	fresh := false
	if away != "" {
		// Nothing is known of the service from here: no failure counts,
		// nothing alerts.
		r.fails = 0
		st.Latency, st.Message, st.Alert = -1, away, false
		if st.Status != "away" {
			st.Status, st.Since = "away", st.Checked
		}
		s.changed(false)
		return
	}
	was := st.Status
	defer func() {
		if st.Status != was && (st.Status == "down" || st.Status == "up") {
			s.went(svc, st.Status == "down", st.Checked, st.Message)
		}
	}()
	if err == nil {
		r.fails = 0
		st.Latency, st.Message = ms, ""
		st.History = append(st.History, ms)
		if st.Status != "up" {
			st.Status, st.Since, st.Alert = "up", st.Checked, false
		}
	} else {
		r.fails++
		st.Latency, st.Message = -1, err.Error()
		st.History = append(st.History, -1)
		switch {
		case r.fails == 1 && st.Status != "down":
			// Once more in a little while before it counts.
			r.next = time.Now().Add(10 * time.Second)
			if st.Status == "pending" {
				st.Status = "down"
				st.Since = st.Checked
			}
		case st.Status != "down" || r.fails == 2:
			if st.Status != "down" {
				st.Since = st.Checked
			}
			st.Status = "down"
			if !svc.Quiet && !st.Alert && r.fails == 2 {
				st.Alert, fresh = true, true
			}
		}
	}
	if len(st.History) > serviceHistory {
		st.History = st.History[len(st.History)-serviceHistory:]
	}
	s.changed(fresh)
}

// serviceHost is the host a service is at.
func serviceHost(svc Service) string {
	switch svc.Kind {
	case "http":
		if u, err := url.Parse(svc.Target); err == nil {
			return u.Hostname()
		}
	case "tcp":
		if host, _, err := net.SplitHostPort(svc.Target); err == nil {
			return host
		}
	}
	return svc.Target
}

// whyAway says, for a service that was not reached, why that is no word
// on the service: this computer is not on its network, as a laptop away
// from the home network of a NAS, or has no network at all. Empty when
// the service itself is to blame.
func whyAway(svc Service) string {
	if ip := net.ParseIP(serviceHost(svc)); ip != nil && ip.IsPrivate() {
		addrs, err := net.InterfaceAddrs()
		if err != nil {
			return ""
		}
		if !onLink(ip, addrs) {
			return "本机不在这个网络（没有和 " + ip.String() + " 同网段的地址）"
		}
		// On its network: reaching it needs no Internet.
		return ""
	}
	if ip := net.ParseIP(serviceHost(svc)); ip != nil && ip.IsLoopback() {
		return ""
	}
	if !online() {
		return "本机没有网络"
	}
	return ""
}

// onLink is whether one of this computer's addresses is on the network
// of ip.
func onLink(ip net.IP, addrs []net.Addr) bool {
	for _, a := range addrs {
		if n, ok := a.(*net.IPNet); ok && !n.IP.IsLoopback() && n.Contains(ip) {
			return true
		}
	}
	return false
}

var (
	onlineMu   sync.Mutex
	onlineAt   time.Time
	onlineLast bool
	// onlineProbes are places that answer whenever this computer has a
	// network: public DNS servers by address, and two sites by name.
	onlineProbes = []string{"223.5.5.5:53", "119.29.29.29:53", "www.baidu.com:443", "www.qq.com:443"}
)

// online is whether this computer reaches the Internet: any of a few
// well-known places, asked at most every few seconds.
func online() bool {
	onlineMu.Lock()
	defer onlineMu.Unlock()
	if time.Since(onlineAt) < 5*time.Second {
		return onlineLast
	}
	ok := make(chan bool, len(onlineProbes))
	for _, addr := range onlineProbes {
		go func() {
			c, err := net.DialTimeout("tcp", addr, 3*time.Second)
			if err == nil {
				c.Close()
			}
			ok <- err == nil
		}()
	}
	onlineLast = false
	for range onlineProbes {
		if <-ok {
			onlineLast = true
			break
		}
	}
	onlineAt = time.Now()
	return onlineLast
}

// probeService checks a service once.
func probeService(svc Service) error {
	switch svc.Kind {
	case "http":
		return probeHTTP(svc)
	case "tcp":
		c, err := net.DialTimeout("tcp", svc.Target, 8*time.Second)
		if err != nil {
			return friendlyNetError(err)
		}
		c.Close()
		return nil
	case "ping":
		return ping(svc.Target, 4*time.Second)
	}
	return errors.New("不认识的类型")
}

func probeHTTP(svc Service) error {
	tr := http.DefaultTransport.(*http.Transport).Clone()
	// The user's own servers are reached directly, as the browser would
	// on this network.
	tr.Proxy = nil
	tr.DisableKeepAlives = true
	if svc.Insecure {
		tr.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	}
	client := &http.Client{Transport: tr, Timeout: 15 * time.Second}
	req, err := http.NewRequestWithContext(context.Background(), "GET", svc.Target, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Toolbox-ServiceMonitor/1.0")
	resp, err := client.Do(req)
	if err != nil {
		return friendlyNetError(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	if svc.Keyword != "" {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
		if !bytes.Contains(body, []byte(svc.Keyword)) {
			return fmt.Errorf("页面里没有「%s」", svc.Keyword)
		}
	}
	return nil
}

// friendlyNetError says what went wrong in a few words.
func friendlyNetError(err error) error {
	msg := err.Error()
	var dns *net.DNSError
	var cert *tls.CertificateVerificationError
	switch {
	case errors.As(err, &dns):
		return errors.New("域名解析失败")
	case errors.As(err, &cert):
		return errors.New("证书不受信任（自签名证书可勾选「忽略证书错误」）")
	case strings.Contains(msg, "timeout") || strings.Contains(msg, "deadline exceeded"):
		return errors.New("连接超时")
	case strings.Contains(msg, "refused") || strings.Contains(msg, "actively refused"):
		return errors.New("连接被拒绝（端口没开）")
	case strings.Contains(msg, "unreachable"):
		return errors.New("网络不可达")
	case strings.Contains(msg, "reset"):
		return errors.New("连接被重置")
	}
	return err
}

// TailscalePeer is a device of the user's tailnet.
type TailscalePeer struct {
	Name   string `json:"name"`
	OS     string `json:"os"`
	IP     string `json:"ip"`
	Online bool   `json:"online"`
	Self   bool   `json:"self,omitempty"`
}

// TailscaleStatus is what tailscale status says.
type TailscaleStatus struct {
	Installed bool            `json:"installed"`
	State     string          `json:"state"` // Running, Stopped, NeedsLogin…
	Peers     []TailscalePeer `json:"peers"`
	Error     string          `json:"error,omitempty"`
}

// Tailscale asks the Tailscale client how the tailnet is.
func (s *Services) Tailscale() TailscaleStatus {
	exe := tailscaleExe()
	if exe == "" {
		return TailscaleStatus{Peers: []TailscalePeer{}}
	}
	st := TailscaleStatus{Installed: true, Peers: []TailscalePeer{}}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, exe, "status", "--json")
	hideWindow(cmd)
	out, err := cmd.Output()
	if err != nil && len(out) == 0 {
		st.Error = "tailscale status 失败：" + err.Error()
		return st
	}
	var raw struct {
		BackendState string
		Self         *tsPeer
		Peer         map[string]*tsPeer
	}
	if err := json.Unmarshal(out, &raw); err != nil {
		st.Error = "读不懂 tailscale 的输出"
		return st
	}
	st.State = raw.BackendState
	add := func(p *tsPeer, self bool) {
		if p == nil {
			return
		}
		ip := ""
		if len(p.TailscaleIPs) > 0 {
			ip = p.TailscaleIPs[0]
		}
		st.Peers = append(st.Peers, TailscalePeer{Name: p.HostName, OS: p.OS, IP: ip, Online: p.Online || self, Self: self})
	}
	add(raw.Self, true)
	peers := make([]*tsPeer, 0, len(raw.Peer))
	for _, p := range raw.Peer {
		peers = append(peers, p)
	}
	slices.SortFunc(peers, func(a, b *tsPeer) int {
		if a.Online != b.Online {
			if a.Online {
				return -1
			}
			return 1
		}
		return strings.Compare(strings.ToLower(a.HostName), strings.ToLower(b.HostName))
	})
	for _, p := range peers {
		add(p, false)
	}
	return st
}

type tsPeer struct {
	HostName     string
	OS           string
	TailscaleIPs []string
	Online       bool
}
