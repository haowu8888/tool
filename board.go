package main

import (
	"encoding/json"
	"errors"
	"os"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/egoist/mygo"
)

// BoardChanged is sent with all the board's data whenever it changes.
var BoardChanged = mygo.NewEvent[BoardData]("boardChanged")

// boardStatuses are the columns, in their order.
var boardStatuses = []string{"backlog", "todo", "in_progress", "in_review", "blocked", "done"}

var boardPriorities = []string{"", "urgent", "high", "medium", "low"}

// BoardProject groups issues; so does a label, many to one issue.
type BoardProject struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

type BoardLabel struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

// BoardSub is one step of an issue's checklist.
type BoardSub struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Done  bool   `json:"done,omitempty"`
}

// BoardEvent is a line of an issue's activity: a comment, or a change of
// one of its fields from From to To.
type BoardEvent struct {
	ID   string `json:"id"`
	At   int64  `json:"at"`   // Unix milliseconds
	Kind string `json:"kind"` // created, comment, status, priority, project, due, title
	From string `json:"from,omitempty"`
	To   string `json:"to,omitempty"`
	Text string `json:"text,omitempty"` // a comment's
}

// BoardIssue is a card of the board.
type BoardIssue struct {
	ID       string       `json:"id"`
	Num      int          `json:"num"` // shown as #12
	Title    string       `json:"title"`
	Desc     string       `json:"desc,omitempty"`
	Status   string       `json:"status"`
	Priority string       `json:"priority,omitempty"`
	Project  string       `json:"project,omitempty"`
	Labels   []string     `json:"labels,omitempty"`
	Due      string       `json:"due,omitempty"` // 2026-11-12, local
	Subs     []BoardSub   `json:"subs,omitempty"`
	Created  int64        `json:"created"`
	Updated  int64        `json:"updated"`
	Done     int64        `json:"done,omitempty"` // when it became done
	Activity []BoardEvent `json:"activity,omitempty"`
}

// BoardData is everything of the board. The issues' order in Issues is
// their order in each column.
type BoardData struct {
	Next     int            `json:"next"` // the number of the next issue
	Projects []BoardProject `json:"projects"`
	Labels   []BoardLabel   `json:"labels"`
	Issues   []BoardIssue   `json:"issues"`
}

// maxActivity is how many lines of activity an issue keeps.
const maxActivity = 200

// Board is the kanban tool: issues in status columns, with projects and
// labels, stored in board.json in the app's config folder.
type Board struct {
	mu   sync.Mutex
	data *BoardData // loaded on first use
}

// List returns the board.
func (b *Board) List() (BoardData, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if err := b.load(); err != nil {
		return BoardData{}, err
	}
	return b.snapshot(), nil
}

// Create adds an issue at the top of its column.
func (b *Board) Create(in BoardIssue) (BoardIssue, error) {
	var out BoardIssue
	err := b.change(func(d *BoardData) error {
		is := BoardIssue{ID: newID(), Status: "todo"}
		if err := b.apply(&is, in); err != nil {
			return err
		}
		now := time.Now().UnixMilli()
		d.Next = max(d.Next, 1)
		is.Num, d.Next = d.Next, d.Next+1
		is.Created, is.Updated = now, now
		if is.Status == "done" {
			is.Done = now
		}
		is.Activity = []BoardEvent{{ID: newID(), At: now, Kind: "created"}}
		d.Issues = slices.Insert(d.Issues, b.top(is.Status), is)
		out = is
		return nil
	})
	return out, err
}

// Update replaces an issue's fields with in's, noting the changes in its
// activity; its comments and number stay.
func (b *Board) Update(in BoardIssue) error {
	return b.change(func(d *BoardData) error {
		i := b.index(in.ID)
		if i < 0 {
			return errors.New("找不到这个任务")
		}
		is := d.Issues[i]
		old := is
		if err := b.apply(&is, in); err != nil {
			return err
		}
		now := time.Now().UnixMilli()
		note := func(kind, from, to string) {
			if from != to {
				is.Activity = append(is.Activity, BoardEvent{ID: newID(), At: now, Kind: kind, From: from, To: to})
			}
		}
		note("title", old.Title, is.Title)
		note("status", old.Status, is.Status)
		note("priority", old.Priority, is.Priority)
		note("project", old.Project, is.Project)
		note("due", old.Due, is.Due)
		b.statusChanged(&is, old.Status, now)
		is.Updated = now
		trimActivity(&is)
		d.Issues[i] = is
		return nil
	})
}

