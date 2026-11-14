package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/egoist/mygo"
)

// FlowChanged is sent with the pipelines whenever they are fetched.
var FlowChanged = mygo.NewEvent[FlowState]("flowChanged")

// FlowFocus asks the tool's page to show a run, as the bubble's 看日志.
var FlowFocus = mygo.NewEvent[string]("flowFocus")

// FlowConfig is the Flow server the tool talks to, kept in flow.json: not
// in the settings, which every window gets, as it holds the token.
type FlowConfig struct {
	URL   string `json:"url"`
	Token string `json:"token,omitempty"` // an API token of Flow's 个人设置 → API 令牌
	// Notify pops up a run that failed beside the floating ball.
	Notify bool `json:"notify"`
}

// FlowConfigView is the config for the page: whether there is a token, not
// the token.
type FlowConfigView struct {
	URL      string `json:"url"`
	HasToken bool   `json:"hasToken"`
	Notify   bool   `json:"notify"`
}

// FlowRun is a run of a pipeline. Times are Unix milliseconds, 0 for not
// yet.
type FlowRun struct {
	ID         string `json:"id"`
	PipelineID string `json:"pipelineId"`
	Number     int    `json:"number"`
	// Status is pending, queued, running, waiting (for an approval),
	// success, failed, skipped or canceled.
	Status    string `json:"status"`
	Trigger   string `json:"trigger"` // manual, webhook, cron, api, rollback
	CreatedBy string `json:"createdBy,omitempty"`
	Commit    string `json:"commit,omitempty"`
	Remark    string `json:"remark,omitempty"`
	Created   int64  `json:"created"`
	Started   int64  `json:"started,omitempty"`
	Finished  int64  `json:"finished,omitempty"`
}

// FlowPipeline is a pipeline with its last runs, newest first.
type FlowPipeline struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Group       string    `json:"group,omitempty"`
	Description string    `json:"description,omitempty"`
	Archived    bool      `json:"archived,omitempty"`
	Favorite    bool      `json:"favorite,omitempty"`
	CanRun      bool      `json:"canRun"`
	Runs        []FlowRun `json:"runs"`
}

// FlowAlert is a run that failed, until the user looks at it.
type FlowAlert struct {
	RunID      string `json:"runId"`
	PipelineID string `json:"pipelineId"`
	Pipeline   string `json:"pipeline"`
	Number     int    `json:"number"`
	At         int64  `json:"at"`
}

// FlowState is what the tool knows of the server.
type FlowState struct {
	Configured bool           `json:"configured"`
	Pipelines  []FlowPipeline `json:"pipelines"`
	Error      string         `json:"error,omitempty"` // why the last fetch failed
	Checked    int64          `json:"checked,omitempty"`
	Alerts     []FlowAlert    `json:"alerts"`
}

// FlowStep is a step of a job.
type FlowStep struct {
	Name     string `json:"name"`
	Status   string `json:"status"`
	Started  int64  `json:"started,omitempty"`
	Finished int64  `json:"finished,omitempty"`
}

// FlowJob is a job of a run.
type FlowJob struct {
	ID       string            `json:"id"`
	Name     string            `json:"name"`
	Stage    string            `json:"stage"`
	Status   string            `json:"status"`
	ExitCode int               `json:"exitCode,omitempty"`
	Started  int64             `json:"started,omitempty"`
	Finished int64             `json:"finished,omitempty"`
	Steps    []FlowStep        `json:"steps"`
	Outputs  map[string]string `json:"outputs"`
}

// FlowRunDetail is a run with its jobs.
type FlowRunDetail struct {
	Run      FlowRun   `json:"run"`
	Pipeline string    `json:"pipeline"`
	Jobs     []FlowJob `json:"jobs"`
}

// FlowLog is a part of a job's log, and where the next part starts.
type FlowLog struct {
	Text string `json:"text"`
	Next int    `json:"next"`
	// Cut is whether the start was left out, the log being long.
	Cut bool `json:"cut,omitempty"`
}

// flowLogMax is how much of a log the page gets at first: the end of a
// long one.
const flowLogMax = 256 << 10

