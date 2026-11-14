package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"os"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// LauncherChanged is sent with the new data whenever the apps or the
// categories change.
var LauncherChanged = mygo.NewEvent[LauncherData]("launcherChanged")

// LauncherSummoned is sent when the shortcut brings the launcher up.
var LauncherSummoned = mygo.NewEvent[bool]("launcherSummoned")

// LauncherCategory groups apps.
type LauncherCategory struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// LauncherApp is something the launcher starts: a program, a shortcut, a
// document, a folder or a URL.
type LauncherApp struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Path     string `json:"path"`
	Args     string `json:"args,omitempty"`
	Dir      string `json:"dir,omitempty"`      // the working directory; empty for the path's folder
	Category string `json:"category,omitempty"` // a category's ID; empty for none
	Admin    bool   `json:"admin,omitempty"`    // run as administrator
	Launches int    `json:"launches,omitempty"`
	LastUsed int64  `json:"lastUsed,omitempty"` // Unix milliseconds
}

// LauncherData is the categories in their order and the apps in theirs.
type LauncherData struct {
	Categories []LauncherCategory `json:"categories"`
	Apps       []LauncherApp      `json:"apps"`
}

// InstalledApp is an app found on the computer, which the user may add.
type InstalledApp struct {
	Name   string `json:"name"`
	Path   string `json:"path"`
	Source string `json:"source"` // where it was found: 开始菜单, 桌面 or 应用商店
}

// Launcher starts the apps the user keeps, sorted into categories, and
// stores them in launcher.json in the app's config folder.
type Launcher struct {
	mu    sync.Mutex
	data  *LauncherData // loaded on first use
	icons sync.Map      // path → data URL, "" when it has none

	// summoned is whether the shortcut brought the window up, so that
	// launching an app or Escape hides it again.
	summoned bool
	// hideWindow, when set, hides the toolbox window.
	hideWindow func()
}

var defaultCategories = []string{"常用", "系统工具", "开发", "办公"}

// List returns the categories and the apps.
func (l *Launcher) List() (LauncherData, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if err := l.load(); err != nil {
		return LauncherData{}, err
	}
	return l.snapshot(), nil
}

// SaveApp adds an app, when it has no ID, or replaces the one with its ID,
// keeping that one's launch count.
func (l *Launcher) SaveApp(app LauncherApp) (LauncherApp, error) {
	app.Name = strings.TrimSpace(app.Name)
	app.Path = strings.Trim(strings.TrimSpace(app.Path), `"`)
	if app.Name == "" || app.Path == "" {
		return LauncherApp{}, errors.New("名称和路径都要填")
	}
	err := l.change(func(d *LauncherData) error {
		if !l.hasCategory(app.Category) {
			app.Category = ""
		}
		if app.ID == "" {
			app.ID = newID()
			app.Launches, app.LastUsed = 0, 0
			d.Apps = append(d.Apps, app)
			return nil
		}
		i := l.appIndex(app.ID)
		if i < 0 {
			return errors.New("找不到这一项")
		}
		app.Launches, app.LastUsed = d.Apps[i].Launches, d.Apps[i].LastUsed
		d.Apps[i] = app
		return nil
	})
	return app, err
}

// AddApps adds several apps, leaving out those whose path is there
// already, and returns how many it added.
func (l *Launcher) AddApps(apps []LauncherApp) (int, error) {
	added := 0
	err := l.change(func(d *LauncherData) error {
		for _, a := range apps {
			a.Name = strings.TrimSpace(a.Name)
			if a.Name == "" || a.Path == "" || slices.ContainsFunc(d.Apps, func(b LauncherApp) bool { return strings.EqualFold(b.Path, a.Path) }) {
				continue
			}
			if !l.hasCategory(a.Category) {
				a.Category = ""
			}
			a.ID = newID()
			a.Launches, a.LastUsed = 0, 0
			d.Apps = append(d.Apps, a)
			added++
		}
		return nil
	})
	return added, err
}

// DeleteApp removes an app.
func (l *Launcher) DeleteApp(id string) error {
	return l.change(func(d *LauncherData) error {
		d.Apps = slices.DeleteFunc(d.Apps, func(a LauncherApp) bool { return a.ID == id })
		return nil
	})
}

