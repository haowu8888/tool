package main

import (
	"log"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// shortcutActions are the global shortcuts' actions, in the settings'
// order, with their default keys.
var shortcutActions = []struct{ id, action, keys string }{
	{"virtual", "断开 / 恢复物理屏", "CmdOrCtrl+Alt+B"},
	{"launcher", "调出快捷启动", "CmdOrCtrl+Alt+Space"},
	{"todo", "记一条待办", "CmdOrCtrl+Alt+N"},
	{"overlay", "显示 / 隐藏监控悬浮窗", "CmdOrCtrl+Alt+M"},
	{"shot", "截图", "CmdOrCtrl+Alt+A"},
	{"shotTranslate", "截图翻译", "CmdOrCtrl+Alt+T"},
	{"clipboard", "剪贴板历史", "CmdOrCtrl+Alt+V"},
}

// Hotkeys registers the global shortcuts as the settings say, and again
// whenever they change.
type Hotkeys struct {
	mu     sync.Mutex
	fns    map[string]func() // action → what it does
	on     map[string]string // action → the keys registered for it
	errs   map[string]string // action → why its keys could not be registered
	paused *time.Timer       // set while the settings page records keys
	last   []ShortcutSetting // the settings last applied
}

// handle sets what an action does.
func (h *Hotkeys) handle(id string, fn func()) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.fns == nil {
		h.fns, h.on, h.errs = map[string]func(){}, map[string]string{}, map[string]string{}
	}
	h.fns[id] = fn
}

// apply registers the shortcuts that are on and unregisters the others.
// Keys another app holds are tried again the next time.
func (h *Hotkeys) apply(list []ShortcutSetting) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.last = list
	if h.paused != nil || h.fns == nil {
		return
	}
	// Unregister first, so that two actions can swap their keys.
	var add []ShortcutSetting
	for _, s := range list {
		want := s.Keys
		if s.Disabled {
			want = ""
		}
		if h.on[s.ID] == want && h.errs[s.ID] == "" {
			continue
		}
		if old := h.on[s.ID]; old != "" {
			mygo.GlobalShortcut.Unregister(old)
		}
		delete(h.on, s.ID)
		delete(h.errs, s.ID)
		if want != "" {
			add = append(add, ShortcutSetting{ID: s.ID, Keys: want})
		}
	}
	for _, s := range add {
		fn := h.fns[s.ID]
		if fn == nil {
			continue
		}
		if err := mygo.GlobalShortcut.Register(s.Keys, fn); err != nil {
			log.Println("register", s.Keys+":", err)
			h.errs[s.ID] = err.Error()
		} else {
			h.on[s.ID] = s.Keys
		}
	}
}

// pause unregisters every shortcut while the settings page records new
// keys, so that pressing the keys of one records them rather than runs
// it. resume, or 20 seconds, registers them again.
func (h *Hotkeys) pause() {
	h.mu.Lock()
	if h.paused != nil {
		h.paused.Reset(20 * time.Second)
		h.mu.Unlock()
		return
	}
	h.paused = time.AfterFunc(20*time.Second, h.resume)
	for id, keys := range h.on {
		mygo.GlobalShortcut.Unregister(keys)
		delete(h.on, id)
	}
	h.mu.Unlock()
}

func (h *Hotkeys) resume() {
	h.mu.Lock()
	if h.paused == nil {
		h.mu.Unlock()
		return
	}
	h.paused.Stop()
	h.paused = nil
	list := h.last
	h.mu.Unlock()
	h.apply(list)
}

// status describes the shortcuts of the settings.
func (h *Hotkeys) status(list []ShortcutSetting) []ShortcutStatus {
	h.mu.Lock()
	defer h.mu.Unlock()
	var out []ShortcutStatus
	for _, s := range list {
		st := ShortcutStatus{ID: s.ID, Keys: s.Keys, Disabled: s.Disabled, Error: h.errs[s.ID]}
		for _, a := range shortcutActions {
			if a.id == s.ID {
				st.Action, st.Default = a.action, a.keys
			}
		}
		out = append(out, st)
	}
	return out
}

// normalizeShortcuts lists every action once, in order, with its default
// keys unless the user chose others.
func normalizeShortcuts(list []ShortcutSetting) []ShortcutSetting {
	out := make([]ShortcutSetting, 0, len(shortcutActions))
	for _, a := range shortcutActions {
		s := ShortcutSetting{ID: a.id, Keys: a.keys}
		for _, got := range list {
			if got.ID == a.id {
				s.Disabled = got.Disabled
				if strings.TrimSpace(got.Keys) != "" {
					s.Keys = strings.TrimSpace(got.Keys)
				}
			}
		}
		out = append(out, s)
	}
	return out
}

// sameKeys reports whether two accelerators are the same keys, as
// "CmdOrCtrl+Alt+B" and "ctrl+alt+b" are on Windows.
func sameKeys(a, b string) bool {
	canon := func(s string) string {
		return strings.ReplaceAll(strings.ToLower(s), "cmdorctrl", "ctrl")
	}
	return canon(a) == canon(b)
}