// Flow shows the user's Flow pipelines (https://flow.haowu.fun): their
// runs, logs and outputs, runs them, and tells when one fails.
type Flow struct {
	mu       sync.Mutex
	cfg      FlowConfig
	loaded   bool
	state    FlowState
	statuses map[string]string // the runs seen and their status, to tell which just failed
	primed   bool              // statuses holds a first fetch: what failed before is no news
	watching bool              // the page shows
	hidden   bool              // the window is in the tray, where its page still counts as shown
	focus    string            // a run the page is to show
	kick     chan struct{}

	onAlerts func(alerts []FlowAlert, fresh bool)
	open     func() // shows the tool's page
}

func (f *Flow) load() {
	if f.loaded {
		return
	}
	f.loaded = true
	f.cfg = FlowConfig{URL: "https://flow.haowu.fun", Notify: true}
	if err := readJSON("flow.json", &f.cfg); err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Println("flow:", err)
	}
	f.state = FlowState{Pipelines: []FlowPipeline{}, Alerts: []FlowAlert{}}
	f.state.Configured = f.cfg.Token != ""
	f.statuses = map[string]string{}
	f.kick = make(chan struct{}, 1)
}

// Config returns the server the tool talks to.
func (f *Flow) Config() FlowConfigView {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.load()
	return FlowConfigView{URL: f.cfg.URL, HasToken: f.cfg.Token != "", Notify: f.cfg.Notify}
}

// SetConfig checks the address and the token, an empty one keeping the
// last, with the server and keeps them. It returns the user's name.
func (f *Flow) SetConfig(address, token string, notify bool) (string, error) {
	address = strings.TrimRight(strings.TrimSpace(address), "/")
	token = strings.TrimSpace(token)
	if !strings.Contains(address, "://") {
		address = "https://" + address
	}
	u, err := url.Parse(address)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", errors.New("地址不对，要像 https://flow.haowu.fun 这样")
	}
	f.mu.Lock()
	f.load()
	cfg := f.cfg
	f.mu.Unlock()
	if token == "" {
		token = cfg.Token
	}
	if token == "" {
		return "", errors.New("要填 API 令牌")
	}
	var me struct {
		User struct {
			Username    string `json:"username"`
			DisplayName string `json:"display_name"`
		} `json:"user"`
	}
	if err := flowCall(FlowConfig{URL: address, Token: token}, "GET", "/api/me", nil, &me); err != nil {
		return "", err
	}
	f.mu.Lock()
	server := address != f.cfg.URL || token != f.cfg.Token
	f.cfg = FlowConfig{URL: address, Token: token, Notify: notify}
	if err := writeJSON("flow.json", f.cfg); err != nil {
		f.mu.Unlock()
		return "", err
	}
	f.state.Configured = true
	if server {
		// Another server or user: its runs are no news either.
		f.state.Pipelines, f.state.Error, f.state.Alerts = []FlowPipeline{}, "", []FlowAlert{}
		f.statuses, f.primed = map[string]string{}, false
	}
	if !notify {
		f.state.Alerts = []FlowAlert{}
	}
	f.changed(false)
	f.mu.Unlock()
	f.Refresh()
	name := me.User.DisplayName
	if name == "" {
		name = me.User.Username
	}
	return name, nil
}

// Disconnect forgets the token.
func (f *Flow) Disconnect() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.load()
	f.cfg.Token = ""
	f.state = FlowState{Pipelines: []FlowPipeline{}, Alerts: []FlowAlert{}}
	f.statuses, f.primed = map[string]string{}, false
	f.changed(false)
	return writeJSON("flow.json", f.cfg)
}

// State returns the pipelines as last fetched.
func (f *Flow) State() FlowState {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.load()
	return f.snapshot()
}

func (f *Flow) snapshot() FlowState {
	s := f.state
	s.Pipelines = slices.Clone(s.Pipelines)
	s.Alerts = slices.Clone(s.Alerts)
	return s
}

// Alerts returns the runs that failed and the user has not looked at.
func (f *Flow) Alerts() []FlowAlert {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.load()
	return slices.Clone(f.state.Alerts)
}

// Refresh fetches the pipelines now.
func (f *Flow) Refresh() {
	f.mu.Lock()
	f.load()
	kick := f.kick
	f.mu.Unlock()
	select {
	case kick <- struct{}{}:
	default:
	}
}