// RestoreApp puts a deleted app back as it was, in front of the app with
// ID before, or last without it: the undoing of DeleteApp.
func (l *Launcher) RestoreApp(app LauncherApp, before string) error {
	if app.ID == "" || app.Name == "" || app.Path == "" {
		return errors.New("恢复不了这一项")
	}
	return l.change(func(d *LauncherData) error {
		if l.appIndex(app.ID) >= 0 {
			return nil
		}
		if !l.hasCategory(app.Category) {
			app.Category = ""
		}
		at := len(d.Apps)
		if i := l.appIndex(before); before != "" && i >= 0 {
			at = i
		}
		d.Apps = slices.Insert(d.Apps, at, app)
		return nil
	})
}

// MoveApp puts an app into a category, in front of the app with ID
// before, or at the category's end when before is empty.
func (l *Launcher) MoveApp(id, category, before string) error {
	return l.change(func(d *LauncherData) error {
		i := l.appIndex(id)
		if i < 0 {
			return errors.New("找不到这一项")
		}
		app := d.Apps[i]
		if l.hasCategory(category) {
			app.Category = category
		} else {
			app.Category = ""
		}
		d.Apps = slices.Delete(d.Apps, i, i+1)
		at := len(d.Apps)
		if j := l.appIndex(before); j >= 0 {
			at = j
		} else {
			// After the category's last app.
			for j := len(d.Apps) - 1; j >= 0; j-- {
				if d.Apps[j].Category == app.Category {
					at = j + 1
					break
				}
			}
		}
		d.Apps = slices.Insert(d.Apps, at, app)
		return nil
	})
}

// AddCategory adds a category at the end.
func (l *Launcher) AddCategory(name string) (LauncherCategory, error) {
	c := LauncherCategory{ID: newID(), Name: strings.TrimSpace(name)}
	if c.Name == "" {
		return c, errors.New("分类名不能为空")
	}
	return c, l.change(func(d *LauncherData) error {
		d.Categories = append(d.Categories, c)
		return nil
	})
}

// RenameCategory renames a category.
func (l *Launcher) RenameCategory(id, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return errors.New("分类名不能为空")
	}
	return l.change(func(d *LauncherData) error {
		for i := range d.Categories {
			if d.Categories[i].ID == id {
				d.Categories[i].Name = name
			}
		}
		return nil
	})
}

// DeleteCategory removes a category; its apps are left uncategorized.
func (l *Launcher) DeleteCategory(id string) error {
	return l.change(func(d *LauncherData) error {
		d.Categories = slices.DeleteFunc(d.Categories, func(c LauncherCategory) bool { return c.ID == id })
		for i := range d.Apps {
			if d.Apps[i].Category == id {
				d.Apps[i].Category = ""
			}
		}
		return nil
	})
}

// MoveCategory moves a category to an index of the list.
func (l *Launcher) MoveCategory(id string, index int) error {
	return l.change(func(d *LauncherData) error {
		i := slices.IndexFunc(d.Categories, func(c LauncherCategory) bool { return c.ID == id })
		if i < 0 {
			return errors.New("找不到这个分类")
		}
		c := d.Categories[i]
		d.Categories = slices.Delete(d.Categories, i, i+1)
		d.Categories = slices.Insert(d.Categories, max(0, min(index, len(d.Categories))), c)
		return nil
	})
}

// Launch starts an app, as administrator when admin is true or the app
// says so. After the shortcut brought the window up, it hides it again.
func (l *Launcher) Launch(id string, admin bool) error {
	l.mu.Lock()
	if err := l.load(); err != nil {
		l.mu.Unlock()
		return err
	}
	i := l.appIndex(id)
	if i < 0 {
		l.mu.Unlock()
		return errors.New("找不到这一项")
	}
	app := l.data.Apps[i]
	l.mu.Unlock()

	if err := shellExecute(app.Path, app.Args, app.Dir, admin || app.Admin); err != nil {
		return err
	}
	l.change(func(d *LauncherData) error {
		if i := l.appIndex(id); i >= 0 {
			d.Apps[i].Launches++
			d.Apps[i].LastUsed = time.Now().UnixMilli()
		}
		return nil
	})
	l.Dismiss()
	return nil
}

// Reveal shows an app's file in Explorer.
func (l *Launcher) Reveal(id string) error {
	l.mu.Lock()
	err := l.load()
	var path string
	if i := l.appIndex(id); err == nil && i >= 0 {
		path = expandEnv(l.data.Apps[i].Path)
	}
	l.mu.Unlock()
	if err != nil {
		return err
	}
	if _, err := os.Stat(path); err != nil {
		return errors.New("找不到这个文件：" + path)
	}
	mygo.Shell.ShowItemInFolder(path)
	return nil
}

