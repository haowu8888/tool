package main

import (
	"errors"
	"log"
	"net/url"
	"os"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// NotesChanged is sent with the new data whenever a todo or a note
// changes.
var NotesChanged = mygo.NewEvent[NotesData]("notesChanged")

// TodoAlertsChanged is sent with the ringing todos after every change, to
// the small windows: the floating ball and the reminder bubble have no
// use for the notes.
var TodoAlertsChanged = mygo.NewEvent[[]Todo]("todoAlertsChanged")

// Todo is a thing to do, maybe by a time.
type Todo struct {
	ID        string `json:"id"`
	Text      string `json:"text"`
	Detail    string `json:"detail,omitempty"`
	Done      bool   `json:"done,omitempty"`
	Important bool   `json:"important,omitempty"`
	// Due is a local date, 2026-11-12, or a date and time, 2026-11-12T15:00,
	// as the page's date inputs give them; empty for none. A todo with a
	// time is reminded of by a notification then.
	Due string `json:"due,omitempty"`
	// Repeat is how the todo comes again: day, weekday (Monday to Friday),
	// week, month or year; empty for once. Doing a repeating todo moves
	// its Due to the next time rather than marking it done, and one left
	// undone moves on by itself when its next time comes, to ring again.
	Repeat string `json:"repeat,omitempty"`
	// Snooze is when a repeating todo put off rings again, as Due; its Due
	// stays, for the times after.
	Snooze   string `json:"snooze,omitempty"`
	Reminded bool   `json:"reminded,omitempty"` // its time came while the app ran
	// Alert is whether it rings: its time came and the user has not done,
	// put off or dismissed it yet. The floating ball shows the ringing
	// ones.
	Alert bool `json:"alert,omitempty"`
	// Subs are the steps it takes, ticked off one by one.
	Subs []SubTask `json:"subs,omitempty"`
	// Images are pictures pasted into it, as notefile addresses.
	Images  []string `json:"images,omitempty"`
	Created int64    `json:"created"` // Unix milliseconds
	DoneAt  int64    `json:"doneAt,omitempty"`
}

// maxTodoImages caps a todo's pictures.
const maxTodoImages = 20

// SubTask is a step of a todo.
type SubTask struct {
	ID   string `json:"id"`
	Text string `json:"text"`
	Done bool   `json:"done,omitempty"`
}

// Note is a text; its first line is its title.
type Note struct {
	ID      string `json:"id"`
	Body    string `json:"body"`
	Pinned  bool   `json:"pinned,omitempty"`
	Created int64  `json:"created"`
	Updated int64  `json:"updated"`
}

// NotesData is the todos, newest first, and the notes.
type NotesData struct {
	Todos []Todo `json:"todos"`
	Notes []Note `json:"notes"`
}

// Notes keeps the todos and the notes in notes.json in the app's config
// folder, and reminds of the todos that are due.
type Notes struct {
	mu   sync.Mutex
	data *NotesData // loaded on first use
	// main is the toolbox's window, the only one that shows the notes
	// and gets them all with every change.
	main   *mygo.Window
	tellMu sync.Mutex // one telling of the alerts at a time, in order

	// onRemind, when set, is called when a reminder is clicked.
	onRemind func()
	// onAlerts, when set, is called with the ringing todos after every
	// change, and with fresh true when one started ringing.
	onAlerts func(alerts []Todo, fresh bool)
}

// List returns the todos and the notes.
func (n *Notes) List() (NotesData, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if err := n.load(); err != nil {
		return NotesData{}, err
	}
	return n.snapshot(), nil
}

// SaveTodo adds a todo, when it has no ID, or replaces the one with its
// ID. Changing its time reminds of it again.
func (n *Notes) SaveTodo(t Todo) (Todo, error) {
	t.Text = strings.TrimSpace(t.Text)
	t.Detail = strings.TrimSpace(t.Detail)
	if t.Text == "" {
		return Todo{}, errors.New("待办内容不能为空")
	}
	if t.Due != "" {
		if _, _, err := parseDue(t.Due); err != nil {
			return Todo{}, errors.New("日期格式不对：" + t.Due)
		}
	}
	if !slices.Contains([]string{"", "day", "weekday", "week", "month", "year"}, t.Repeat) {
		return Todo{}, errors.New("重复方式不对：" + t.Repeat)
	}
	if t.Repeat != "" && t.Due == "" {
		return Todo{}, errors.New("重复的待办要有日期")
	}
	subs := t.Subs[:0:0]
	for _, s := range t.Subs {
		s.Text = strings.TrimSpace(s.Text)
		if s.Text == "" {
			continue
		}
		if s.ID == "" {
			s.ID = newID()
		}
		subs = append(subs, s)
	}
	t.Subs = subs
	images := t.Images[:0:0]
	for _, u := range t.Images {
		if strings.HasPrefix(u, noteFileURL) && !slices.Contains(images, u) && len(images) < maxTodoImages {
			images = append(images, u)
		}
	}
	t.Images = images
	err := n.change(func(d *NotesData) error {
		now := time.Now().UnixMilli()
		if t.ID == "" {
			t.ID = newID()
			t.Created, t.Reminded, t.Snooze = now, false, ""
			// 每周五 9:00 written on a Friday at 10 starts next Friday.
			t.Due = repeatAfter(t.Due, t.Repeat, time.Now())
			// New todos go first, where the user looks.
			d.Todos = slices.Insert(d.Todos, 0, t)
			return nil
		}
		i := slices.IndexFunc(d.Todos, func(o Todo) bool { return o.ID == t.ID })
		if i < 0 {
			return errors.New("找不到这条待办")
		}
		old := d.Todos[i]
		t.Created = old.Created
		if t.Due != old.Due || t.Repeat != old.Repeat {
			t.Due = repeatAfter(t.Due, t.Repeat, time.Now())
		}
		same := old.Due == t.Due && old.Repeat == t.Repeat
		t.Reminded = old.Reminded && same
		t.Alert = old.Alert && same && !t.Done
		t.Snooze = ""
		if same {
			t.Snooze = old.Snooze
		}
		if t.Done && !old.Done && t.Repeat != "" {
			// Done this time: on to the next.
			t.Due = repeatAfter(nextRepeat(t.Due, t.Repeat), t.Repeat, time.Now())
			t.Done, t.Reminded, t.Alert, t.Snooze = false, false, false, ""
			// The steps start over, for the next time.
			for i := range t.Subs {
				t.Subs[i].Done = false
			}
		}
		// Done as a whole: its steps are done too.
		if t.Done && !old.Done {
			for i := range t.Subs {
				t.Subs[i].Done = true
			}
		}
		switch {
		case !t.Done:
			t.DoneAt = 0
		case !old.Done:
			t.DoneAt = now
		default:
			t.DoneAt = old.DoneAt
		}
		d.Todos[i] = t
		return nil
	})
	return t, err
}

// Snooze puts a todo off: it rings again in minutes.
func (n *Notes) Snooze(id string, minutes int) error {
	if minutes <= 0 {
		return errors.New("时间不对")
	}
	return n.change(func(d *NotesData) error {
		for i := range d.Todos {
			if d.Todos[i].ID == id {
				t := &d.Todos[i]
				at := time.Now().Add(time.Duration(minutes) * time.Minute).Format("2006-01-02T15:04")
				if t.Repeat != "" {
					t.Snooze = at
				} else {
					t.Due = at
				}
				t.Reminded, t.Alert = false, false
				return nil
			}
		}
		return errors.New("找不到这条待办")
	})
}

// Dismiss stops a todo ringing, or every one when id is empty.
func (n *Notes) Dismiss(id string) error {
	return n.change(func(d *NotesData) error {
		for i := range d.Todos {
			if id == "" || d.Todos[i].ID == id {
				d.Todos[i].Alert = false
			}
		}
		return nil
	})
}

// DeleteTodo removes a todo.
func (n *Notes) DeleteTodo(id string) error {
	return n.change(func(d *NotesData) error {
		d.Todos = slices.DeleteFunc(d.Todos, func(t Todo) bool { return t.ID == id })
		return nil
	})
}

// RestoreTodo puts a deleted todo back as it was, where it was among the
// others: the undoing of DeleteTodo. It does not ring again for a time
// it was reminded of already.
func (n *Notes) RestoreTodo(t Todo, at int) error {
	if t.ID == "" || t.Text == "" {
		return errors.New("恢复不了这条待办")
	}
	return n.change(func(d *NotesData) error {
		if slices.ContainsFunc(d.Todos, func(o Todo) bool { return o.ID == t.ID }) {
			return nil
		}
		d.Todos = slices.Insert(d.Todos, min(max(at, 0), len(d.Todos)), t)
		return nil
	})
}

// ClearDone removes the todos that are done and returns how many.
func (n *Notes) ClearDone() (int, error) {
	removed := 0
	err := n.change(func(d *NotesData) error {
		before := len(d.Todos)
		d.Todos = slices.DeleteFunc(d.Todos, func(t Todo) bool { return t.Done })
		removed = before - len(d.Todos)
		return nil
	})
	return removed, err
}

// SaveNote adds a note, when it has no ID, or replaces the one with its ID.
func (n *Notes) SaveNote(note Note) (Note, error) {
	err := n.change(func(d *NotesData) error {
		now := time.Now().UnixMilli()
		note.Updated = now
		if note.ID == "" {
			note.ID = newID()
			note.Created = now
			d.Notes = append(d.Notes, note)
			return nil
		}
		i := slices.IndexFunc(d.Notes, func(o Note) bool { return o.ID == note.ID })
		if i < 0 {
			return errors.New("找不到这篇笔记")
		}
		note.Created = d.Notes[i].Created
		if note.Body == d.Notes[i].Body {
			// Pinning does not make a note newer.
			note.Updated = d.Notes[i].Updated
		}
		d.Notes[i] = note
		return nil
	})
	return note, err
}

// OpenURL opens a note's link in the browser.
func (n *Notes) OpenURL(link string) error {
	u, err := url.Parse(link)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "mailto") {
		return errors.New("不是网址：" + link)
	}
	return mygo.Shell.OpenExternal(link)
}