// Watch is told whether the page shows: the runs are fetched more often
// while it does.
func (f *Flow) Watch(on bool) {
	f.mu.Lock()
	f.load()
	f.watching = on
	f.mu.Unlock()
	if on {
		f.Refresh()
	}
}

// setHidden is told when the window goes to the tray or comes back.
func (f *Flow) setHidden(hidden bool) {
	f.mu.Lock()
	f.load()
	f.hidden = hidden
	f.mu.Unlock()
	if !hidden {
		f.Refresh()
	}
}

// changed tells the pages and the bubble. Call it with mu held.
func (f *Flow) changed(fresh bool) {
	FlowChanged.Broadcast(f.snapshot())
	if f.onAlerts != nil {
		alerts := slices.Clone(f.state.Alerts)
		go f.onAlerts(alerts, fresh)
	}
}

// watch fetches the pipelines every little while, as long as the app
// runs: more often while a run goes on or the page shows.
func (f *Flow) watch() {
	f.mu.Lock()
	f.load()
	kick := f.kick
	f.mu.Unlock()
	for {
		f.fetch()
		f.mu.Lock()
		wait := time.Minute
		if f.active() {
			wait = 10 * time.Second
		}
		if f.watching && !f.hidden {
			wait = min(wait, 15*time.Second)
			if f.active() {
				wait = 4 * time.Second
			}
		}
		f.mu.Unlock()
		select {
		case <-kick:
		case <-time.After(wait):
		}
	}
}

// active is whether a run goes on. Call it with mu held.
func (f *Flow) active() bool {
	for _, p := range f.state.Pipelines {
		for _, r := range p.Runs {
			if !flowDone(r.Status) {
				return true
			}
		}
	}
	return false
}

// flowDone is whether a run or job with the status has ended.
func flowDone(status string) bool {
	switch status {
	case "success", "failed", "skipped", "canceled":
		return true
	}
	return false
}

// fetch fetches the pipelines and their last runs, and notes the runs that
// just failed.
func (f *Flow) fetch() {
	f.mu.Lock()
	cfg := f.cfg
	f.mu.Unlock()
	if cfg.Token == "" {
		return
	}
	var raw []struct {
		ID          string       `json:"id"`
		Name        string       `json:"name"`
		Group       string       `json:"group"`
		Description string       `json:"description"`
		Archived    bool         `json:"archived"`
		Favorite    bool         `json:"favorite"`
		Permissions []string     `json:"permissions"`
		RecentRuns  []flowRawRun `json:"recent_runs"`
	}
	err := flowCall(cfg, "GET", "/api/pipelines/summary?runs=10", nil, &raw)
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.cfg != cfg {
		// Changed meanwhile: the next fetch is the new server's.
		return
	}
	f.state.Checked = time.Now().UnixMilli()
	if err != nil {
		f.state.Error = err.Error()
		f.changed(false)
		return
	}
	f.state.Error = ""
	pipelines := make([]FlowPipeline, 0, len(raw))
	statuses := map[string]string{}
	fresh := false
	for _, p := range raw {
		fp := FlowPipeline{ID: p.ID, Name: p.Name, Group: p.Group, Description: p.Description, Archived: p.Archived, Favorite: p.Favorite,
			CanRun: slices.Contains(p.Permissions, "run"), Runs: make([]FlowRun, 0, len(p.RecentRuns))}
		for _, r := range p.RecentRuns {
			run := r.run()
			fp.Runs = append(fp.Runs, run)
			was, seen := f.statuses[run.ID]
			statuses[run.ID] = run.Status
			if f.primed && cfg.Notify && run.Status == "failed" && was != "failed" && (seen || run.Finished > time.Now().Add(-time.Hour).UnixMilli()) &&
				!slices.ContainsFunc(f.state.Alerts, func(a FlowAlert) bool { return a.RunID == run.ID }) {
				f.state.Alerts = append(f.state.Alerts, FlowAlert{RunID: run.ID, PipelineID: p.ID, Pipeline: p.Name, Number: run.Number, At: run.Finished})
				fresh = true
			}
		}
		pipelines = append(pipelines, fp)
	}
	f.statuses, f.primed = statuses, true
	f.state.Pipelines = pipelines
	f.changed(fresh)
}

