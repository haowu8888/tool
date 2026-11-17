package main

import (
	"encoding/json"
	"errors"
	"log"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// SettingsChanged is sent with the new settings whenever they change.
var SettingsChanged = mygo.NewEvent[AppSettings]("settingsChanged")

// AppSettings are the user's choices, kept in settings.json.
type AppSettings struct {
	Theme       string `json:"theme"`       // system, light or dark
	CloseAction string `json:"closeAction"` // hide (to the tray) or quit
	// OpenAtLogin is the system's Run entry, not the file's.
	OpenAtLogin bool `json:"openAtLogin"`
	// StartHidden keeps the window in the tray when started at login.
	StartHidden bool           `json:"startHidden"`
	Widget      WidgetSettings `json:"widget"`
	// Tools gives the sidebar's order and hidden tools; tools it does not
	// list follow in their own order.
	Tools    []ToolSetting `json:"tools"`
	HomeTool string        `json:"homeTool"` // the tool the window opens with
	// Shortcuts are the global shortcuts, every one in order.
	Shortcuts []ShortcutSetting `json:"shortcuts"`
	// AI is the service the notes' AI writing uses.
	AI AISettings `json:"ai"`
	// Reminder is how ringing todos tell.
	Reminder ReminderSettings `json:"reminder"`
	// Monitor is the system monitor's, and its overlay's.
	Monitor MonitorSettings `json:"monitor"`
	// Shot is the screenshot tool's.
	Shot ShotSettings `json:"shot"`
	// Clipboard is the clipboard history's.
	Clipboard ClipSettings `json:"clipboard"`
	// Record is the screen recorder's.
	Record RecordSettings `json:"record"`
	// Update checks the cloud drive for a newer build.
	Update UpdateSettings `json:"update"`
	// Launcher is the quick launcher's.
	Launcher LauncherSettings `json:"launcher"`
}

// LauncherSettings are the quick launcher's.
type LauncherSettings struct {
	// HideAfterLaunch hides the window after an app is launched from it.
	HideAfterLaunch bool `json:"hideAfterLaunch"`
}

// MonitorSettings are the system monitor's.
type MonitorSettings struct {
	Interval int `json:"interval"` // milliseconds between samples
	// TempWarn is the temperature, °C, from which one shows red; from 15
	// below it shows yellow.
	TempWarn int `json:"tempWarn"`
	// SensorsURL is LibreHardwareMonitor's web server, which gives the
	// CPU's temperatures; empty not to ask it.
	SensorsURL string          `json:"sensorsUrl"`
	Overlay    OverlaySettings `json:"overlay"`
}

// OverlaySettings are the monitor overlay's: a small window on top with
// the numbers the user picks.
type OverlaySettings struct {
	Show bool `json:"show"`
	// Items are what it shows, in order: cpu, cpuTemp, cpuFreq, mem, gpu,
	// gpuTemp, diskTemp, net, disk, fan (guessed), battery.
	Items        []string `json:"items"`
	Vertical     bool     `json:"vertical"`
	Opacity      float64  `json:"opacity"`
	ClickThrough bool     `json:"clickThrough"` // clicks go to the windows below
	// X and Y are where it was dragged to; Placed is false until then.
	// Save keeps them as they are.
	X      int  `json:"x"`
	Y      int  `json:"y"`
	Placed bool `json:"placed"`
}

// ReminderSettings are the reminder bubble's.
type ReminderSettings struct {
	// AutoHide is how many minutes the bubble shows before it folds away,
	// leaving the ball's red badge; 0 keeps it.
	AutoHide int  `json:"autoHide"`
	Sound    bool `json:"sound"` // a chime when a todo starts ringing
}

// WidgetSettings are the floating ball's.
type WidgetSettings struct {
	Show    bool    `json:"show"`
	Size    int     `json:"size"`    // the ball's diameter in DIPs
	Opacity float64 `json:"opacity"` // 0.3 to 1
	// Snap sticks a dropped ball to a near left or right screen edge.
	Snap bool `json:"snap"`
	// Tuck hides half of a stuck ball behind the edge until the pointer
	// comes over it.
	Tuck bool `json:"tuck"`
	// X and Y are the window's position, kept by dragging it; Placed is
	// false until then. Save keeps them as they are.
	X      int  `json:"x"`
	Y      int  `json:"y"`
	Placed bool `json:"placed"`
}

// ToolSetting is a tool of the sidebar.
type ToolSetting struct {
	ID     string `json:"id"`
	Hidden bool   `json:"hidden,omitempty"`
}

// ShortcutSetting is a global shortcut's keys, as "CmdOrCtrl+Alt+B", and
// whether the user turned it off.
type ShortcutSetting struct {
	ID       string `json:"id"`
	Keys     string `json:"keys"`
	Disabled bool   `json:"disabled,omitempty"`
}

// ShortcutStatus is a global shortcut and whether it works.
type ShortcutStatus struct {
	ID       string `json:"id"`
	Action   string `json:"action"`
	Keys     string `json:"keys"`
	Default  string `json:"default"`
	Disabled bool   `json:"disabled"`
	Error    string `json:"error,omitempty"` // why it could not be registered
}

// UpdateSettings are the settings of updates.
type UpdateSettings struct {
	Auto bool `json:"auto"` // check a minute after the start and every six hours
}

// AboutInfo describes the app for the settings page.
type AboutInfo struct {
	Version string `json:"version"`
	DataDir string `json:"dataDir"`
}

var defaultSettings = AppSettings{
	Theme:       "system",
	CloseAction: "hide",
	StartHidden: true,
	Widget:      WidgetSettings{Size: 56, Opacity: 0.9, Snap: true, Tuck: true},
	Reminder:    ReminderSettings{AutoHide: 3, Sound: true},
	Clipboard:   ClipSettings{Max: 300},
	Monitor: MonitorSettings{
		Interval:   1000,
		TempWarn:   85,
		SensorsURL: "http://127.0.0.1:8085",
		Overlay:    OverlaySettings{Items: []string{"cpu", "cpuTemp", "mem", "gpu", "diskTemp", "net"}, Opacity: 0.9},
	},
	Shot:     ShotSettings{To: "auto", Engine: "auto"},
	Record:   RecordSettings{FPS: 30, Cursor: true, Sound: true},
	Update:   UpdateSettings{Auto: true},
	Launcher: LauncherSettings{HideAfterLaunch: true},
	Tools:    []ToolSetting{},
}

// Settings keeps the settings and applies them.
type Settings struct {
	mu      sync.Mutex
	s       *AppSettings
	hotkeys *Hotkeys

	// onChange, when set, is called after the settings changed.
	onChange func(s AppSettings)
}

// Get returns the settings.
func (st *Settings) Get() AppSettings {
	s := st.current()
	s.OpenAtLogin = mygo.App.OpenAtLogin()
	return s
}

// Save replaces the settings, but for the floating ball's position.
func (st *Settings) Save(s AppSettings) error {
	s.Shortcuts = normalizeShortcuts(s.Shortcuts)
	for i, a := range s.Shortcuts {
		for _, b := range s.Shortcuts[:i] {
			if !a.Disabled && !b.Disabled && sameKeys(a.Keys, b.Keys) {
				return errors.New("两个操作用了同一个快捷键：" + strings.Replace(a.Keys, "CmdOrCtrl", "Ctrl", 1))
			}
		}
	}
	if s.OpenAtLogin != mygo.App.OpenAtLogin() {
		if err := mygo.App.SetOpenAtLogin(s.OpenAtLogin); err != nil {
			return err
		}
	}
	return st.change(func(cur *AppSettings) {
		w, o := cur.Widget, cur.Monitor.Overlay
		*cur = s
		cur.Widget.X, cur.Widget.Y, cur.Widget.Placed = w.X, w.Y, w.Placed
		cur.Monitor.Overlay.X, cur.Monitor.Overlay.Y, cur.Monitor.Overlay.Placed = o.X, o.Y, o.Placed
	})
}

// Shortcuts lists the global shortcuts and whether they work.
func (st *Settings) Shortcuts() []ShortcutStatus {
	return st.hotkeys.status(st.current().Shortcuts)
}

// PauseShortcuts turns the global shortcuts off while the page records
// new keys, and on again; they come back by themselves after 20 seconds.
func (st *Settings) PauseShortcuts(pause bool) {
	if pause {
		st.hotkeys.pause()
	} else {
		st.hotkeys.resume()
	}
}

// About returns the version and the data folder.
func (st *Settings) About() AboutInfo {
	dir, _ := configPath("")
	return AboutInfo{Version: mygo.App.Version(), DataDir: dir}
}

// OpenDataFolder shows the folder of the settings and the launcher's data.
func (st *Settings) OpenDataFolder() error {
	dir, err := configPath("")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return mygo.Shell.OpenPath(dir)
}

// ResetWidget puts the floating ball back in its first place.
func (st *Settings) ResetWidget() error {
	return st.change(func(s *AppSettings) { s.Widget.Placed = false })
}

// placeOverlay keeps where the monitor overlay was dragged to.
func (st *Settings) placeOverlay(x, y int) {
	st.change(func(s *AppSettings) { s.Monitor.Overlay.X, s.Monitor.Overlay.Y, s.Monitor.Overlay.Placed = x, y, true })
}

// placeWidget keeps where the floating ball was dragged to.
func (st *Settings) placeWidget(x, y int) {
	st.change(func(s *AppSettings) { s.Widget.X, s.Widget.Y, s.Widget.Placed = x, y, true })
}

// current returns the settings, the defaults when they cannot be read.
func (st *Settings) current() AppSettings {
	st.mu.Lock()
	defer st.mu.Unlock()
	st.load()
	return st.snapshot()
}

func (st *Settings) snapshot() AppSettings {
	s := *st.s
	s.Tools = slices.Clone(s.Tools)
	s.Shortcuts = slices.Clone(s.Shortcuts)
	s.Monitor.Overlay.Items = slices.Clone(s.Monitor.Overlay.Items)
	s.Clipboard.Exclude = slices.Clone(s.Clipboard.Exclude)
	return s
}

// update changes the settings in one step, as a menu item does: nothing
// another change made meanwhile is lost.
func (st *Settings) update(fn func(s *AppSettings)) {
	if err := st.change(fn); err != nil {
		log.Println("settings:", err)
	}
}

// change applies fn to the settings, saves them, applies them and tells
// the pages.
func (st *Settings) change(fn func(s *AppSettings)) error {
	st.mu.Lock()
	st.load()
	fn(st.s)
	normalize(st.s)
	err := writeJSON("settings.json", st.s)
	s := st.snapshot()
	st.mu.Unlock()
	if err != nil {
		return err
	}
	applyTheme(s.Theme)
	s.OpenAtLogin = mygo.App.OpenAtLogin()
	SettingsChanged.Broadcast(s)
	if st.onChange != nil {
		st.onChange(s)
	}
	return nil
}

// load reads the file the first time.
func (st *Settings) load() {
	if st.s != nil {
		return
	}
	s := defaultSettings
	s.Tools = []ToolSetting{}
	// Its own, or reading the file would write the file's over the defaults'.
	s.Monitor.Overlay.Items = slices.Clone(s.Monitor.Overlay.Items)
	if err := readJSON("settings.json", &s); err != nil && !errors.Is(err, os.ErrNotExist) {
		// Unreadable: run with what it gave and the defaults for the rest.
		log.Println("settings:", err)
	}
	normalize(&s)
	st.s = &s
}

// normalize replaces what is out of range with the defaults.
func normalize(s *AppSettings) {
	if !slices.Contains([]string{"system", "light", "dark"}, s.Theme) {
		s.Theme = defaultSettings.Theme
	}
	if s.CloseAction != "quit" {
		s.CloseAction = "hide"
	}
	if s.Widget.Size < 36 || s.Widget.Size > 96 {
		s.Widget.Size = defaultSettings.Widget.Size
	}
	s.Widget.Opacity = min(max(s.Widget.Opacity, 0.3), 1)
	if s.Tools == nil {
		s.Tools = []ToolSetting{}
	}
	s.Shortcuts = normalizeShortcuts(s.Shortcuts)
	s.Reminder.AutoHide = min(max(s.Reminder.AutoHide, 0), 60)
	normalizeClipSettings(&s.Clipboard)
	if !slices.Contains([]int{15, 30, 60}, s.Record.FPS) {
		s.Record.FPS = defaultSettings.Record.FPS
	}
	if !slices.Contains([]int{500, 1000, 2000, 5000}, s.Monitor.Interval) {
		s.Monitor.Interval = defaultSettings.Monitor.Interval
	}
	if s.Monitor.TempWarn < 50 || s.Monitor.TempWarn > 110 {
		s.Monitor.TempWarn = defaultSettings.Monitor.TempWarn
	}
	s.Monitor.SensorsURL = strings.TrimSpace(s.Monitor.SensorsURL)
	// LibreHardwareMonitor listens on 127.0.0.1 only, and its server
	// refuses requests for another host name, as localhost.
	if s.Monitor.SensorsURL == "http://localhost:8085" {
		s.Monitor.SensorsURL = defaultSettings.Monitor.SensorsURL
	}
	if s.Monitor.Overlay.Items == nil {
		s.Monitor.Overlay.Items = slices.Clone(defaultSettings.Monitor.Overlay.Items)
	}
	if s.Monitor.Overlay.Opacity == 0 {
		s.Monitor.Overlay.Opacity = defaultSettings.Monitor.Overlay.Opacity
	}
	s.Monitor.Overlay.Opacity = min(max(s.Monitor.Overlay.Opacity, 0.3), 1)
	for _, ai := range []*AISettings{&s.AI, &s.Shot.AI} {
		ai.BaseURL = strings.TrimSpace(ai.BaseURL)
		ai.APIKey = strings.TrimSpace(ai.APIKey)
		ai.Model = strings.TrimSpace(ai.Model)
	}
}

// applyTheme makes the windows light, dark or follow the system.
func applyTheme(theme string) {
	mygo.Theme.SetSource(mygo.ThemeSource(theme))
}

// configPath is a file of the app's data folder, or the folder itself.
func configPath(name string) (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "Toolbox", name), nil
}

