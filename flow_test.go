package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeFlow answers as Flow's API does, for the token "tok".
type fakeFlow struct {
	mu        sync.Mutex
	status    map[string]string // run ID → status
	triggered string            // the last trigger's remark
}

func (ff *fakeFlow) set(id, status string) {
	ff.mu.Lock()
	ff.status[id] = status
	ff.mu.Unlock()
}

func (ff *fakeFlow) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Authorization") != "Bearer tok" {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "unauthenticated"})
		return
	}
	ff.mu.Lock()
	defer ff.mu.Unlock()
	now := time.Now().Format(time.RFC3339Nano)
	run := func(id string, n int) map[string]any {
		r := map[string]any{"id": id, "pipeline_id": "p1", "number": n, "status": ff.status[id], "trigger": "manual", "created_by": "admin", "created_at": now, "started_at": now}
		if flowDone(ff.status[id]) {
			r["finished_at"] = now
		}
		return r
	}
	switch {
	case r.URL.Path == "/api/me":
		fmt.Fprint(w, `{"user":{"username":"admin","display_name":"管理员"}}`)
	case r.URL.Path == "/api/pipelines/summary":
		json.NewEncoder(w).Encode([]map[string]any{
			{"id": "p1", "name": "toolbox", "permissions": []string{"view", "run"}, "recent_runs": []any{run("r2", 2), run("r1", 1)}},
			{"id": "p2", "name": "draw", "permissions": []string{"view"}, "recent_runs": []any{}},
		})
	case r.URL.Path == "/api/runs/r2":
		json.NewEncoder(w).Encode(map[string]any{"run": run("r2", 2), "jobs": []any{map[string]any{
			"id": "j1", "name": "构建", "stage": "build", "status": ff.status["r2"], "exit_code": 2,
			"steps":       []any{map[string]any{"name": "拉取代码"}, map[string]any{"name": "构建"}},
			"step_states": []any{map[string]any{"status": "success", "started_at": now, "finished_at": now}},
			"outputs":     map[string]string{"CLOUDREVE_SHARE_URL": "http://pan/s/x"},
		}}})
	case r.URL.Path == "/api/jobs/j1/logs":
		log := strings.Repeat("一", flowLogMax) + "end\n"
		off := 0
		fmt.Sscan(r.URL.Query().Get("offset"), &off)
		w.Header().Set("X-Next-Offset", fmt.Sprint(len(log)))
		fmt.Fprint(w, log[min(off, len(log)):])
	case r.URL.Path == "/api/pipelines/p1/runs" && r.Method == "POST":
		var body struct{ Remark string }
		json.NewDecoder(r.Body).Decode(&body)
		ff.triggered = body.Remark
		ff.status["r3"] = "queued"
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]any{"run": run("r3", 3), "jobs": []any{}})
	default:
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "not found"})
	}
}

func TestFlow(t *testing.T) {
	dataDir(t)
	ff := &fakeFlow{status: map[string]string{"r1": "failed", "r2": "running"}}
	srv := httptest.NewServer(ff)
	defer srv.Close()
	f := &Flow{}
	var told []FlowAlert
	var fresh bool
	var toldMu sync.Mutex
	f.onAlerts = func(a []FlowAlert, fr bool) {
		toldMu.Lock()
		told, fresh = a, fresh || fr
		toldMu.Unlock()
	}

	if _, err := f.SetConfig(srv.URL, "bad", true); err == nil || !strings.Contains(err.Error(), "令牌") {
		t.Fatalf("bad token: %v", err)
	}
	name, err := f.SetConfig(srv.URL+"/", "tok", true)
	if err != nil || name != "管理员" {
		t.Fatalf("SetConfig = %q, %v", name, err)
	}
	if c := f.Config(); c.URL != srv.URL || !c.HasToken {
		t.Fatalf("config = %+v", c)
	}

	// The first fetch: r1 failed before, no news.
	f.fetch()
	s := f.State()
	if s.Error != "" || len(s.Pipelines) != 2 || !s.Pipelines[0].CanRun || s.Pipelines[1].CanRun || len(s.Pipelines[0].Runs) != 2 {
		t.Fatalf("state = %+v", s)
	}
	if len(s.Alerts) != 0 || !f.active() {
		t.Fatalf("alerts %v, active %v", s.Alerts, f.active())
	}

	// r2 fails: it alerts, once.
	ff.set("r2", "failed")
	f.fetch()
	f.fetch()
	if a := f.Alerts(); len(a) != 1 || a[0].RunID != "r2" || a[0].Pipeline != "toolbox" || a[0].Number != 2 {
		t.Fatalf("alerts = %+v", a)
	}
	time.Sleep(50 * time.Millisecond)
	toldMu.Lock()
	if len(told) != 1 || !fresh {
		t.Errorf("told %v, fresh %v", told, fresh)
	}
	toldMu.Unlock()
	if f.active() {
		t.Error("still active")
	}

	// Looking at it stops the alert.
	d, err := f.Detail("r2")
	if err != nil {
		t.Fatal(err)
	}
	if d.Pipeline != "toolbox" || len(d.Jobs) != 1 || d.Jobs[0].ExitCode != 2 || len(d.Jobs[0].Steps) != 2 ||
		d.Jobs[0].Steps[0].Status != "success" || d.Jobs[0].Steps[1].Status != "pending" || d.Jobs[0].Outputs["CLOUDREVE_SHARE_URL"] != "http://pan/s/x" {
		t.Fatalf("detail = %+v", d)
	}
	if a := f.Alerts(); len(a) != 0 {
		t.Fatalf("alerts after detail = %+v", a)
	}

	// A long log gives its end, whole characters only; then from there on.
	l, err := f.Log("j1", 0)
	if err != nil || !l.Cut || !strings.HasSuffix(l.Text, "end\n") || len(l.Text) > flowLogMax || strings.ContainsRune(l.Text, '�') {
		t.Fatalf("log: cut %v, %d bytes, %v", l.Cut, len(l.Text), err)
	}
	if l2, err := f.Log("j1", l.Next); err != nil || l2.Text != "" || l2.Next != l.Next {
		t.Fatalf("log after = %+v, %v", l2, err)
	}

	run, err := f.Trigger("p1", "  修复  ")
	if err != nil || run.Number != 3 || run.Status != "queued" || ff.triggered != "修复" {
		t.Fatalf("trigger = %+v, %v, remark %q", run, err, ff.triggered)
	}
	if _, err := f.Detail("nope"); err == nil || err.Error() != "not found" {
		t.Errorf("missing run: %v", err)
	}
	if err := f.Open("javascript:alert(1)"); err == nil {
		t.Error("opened a javascript: link")
	}

	// Kept, without the token in the page's view; read again by another.
	g := &Flow{}
	if c := g.Config(); c.URL != srv.URL || !c.HasToken || !c.Notify {
		t.Fatalf("reloaded config = %+v", c)
	}
	if err := g.Disconnect(); err != nil {
		t.Fatal(err)
	}
	if s := g.State(); s.Configured {
		t.Error("still configured")
	}
	if _, err := g.Detail("r2"); err == nil {
		t.Error("detail without a token")
	}
}
