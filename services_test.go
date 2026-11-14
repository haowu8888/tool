package main

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestNormalizeService(t *testing.T) {
	for _, c := range []struct {
		in      Service
		target  string
		name    string
		invalid bool
	}{
		{in: Service{Kind: "http", Target: " outline.haowu.fun "}, target: "http://outline.haowu.fun", name: "outline.haowu.fun"},
		{in: Service{Kind: "http", Target: "ftp://x"}, invalid: true},
		{in: Service{Kind: "tcp", Target: "192.168.1.209:3000", Name: "NAS"}, target: "192.168.1.209:3000", name: "NAS"},
		{in: Service{Kind: "tcp", Target: "192.168.1.209"}, invalid: true},
		{in: Service{Kind: "ping", Target: "100.125.119.24"}, target: "100.125.119.24", name: "100.125.119.24"},
		{in: Service{Kind: "ping", Target: "http://x"}, invalid: true},
		{in: Service{Kind: "http"}, invalid: true},
	} {
		svc := c.in
		err := normalizeService(&svc)
		if (err != nil) != c.invalid {
			t.Errorf("%+v: error %v", c.in, err)
			continue
		}
		if err == nil && (svc.Target != c.target || svc.Name != c.name || svc.Interval != 60) {
			t.Errorf("%+v: got %+v", c.in, svc)
		}
	}
}

func TestProbeService(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/bad" {
			http.Error(w, "no", http.StatusBadGateway)
			return
		}
		w.Write([]byte("<title>Outline</title>"))
	}))
	defer srv.Close()
	tls := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer tls.Close()
	closed, _ := net.Listen("tcp", "127.0.0.1:0")
	closedAddr := closed.Addr().String()
	closed.Close()

	for _, c := range []struct {
		svc  Service
		fail string // part of the error, or "" for up
	}{
		{svc: Service{Kind: "http", Target: srv.URL}},
		{svc: Service{Kind: "http", Target: srv.URL, Keyword: "Outline"}},
		{svc: Service{Kind: "http", Target: srv.URL, Keyword: "Grafana"}, fail: "没有「Grafana」"},
		{svc: Service{Kind: "http", Target: srv.URL + "/bad"}, fail: "HTTP 502"},
		{svc: Service{Kind: "http", Target: tls.URL}, fail: "证书"},
		{svc: Service{Kind: "http", Target: tls.URL, Insecure: true}},
		{svc: Service{Kind: "tcp", Target: strings.TrimPrefix(srv.URL, "http://")}},
		{svc: Service{Kind: "tcp", Target: closedAddr}, fail: "拒绝"},
		{svc: Service{Kind: "ping", Target: "127.0.0.1"}},
	} {
		err := probeService(c.svc)
		switch {
		case c.fail == "" && err != nil:
			t.Errorf("%s %s: %v", c.svc.Kind, c.svc.Target, err)
		case c.fail != "" && (err == nil || !strings.Contains(err.Error(), c.fail)):
			t.Errorf("%s %s: got %v, want %q", c.svc.Kind, c.svc.Target, err, c.fail)
		}
	}
}

// After the computer wakes up the network takes a moment: failures then
// do not count, and afterwards two in a row make a service down.
func TestServiceGrace(t *testing.T) {
	dataDir(t) // a service going down is written in the log
	closed, _ := net.Listen("tcp", "127.0.0.1:0")
	svc := Service{ID: "a", Name: "a", Kind: "tcp", Target: closed.Addr().String(), Interval: 60}
	closed.Close()
	s := &Services{loaded: true, runs: map[string]*serviceRun{}, list: []Service{svc}}
	s.run("a").fails = 1
	now := time.Now().Round(0)
	if slept(now.Add(-time.Second), now) || !slept(now.Add(-time.Hour), now) || !slept(now.Add(time.Hour), now) {
		t.Fatal("slept")
	}
	s.resumed(now)
	s.check(svc)
	if r := s.run("a"); r.fails != 0 || r.state.Status != "pending" || len(r.state.History) != 0 || r.state.Alert {
		t.Fatalf("a failure while waking up counted: %+v", r)
	}
	s.hold = time.Time{}
	s.check(svc)
	if r := s.run("a"); r.fails != 1 || r.state.Alert {
		t.Fatalf("after one failure: %+v", r)
	}
	s.check(svc)
	if r := s.run("a"); r.state.Status != "down" || !r.state.Alert {
		t.Fatalf("after two failures: %+v", r)
	}
}

// A NAS at home is not down when the laptop is elsewhere: only with an
// address on its network does a failure say something of it.
func TestOnLink(t *testing.T) {
	_, home, _ := net.ParseCIDR("192.168.1.37/24")
	_, tail, _ := net.ParseCIDR("100.101.102.103/32")
	_, loop, _ := net.ParseCIDR("127.0.0.1/8")
	addrs := []net.Addr{home, tail, loop}
	for ip, want := range map[string]bool{"192.168.1.209": true, "192.168.2.1": false, "10.0.0.5": false, "127.0.0.1": false} {
		if got := onLink(net.ParseIP(ip), addrs); got != want {
			t.Errorf("%s: on link %v, want %v", ip, got, want)
		}
	}
	for svc, want := range map[Service]string{
		{Kind: "http", Target: "http://192.168.1.209:3000/_health"}: "192.168.1.209",
		{Kind: "tcp", Target: "192.168.1.209:3000"}:                 "192.168.1.209",
		{Kind: "ping", Target: "nas.local"}:                         "nas.local",
		{Kind: "http", Target: "https://outline.haowu.fun/x"}:       "outline.haowu.fun",
	} {
		if got := serviceHost(svc); got != want {
			t.Errorf("%s: host %s, want %s", svc.Target, got, want)
		}
	}
	// 192.168.77.77 is on no network of this computer, one hopes.
	if why := whyAway(Service{Kind: "tcp", Target: "192.168.77.77:9"}); why == "" {
		t.Error("a private address elsewhere should be away")
	}
}

// The log keeps when a service went down and when it came back.
func TestServiceIncidents(t *testing.T) {
	dataDir(t)
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	svc := Service{ID: "a", Name: "a", Kind: "tcp", Target: ln.Addr().String(), Interval: 60}
	s := &Services{loaded: true, runs: map[string]*serviceRun{}, list: []Service{svc}}
	s.run("a")
	s.check(svc)
	if len(s.incidents) != 0 || s.run("a").state.Status != "up" {
		t.Fatalf("up: %+v", s.incidents)
	}
	ln.Close()
	s.check(svc)
	s.check(svc)
	if len(s.incidents) != 1 || s.incidents[0].To != 0 || s.incidents[0].Message == "" {
		t.Fatalf("down: %+v", s.incidents)
	}
	ln, err := net.Listen("tcp", svc.Target)
	if err != nil {
		t.Skip("the port is taken:", err)
	}
	defer ln.Close()
	s.check(svc)
	if len(s.incidents) != 1 || s.incidents[0].To < s.incidents[0].From {
		t.Fatalf("back: %+v", s.incidents)
	}
	// Read again, as after a restart while one was down.
	s.incidents[0].To = 0
	s.saveLog()
	s2 := &Services{}
	s2.load()
	if got := s2.Incidents(); len(got) != 1 || got[0].To != -1 {
		t.Fatalf("after a restart: %+v", got)
	}
}