// DeleteNote removes a note.
func (n *Notes) DeleteNote(id string) error {
	return n.change(func(d *NotesData) error {
		d.Notes = slices.DeleteFunc(d.Notes, func(o Note) bool { return o.ID == id })
		return nil
	})
}

// watch shows a notification for every todo whose time has come, now and
// every 15 seconds. One that came more than a day ago, while the app was
// not running, is only marked as reminded.
func (n *Notes) watch() {
	mygo.App.OnNotificationClick(func(id string) {
		if strings.HasPrefix(id, "todo-") && n.onRemind != nil {
			n.onRemind()
		}
	})
	clean := time.Now().Add(time.Minute)
	for {
		n.remind(time.Now())
		if time.Now().After(clean) {
			n.cleanFiles()
			clean = time.Now().Add(12 * time.Hour)
		}
		time.Sleep(15 * time.Second)
	}
}

func (n *Notes) remind(now time.Time) {
	var due []Todo
	changed := false
	err := n.change(func(d *NotesData) error {
		for i := range d.Todos {
			t := &d.Todos[i]
			if t.Done || t.Due == "" {
				continue
			}
			// A repeating todo left undone moves on to its latest time,
			// which rings again.
			if latest := repeatLatest(t.Due, t.Repeat, now); latest != t.Due {
				t.Due, t.Snooze, t.Reminded, t.Alert = latest, "", false, false
				changed = true
			}
			if t.Reminded {
				continue
			}
			when := t.Due
			if t.Snooze != "" {
				when = t.Snooze
			}
			at, hasTime, err := parseDue(when)
			if err != nil || !hasTime || at.After(now) {
				continue
			}
			t.Reminded = true
			if now.Sub(at) < 24*time.Hour {
				t.Alert = true
				due = append(due, *t)
			}
		}
		if len(due) == 0 && !changed {
			return errNoChange
		}
		return nil
	})
	if err != nil && !errors.Is(err, errNoChange) {
		log.Println("notes:", err)
	}
	if len(due) > 0 {
		n.alerts(true)
	}
	// System notifications too, which Windows may have turned off.
	for _, t := range due {
		body := "到时间了"
		if t.Detail != "" {
			body = t.Detail
		}
		err := mygo.NewNotification(mygo.NotificationOptions{ID: "todo-" + t.ID, Title: "⏰ " + t.Text, Body: body}).Show()
		if err != nil {
			log.Println("notify:", err)
		}
	}
}