type flowRawRun struct {
	ID         string     `json:"id"`
	PipelineID string     `json:"pipeline_id"`
	Number     int        `json:"number"`
	Status     string     `json:"status"`
	Trigger    string     `json:"trigger"`
	CreatedBy  string     `json:"created_by"`
	Commit     string     `json:"commit"`
	Remark     string     `json:"remark"`
	CreatedAt  time.Time  `json:"created_at"`
	StartedAt  *time.Time `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at"`
}

func (r flowRawRun) run() FlowRun {
	return FlowRun{ID: r.ID, PipelineID: r.PipelineID, Number: r.Number, Status: r.Status, Trigger: r.Trigger, CreatedBy: r.CreatedBy,
		Commit: r.Commit, Remark: r.Remark, Created: r.CreatedAt.UnixMilli(), Started: unixMilli(r.StartedAt), Finished: unixMilli(r.FinishedAt)}
}

func unixMilli(t *time.Time) int64 {
	if t == nil {
		return 0
	}
	return t.UnixMilli()
}

// Detail returns a run with its jobs, and stops its alert: the user sees
// it.
func (f *Flow) Detail(runID string) (FlowRunDetail, error) {
	var raw struct {
		Run  flowRawRun `json:"run"`
		Jobs []struct {
			ID         string     `json:"id"`
			Name       string     `json:"name"`
			Stage      string     `json:"stage"`
			Status     string     `json:"status"`
			ExitCode   int        `json:"exit_code"`
			StartedAt  *time.Time `json:"started_at"`
			FinishedAt *time.Time `json:"finished_at"`
			Steps      []struct {
				Name string `json:"name"`
			} `json:"steps"`
			StepStates []struct {
				Status     string     `json:"status"`
				StartedAt  *time.Time `json:"started_at"`
				FinishedAt *time.Time `json:"finished_at"`
			} `json:"step_states"`
			Outputs map[string]string `json:"outputs"`
		} `json:"jobs"`
	}
	if err := flowCall(f.config(), "GET", "/api/runs/"+url.PathEscape(runID), nil, &raw); err != nil {
		return FlowRunDetail{}, err
	}
	d := FlowRunDetail{Run: raw.Run.run(), Jobs: make([]FlowJob, 0, len(raw.Jobs))}
	for _, j := range raw.Jobs {
		job := FlowJob{ID: j.ID, Name: j.Name, Stage: j.Stage, Status: j.Status, ExitCode: j.ExitCode,
			Started: unixMilli(j.StartedAt), Finished: unixMilli(j.FinishedAt), Steps: make([]FlowStep, len(j.Steps)), Outputs: j.Outputs}
		if job.Outputs == nil {
			job.Outputs = map[string]string{}
		}
		for i, s := range j.Steps {
			job.Steps[i] = FlowStep{Name: s.Name, Status: "pending"}
			if i < len(j.StepStates) {
				st := j.StepStates[i]
				job.Steps[i].Status, job.Steps[i].Started, job.Steps[i].Finished = st.Status, unixMilli(st.StartedAt), unixMilli(st.FinishedAt)
			}
		}
		d.Jobs = append(d.Jobs, job)
	}
	f.mu.Lock()
	for _, p := range f.state.Pipelines {
		if p.ID == d.Run.PipelineID {
			d.Pipeline = p.Name
		}
	}
	f.mu.Unlock()
	f.Ack(runID)
	return d, nil
}