// Move puts an issue in a column, in front of the issue with ID before,
// or at the column's end when before is empty.
func (b *Board) Move(id, status, before string) error {
	if !slices.Contains(boardStatuses, status) {
		return errors.New("没有这个状态")
	}
	return b.change(func(d *BoardData) error {
		i := b.index(id)
		if i < 0 {
			return errors.New("找不到这个任务")
		}
		is := d.Issues[i]
		if is.Status != status {
			now := time.Now().UnixMilli()
			is.Activity = append(is.Activity, BoardEvent{ID: newID(), At: now, Kind: "status", From: is.Status, To: status})
			old := is.Status
			is.Status = status
			b.statusChanged(&is, old, now)
			is.Updated = now
			trimActivity(&is)
		}
		d.Issues = slices.Delete(d.Issues, i, i+1)
		at := len(d.Issues)
		if j := b.index(before); before != "" && j >= 0 && before != id {
			at = j
		} else {
			for j := len(d.Issues) - 1; j >= 0; j-- {
				if d.Issues[j].Status == status {
					at = j + 1
					break
				}
			}
		}
		d.Issues = slices.Insert(d.Issues, at, is)
		return nil
	})
}

// Delete removes an issue.
func (b *Board) Delete(id string) error {
	return b.change(func(d *BoardData) error {
		d.Issues = slices.DeleteFunc(d.Issues, func(is BoardIssue) bool { return is.ID == id })
		return nil
	})
}

// Restore puts a deleted issue back as it was, in front of the issue
// with ID before, or last without it: the undoing of Delete.
func (b *Board) Restore(is BoardIssue, before string) error {
	if is.ID == "" || strings.TrimSpace(is.Title) == "" {
		return errors.New("恢复不了这个任务")
	}
	return b.change(func(d *BoardData) error {
		if b.index(is.ID) >= 0 {
			return nil
		}
		if !slices.Contains(boardStatuses, is.Status) {
			is.Status = "todo"
		}
		if !slices.ContainsFunc(d.Projects, func(p BoardProject) bool { return p.ID == is.Project }) {
			is.Project = ""
		}
		is.Labels = b.knownLabels(is.Labels)
		at := len(d.Issues)
		if i := b.index(before); before != "" && i >= 0 {
			at = i
		}
		d.Issues = slices.Insert(d.Issues, at, is)
		return nil
	})
}

// Comment adds a comment to an issue.
func (b *Board) Comment(id, text string) error {
	text = strings.TrimSpace(text)
	if text == "" {
		return errors.New("评论是空的")
	}
	return b.change(func(d *BoardData) error {
		i := b.index(id)
		if i < 0 {
			return errors.New("找不到这个任务")
		}
		is := &d.Issues[i]
		now := time.Now().UnixMilli()
		is.Activity = append(is.Activity, BoardEvent{ID: newID(), At: now, Kind: "comment", Text: text})
		is.Updated = now
		trimActivity(is)
		return nil
	})
}

// DeleteComment removes a comment of an issue.
func (b *Board) DeleteComment(id, comment string) error {
	return b.change(func(d *BoardData) error {
		i := b.index(id)
		if i < 0 {
			return errors.New("找不到这个任务")
		}
		d.Issues[i].Activity = slices.DeleteFunc(d.Issues[i].Activity, func(e BoardEvent) bool { return e.ID == comment && e.Kind == "comment" })
		return nil
	})
}

// SaveProject adds a project, when it has no ID, or renames and recolors
// the one with its ID.
func (b *Board) SaveProject(p BoardProject) (BoardProject, error) {
	p.Name = strings.TrimSpace(p.Name)
	if p.Name == "" {
		return p, errors.New("项目名称是空的")
	}
	err := b.change(func(d *BoardData) error {
		if p.ID == "" {
			p.ID = newID()
			d.Projects = append(d.Projects, p)
			return nil
		}
		i := slices.IndexFunc(d.Projects, func(q BoardProject) bool { return q.ID == p.ID })
		if i < 0 {
			return errors.New("找不到这个项目")
		}
		d.Projects[i] = p
		return nil
	})
	return p, err
}

// DeleteProject removes a project; its issues stay, without a project.
func (b *Board) DeleteProject(id string) error {
	return b.change(func(d *BoardData) error {
		d.Projects = slices.DeleteFunc(d.Projects, func(p BoardProject) bool { return p.ID == id })
		for i := range d.Issues {
			if d.Issues[i].Project == id {
				d.Issues[i].Project = ""
			}
		}
		return nil
	})
}

// SaveLabel adds a label, when it has no ID, or changes the one with its
// ID.
func (b *Board) SaveLabel(l BoardLabel) (BoardLabel, error) {
	l.Name = strings.TrimSpace(l.Name)
	if l.Name == "" {
		return l, errors.New("标签名称是空的")
	}
	err := b.change(func(d *BoardData) error {
		if l.ID == "" {
			l.ID = newID()
			d.Labels = append(d.Labels, l)
			return nil
		}
		i := slices.IndexFunc(d.Labels, func(m BoardLabel) bool { return m.ID == l.ID })
		if i < 0 {
			return errors.New("找不到这个标签")
		}
		d.Labels[i] = l
		return nil
	})
	return l, err
}