// errNoChange tells change to leave the file and the page be.
var errNoChange = errors.New("no change")

// parseDue reads a Todo's Due as a local time, and whether it has a time
// of day.
func parseDue(s string) (time.Time, bool, error) {
	if t, err := time.ParseInLocation("2006-01-02T15:04", s, time.Local); err == nil {
		return t, true, nil
	}
	t, err := time.ParseInLocation("2006-01-02", s, time.Local)
	return t, false, err
}

// nextRepeat is the time after due, a Todo's Due, that a todo repeating
// so comes again, in the same form; a month on from 1月31日 is 2月28日.
func nextRepeat(due, repeat string) string {
	at, hasTime, err := parseDue(due)
	if err != nil {
		return due
	}
	switch repeat {
	case "day":
		at = at.AddDate(0, 0, 1)
	case "weekday":
		at = at.AddDate(0, 0, 1)
		for at.Weekday() == time.Saturday || at.Weekday() == time.Sunday {
			at = at.AddDate(0, 0, 1)
		}
	case "week":
		at = at.AddDate(0, 0, 7)
	case "month", "year":
		months := 1
		if repeat == "year" {
			months = 12
		}
		first := time.Date(at.Year(), at.Month()+time.Month(months), 1, at.Hour(), at.Minute(), 0, 0, time.Local)
		last := first.AddDate(0, 1, -1).Day()
		at = first.AddDate(0, 0, min(at.Day(), last)-1)
	default:
		return due
	}
	if hasTime {
		return at.Format("2006-01-02T15:04")
	}
	return at.Format("2006-01-02")
}