// Icons returns the icons of paths as PNG data URLs, "" for those that
// have none.
func (l *Launcher) Icons(paths []string) map[string]string {
	icons := make(map[string]string, len(paths))
	for _, p := range paths {
		if v, ok := l.icons.Load(p); ok {
			icons[p] = v.(string)
			continue
		}
		url := ""
		if !strings.Contains(p, "://") {
			if png, err := mygo.Shell.FileIcon(expandEnv(p), 64); err == nil {
				url = "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)
			}
		}
		l.icons.Store(p, url)
		icons[p] = url
	}
	return icons
}

// Browse asks for a file, or a folder when folder is true, and returns its
// path, or "" when the user cancels.
func (l *Launcher) Browse(folder bool) (string, error) {
	opts := mygo.OpenDialogOptions{Title: "选择要启动的程序或文件", Directory: folder}
	if folder {
		opts.Title = "选择文件夹"
	} else {
		opts.Filters = []mygo.FileFilter{
			{Name: "程序和快捷方式", Extensions: []string{"exe", "lnk", "bat", "cmd", "url", "msc", "appref-ms"}},
			{Name: "所有文件", Extensions: []string{"*"}},
		}
	}
	paths, err := mygo.Dialog.Open(opts)
	if err != nil || len(paths) == 0 {
		return "", err
	}
	return paths[0], nil
}

// Installed lists the apps of the Start menu, the desktop and the Store.
func (l *Launcher) Installed() ([]InstalledApp, error) {
	return installedApps()
}

// Dismiss hides the window, should a shortcut have brought it up.
func (l *Launcher) Dismiss() {
	l.mu.Lock()
	summoned := l.summoned
	l.summoned = false
	l.mu.Unlock()
	if summoned && l.hideWindow != nil {
		l.hideWindow()
	}
}

// summon tells the page that the shortcut brought the window up.
func (l *Launcher) summon() {
	l.setSummoned()
	LauncherSummoned.Broadcast(true)
}

// setSummoned remembers that a shortcut brought the window up, so that
// Dismiss hides it again.
func (l *Launcher) setSummoned() {
	l.mu.Lock()
	l.summoned = true
	l.mu.Unlock()
}

// unsummon forgets that the shortcut brought the window up: the user
// switched to it otherwise.
func (l *Launcher) unsummon() {
	l.mu.Lock()
	l.summoned = false
	l.mu.Unlock()
}

// change applies fn to the data, saves it and tells the page.
func (l *Launcher) change(fn func(d *LauncherData) error) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if err := l.load(); err != nil {
		return err
	}
	if err := fn(l.data); err != nil {
		return err
	}
	if err := l.save(); err != nil {
		return err
	}
	LauncherChanged.Broadcast(l.snapshot())
	return nil
}

func (l *Launcher) snapshot() LauncherData {
	return LauncherData{Categories: slices.Clone(l.data.Categories), Apps: slices.Clone(l.data.Apps)}
}

func (l *Launcher) appIndex(id string) int {
	return slices.IndexFunc(l.data.Apps, func(a LauncherApp) bool { return a.ID == id })
}

func (l *Launcher) hasCategory(id string) bool {
	return slices.ContainsFunc(l.data.Categories, func(c LauncherCategory) bool { return c.ID == id })
}

// load reads the data the first time; without a file it starts with the
// default categories.
func (l *Launcher) load() error {
	if l.data != nil {
		return nil
	}
	d := &LauncherData{}
	if err := readJSON("launcher.json", d); errors.Is(err, os.ErrNotExist) {
		for _, name := range defaultCategories {
			d.Categories = append(d.Categories, LauncherCategory{ID: newID(), Name: name})
		}
	} else if err != nil {
		return err
	}
	if d.Categories == nil {
		d.Categories = []LauncherCategory{}
	}
	if d.Apps == nil {
		d.Apps = []LauncherApp{}
	}
	l.data = d
	return nil
}

func (l *Launcher) save() error {
	return writeJSON("launcher.json", l.data)
}

func newID() string {
	b := make([]byte, 6)
	rand.Read(b)
	return hex.EncodeToString(b)
}