// Log returns a job's log from offset on; from the start, only the end of
// a long one.
func (f *Flow) Log(jobID string, offset int) (FlowLog, error) {
	req, err := flowRequest(f.config(), "GET", "/api/jobs/"+url.PathEscape(jobID)+"/logs?offset="+strconv.Itoa(max(offset, 0)), nil)
	if err != nil {
		return FlowLog{}, err
	}
	resp, err := flowClient.Do(req)
	if err != nil {
		return FlowLog{}, friendlyNetError(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return FlowLog{}, flowError(resp)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return FlowLog{}, err
	}
	next, err := strconv.Atoi(resp.Header.Get("X-Next-Offset"))
	if err != nil {
		next = max(offset, 0) + len(data)
	}
	out := FlowLog{Next: next}
	if len(data) > flowLogMax {
		data, out.Cut = data[len(data)-flowLogMax:], true
		// Not in the middle of a character.
		for len(data) > 0 && !utf8.RuneStart(data[0]) {
			data = data[1:]
		}
	}
	out.Text = strings.ToValidUTF8(string(data), "�")
	return out, nil
}

// Trigger runs a pipeline, with its parameters' defaults.
func (f *Flow) Trigger(pipelineID, remark string) (FlowRun, error) {
	var d struct {
		Run flowRawRun `json:"run"`
	}
	body := map[string]any{}
	if remark = strings.TrimSpace(remark); remark != "" {
		body["remark"] = remark
	}
	if err := flowCall(f.config(), "POST", "/api/pipelines/"+url.PathEscape(pipelineID)+"/runs", body, &d); err != nil {
		return FlowRun{}, err
	}
	f.Refresh()
	return d.Run.run(), nil
}

// Cancel stops a run.
func (f *Flow) Cancel(runID string) error {
	err := flowCall(f.config(), "POST", "/api/runs/"+url.PathEscape(runID)+"/cancel", nil, nil)
	f.Refresh()
	return err
}

// Retry runs a run's failed jobs again.
func (f *Flow) Retry(runID string) error {
	err := flowCall(f.config(), "POST", "/api/runs/"+url.PathEscape(runID)+"/retry", nil, nil)
	f.Ack(runID)
	f.Refresh()
	return err
}

// Ack stops a failed run's alert.
func (f *Flow) Ack(runID string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.load()
	n := len(f.state.Alerts)
	f.state.Alerts = slices.DeleteFunc(f.state.Alerts, func(a FlowAlert) bool { return a.RunID == runID })
	if len(f.state.Alerts) != n {
		f.changed(false)
	}
}

// AckAll stops every alert.
func (f *Flow) AckAll() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.load()
	f.state.Alerts = []FlowAlert{}
	f.changed(false)
}

// Show shows a run in the tool's page, as the bubble asks.
func (f *Flow) Show(runID string) {
	f.mu.Lock()
	f.focus = runID
	f.mu.Unlock()
	if f.open != nil {
		f.open()
	}
	FlowFocus.Broadcast(runID)
}

// TakeFocus returns the run the page is to show, once.
func (f *Flow) TakeFocus() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	id := f.focus
	f.focus = ""
	return id
}

// Open opens a page of Flow, as "#/runs/<id>", or a link of a run's
// outputs in the browser.
func (f *Flow) Open(target string) error {
	if strings.HasPrefix(target, "#/") || target == "" {
		return mygo.Shell.OpenExternal(f.config().URL + "/" + target)
	}
	u, err := url.Parse(target)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return errors.New("不是网址：" + target)
	}
	return mygo.Shell.OpenExternal(target)
}

func (f *Flow) config() FlowConfig {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.load()
	return f.cfg
}

var flowClient = &http.Client{Timeout: 30 * time.Second}

func flowRequest(cfg FlowConfig, method, path string, body any) (*http.Request, error) {
	if cfg.Token == "" {
		return nil, errors.New("还没连接 Flow")
	}
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(context.Background(), method, cfg.URL+path, r)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.Token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return req, nil
}

// flowCall calls Flow's API and decodes the answer into out, unless nil.
func flowCall(cfg FlowConfig, method, path string, body, out any) error {
	req, err := flowRequest(cfg, method, path, body)
	if err != nil {
		return err
	}
	resp, err := flowClient.Do(req)
	if err != nil {
		return friendlyNetError(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return flowError(resp)
	}
	if out == nil {
		return nil
	}
	if strings.HasPrefix(resp.Header.Get("Content-Type"), "text/html") {
		return errors.New("返回的是网页，地址不对？")
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("读不懂 Flow 的回答：%w", err)
	}
	return nil
}

// flowError says why Flow refused, in its words when it gave some.
func flowError(resp *http.Response) error {
	var e struct {
		Error string `json:"error"`
	}
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	_ = json.Unmarshal(b, &e)
	switch {
	case resp.StatusCode == http.StatusUnauthorized:
		return errors.New("令牌无效或已过期，请在「连接」里换一个")
	case resp.StatusCode == http.StatusForbidden && e.Error != "":
		return errors.New("没有权限：" + e.Error)
	case e.Error != "":
		return errors.New(e.Error)
	}
	return fmt.Errorf("HTTP %d", resp.StatusCode)
}