// DeleteLabel removes a label from the board and its issues.
func (b *Board) DeleteLabel(id string) error {
	return b.change(func(d *BoardData) error {
		d.Labels = slices.DeleteFunc(d.Labels, func(l BoardLabel) bool { return l.ID == id })
		for i := range d.Issues {
			d.Issues[i].Labels = slices.DeleteFunc(d.Issues[i].Labels, func(s string) bool { return s == id })
		}
		return nil
	})
}

// apply copies the fields the user edits from in to is, checking them.
func (b *Board) apply(is *BoardIssue, in BoardIssue) error {
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return errors.New("标题是空的")
	}
	if utf8.RuneCountInString(title) > 500 {
		return errors.New("标题太长了")
	}
	if in.Status != "" && !slices.Contains(boardStatuses, in.Status) {
		return errors.New("没有这个状态")
	}
	if !slices.Contains(boardPriorities, in.Priority) {
		return errors.New("没有这个优先级")
	}
	if in.Due != "" {
		if _, err := time.Parse(time.DateOnly, in.Due); err != nil {
			return errors.New("日期不对：" + in.Due)
		}
	}
	is.Title = title
	is.Desc = strings.TrimRight(in.Desc, " \t\r\n")
	if in.Status != "" {
		is.Status = in.Status
	}
	is.Priority = in.Priority
	is.Project = ""
	if slices.ContainsFunc(b.data.Projects, func(p BoardProject) bool { return p.ID == in.Project }) {
		is.Project = in.Project
	}
	is.Labels = b.knownLabels(in.Labels)
	is.Due = in.Due
	is.Subs = nil
	for _, s := range in.Subs {
		s.Title = strings.TrimSpace(s.Title)
		if s.Title == "" {
			continue
		}
		if s.ID == "" {
			s.ID = newID()
		}
		is.Subs = append(is.Subs, s)
	}
	return nil
}

// statusChanged keeps when an issue became done.
func (b *Board) statusChanged(is *BoardIssue, old string, now int64) {
	if is.Status == old {
		return
	}
	if is.Status == "done" {
		is.Done = now
	} else {
		is.Done = 0
	}
}

func (b *Board) knownLabels(ids []string) []string {
	var out []string
	for _, id := range ids {
		if !slices.Contains(out, id) && slices.ContainsFunc(b.data.Labels, func(l BoardLabel) bool { return l.ID == id }) {
			out = append(out, id)
		}
	}
	return out
}

func trimActivity(is *BoardIssue) {
	if n := len(is.Activity); n > maxActivity {
		is.Activity = slices.Clone(is.Activity[n-maxActivity:])
	}
}

// top is where an issue goes to be the first of its column.
func (b *Board) top(status string) int {
	if i := slices.IndexFunc(b.data.Issues, func(is BoardIssue) bool { return is.Status == status }); i >= 0 {
		return i
	}
	return len(b.data.Issues)
}

func (b *Board) index(id string) int {
	return slices.IndexFunc(b.data.Issues, func(is BoardIssue) bool { return is.ID == id })
}

// change applies fn to the data, saves it and tells the pages.
func (b *Board) change(fn func(d *BoardData) error) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if err := b.load(); err != nil {
		return err
	}
	// fn works on a copy, so that a failure leaves the data as it was.
	d := b.clone()
	saved := b.data
	b.data = &d
	if err := fn(b.data); err != nil {
		b.data = saved
		return err
	}
	if err := writeJSON("board.json", b.data); err != nil {
		b.data = saved
		return err
	}
	BoardChanged.Broadcast(b.snapshot())
	return nil
}

// clone copies the data deeply: issues hold slices the page's copy must
// not share.
func (b *Board) clone() BoardData {
	var d BoardData
	raw, _ := json.Marshal(b.data)
	json.Unmarshal(raw, &d)
	b.fill(&d)
	return d
}

func (b *Board) snapshot() BoardData { return b.clone() }

func (b *Board) fill(d *BoardData) {
	if d.Projects == nil {
		d.Projects = []BoardProject{}
	}
	if d.Labels == nil {
		d.Labels = []BoardLabel{}
	}
	if d.Issues == nil {
		d.Issues = []BoardIssue{}
	}
	d.Next = max(d.Next, 1)
}

// load reads the data the first time; without a file the board starts
// with a few labels.
func (b *Board) load() error {
	if b.data != nil {
		return nil
	}
	d := &BoardData{}
	if err := readJSON("board.json", d); errors.Is(err, os.ErrNotExist) {
		for _, l := range [][2]string{{"Bug", "#ef4444"}, {"功能", "#8b5cf6"}, {"改进", "#3b82f6"}} {
			d.Labels = append(d.Labels, BoardLabel{ID: newID(), Name: l[0], Color: l[1]})
		}
	} else if err != nil {
		return err
	}
	b.fill(d)
	for _, is := range d.Issues {
		d.Next = max(d.Next, is.Num+1)
	}
	b.data = d
	return nil
}