// dueCame is whether due's time, or its day for a date, has come by now;
// with passed, whether it went: a date's day is over.
func dueCame(due string, now time.Time, passed bool) bool {
	at, hasTime, err := parseDue(due)
	if err != nil {
		return false
	}
	if !hasTime {
		today := now.Format("2006-01-02")
		return due < today || !passed && due == today
	}
	return !at.After(now)
}

// repeatAfter moves due on, as its repeat says, till its time has not
// gone; due as it is when it does not repeat.
func repeatAfter(due, repeat string, now time.Time) string {
	for i := 0; repeat != "" && dueCame(due, now, true) && i < 100000; i++ {
		due = nextRepeat(due, repeat)
	}
	return due
}

// repeatLatest moves due on, as its repeat says, to its latest time that
// has come.
func repeatLatest(due, repeat string, now time.Time) string {
	for i := 0; repeat != "" && i < 100000; i++ {
		next := nextRepeat(due, repeat)
		if next == due || !dueCame(next, now, false) {
			break
		}
		due = next
	}
	return due
}

// change applies fn to the data, saves it and tells the page.
func (n *Notes) change(fn func(d *NotesData) error) error {
	n.mu.Lock()
	defer n.mu.Unlock()
	if err := n.load(); err != nil {
		return err
	}
	if err := fn(n.data); err != nil {
		return err
	}
	if err := writeJSON("notes.json", n.data); err != nil {
		return err
	}
	if n.main != nil {
		NotesChanged.Emit(n.main, n.snapshot())
	} else {
		NotesChanged.Broadcast(n.snapshot())
	}
	TodoAlertsChanged.Broadcast(n.ringing())
	go n.alerts(false)
	return nil
}

// ringing returns the todos that ring. Call it with mu held.
func (n *Notes) ringing() []Todo {
	list := []Todo{}
	if n.data != nil {
		for _, t := range n.data.Todos {
			if t.Alert && !t.Done {
				list = append(list, t)
			}
		}
	}
	return list
}

// alerts tells onAlerts which todos ring.
func (n *Notes) alerts(fresh bool) {
	if n.onAlerts == nil {
		return
	}
	// One at a time, so that the last told is the latest.
	n.tellMu.Lock()
	defer n.tellMu.Unlock()
	n.mu.Lock()
	list := n.ringing()
	n.mu.Unlock()
	n.onAlerts(list, fresh)
}

// Alerts returns the ringing todos.
func (n *Notes) Alerts() ([]Todo, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if err := n.load(); err != nil {
		return nil, err
	}
	return n.ringing(), nil
}

func (n *Notes) snapshot() NotesData {
	return NotesData{Todos: slices.Clone(n.data.Todos), Notes: slices.Clone(n.data.Notes)}
}

// load reads the data the first time.
func (n *Notes) load() error {
	if n.data != nil {
		return nil
	}
	d := &NotesData{}
	if err := readJSON("notes.json", d); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if d.Todos == nil {
		d.Todos = []Todo{}
	}
	if d.Notes == nil {
		d.Notes = []Note{}
	}
	n.data = d
	return nil
}