// writeJSON writes a data file through a temporary file, so that a crash
// leaves the old file whole. The file as it was is kept as .bak first, once
// a day, for readJSON to fall back on.
func writeJSON(name string, v any) error { return writeData(name, v, true) }

// writeJSONOnce writes a data file without keeping a backup of the old
// one: for what the user expects gone once deleted, as the clipboard
// history.
func writeJSONOnce(name string, v any) error { return writeData(name, v, false) }

func writeData(name string, v any, keep bool) error {
	p, err := configPath(name)
	if err != nil {
		return err
	}
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	if keep {
		backup(p)
	}
	return writeFile(p, b)
}

// readJSON reads a data file into v. A damaged file, as one cut short when
// the power went, gives way to its backup and is kept as .broken. Without
// the file the error is os.ErrNotExist.
func readJSON(name string, v any) error {
	p, err := configPath(name)
	if err != nil {
		return err
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return err
	}
	err = json.Unmarshal(b, v)
	if err == nil {
		return nil
	}
	bak, berr := os.ReadFile(p + ".bak")
	if berr != nil || json.Unmarshal(bak, v) != nil {
		return err
	}
	log.Printf("%s is damaged (%v): using its backup", name, err)
	if err := writeFile(p+".broken", b); err != nil {
		log.Println("keep the damaged file:", err)
	}
	return nil
}

// backup keeps a data file as .bak, unless a backup of the last day is
// there, or the file is damaged and the backup the better one.
func backup(p string) {
	if st, err := os.Stat(p + ".bak"); err == nil && time.Since(st.ModTime()) < 24*time.Hour {
		return
	}
	b, err := os.ReadFile(p)
	if err != nil || !json.Valid(b) {
		return
	}
	if err := writeFile(p+".bak", b); err != nil {
		log.Println("backup:", err)
	}
}

// writeFile replaces a file with b: written beside it and on the disk
// before it takes the file's name, so that a crash or the power going
// leaves the old file or the new one, never a part.
func writeFile(p string, b []byte) error {
	f, err := os.Create(p + ".tmp")
	if err != nil {
		return err
	}
	_, err = f.Write(b)
	if err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(f.Name())
		return err
	}
	return os.Rename(f.Name(), p)
}
