package main

import (
	_ "embed"
	"fmt"
	"log"
	"strings"
	"sync/atomic"
	"time"

	"github.com/egoist/mygo"
)

//go:embed assets/tray.png
var trayIcon []byte

// appQuitting is set once the app starts to quit. The windows kept hidden
// for the next time, which turn their closing into hiding, close then:
// one that refuses cancels the quit.
var appQuitting atomic.Bool

func main() {
	// One instance only: a second one would write its own copy of the data
	// files over the first's, and bring back displays the first detached.
	// It hands over to the first, which shows its window, and ends.
	if !mygo.App.RequestSingleInstanceLock() {
		return
	}
	logToFile()

	virtual := NewVirtualScreen()
	launcher := &Launcher{}
	hotkeys := &Hotkeys{}
	settings := &Settings{hotkeys: hotkeys}
	launcher.settings = settings
	widget := &Widget{settings: settings}
	notes := &Notes{}
	reminder := &Reminder{widget: widget, settings: settings}
	ai := &AI{settings: settings}
	monitor := &Monitor{settings: settings}
	overlay := &Overlay{settings: settings, monitor: monitor}
	shot := &Shot{settings: settings}
	record := &Record{shot: shot, settings: settings}
	shot.rec = record
	clips := &Clips{settings: settings}
	services := &Services{}
	flow := &Flow{}
	dev := &Dev{shot: shot}
	board := &Board{}
	updates := &Updates{settings: settings}
	mygo.Bind(virtual)
	mygo.Bind(launcher)
	mygo.Bind(notes)
	mygo.Bind(settings)
	mygo.Bind(widget)
	mygo.Bind(reminder)
	mygo.Bind(ai)
	mygo.Bind(monitor)
	mygo.Bind(overlay)
	mygo.Bind(shot)
	mygo.Bind(record)
	mygo.Bind(clips)
	mygo.Bind(services)
	mygo.Bind(flow)
	mygo.Bind(dev)
	mygo.Bind(board)
	mygo.Bind(updates)

	// Notes' images and attachments, which windows load by URL.
	serveNoteFiles()
	// Screenshots and pinned pictures, which their windows load by URL.
	shot.serve()
	// The clipboard history's pictures.
	clips.serve()

	// Start in the saved appearance, without a flash of the other.
	prefs := settings.Get()
	applyTheme(prefs.Theme)

	// The displays the virtual display replaced come back however the app
	// ends, and after a crash with the next launch.
	restoreDisplaysLeftOver()
	mygo.App.OnQuit(func() {
		virtual.stop(nil)
		record.quit()
	})

	mygo.App.WhenReady(func() {
		// Started at login, it waits in the tray if the user wants so.
		hidden := prefs.StartHidden && mygo.App.WasOpenedAtLogin()
		win := mygo.NewWindow(mygo.WindowOptions{
			Title:           "工具箱",
			Width:           920,
			Height:          620,
			MinWidth:        560,
			MinHeight:       420,
			BackgroundColor: "light-dark(#f6f7f9, #0f1115)", // the page's --bg in src/style.css
			StateKey:        "main",
			URL:             "/",
			// The reminder bubble chimes before anyone clicked in it. The
			// first window's page decides for all of them on Windows.
			Page:   mygo.PageOptions{Autoplay: mygo.AutoplayAllow},
			Hidden: hidden,
		})
		// The monitor's page watches only while the window can be seen.
		monitor.setHidden(hidden)
		flow.setHidden(hidden)
		win.OnHide(func() {
			monitor.setHidden(true)
			flow.setHidden(true)
		})
		win.OnMinimize(func() {
			monitor.setHidden(true)
			flow.setHidden(true)
		})
		win.OnShow(func() {
			monitor.setHidden(false)
			flow.setHidden(false)
		})
		win.OnRestore(func() {
			monitor.setHidden(false)
			flow.setHidden(false)
		})
		// Closing hides the window to the tray, so that the shortcuts and
		// the tray keep working, unless the user chose to quit. The tray's
		// Quit, which closes every window too, ends the app.
		mygo.App.OnBeforeQuit(func(*mygo.QuitEvent) { appQuitting.Store(true) })
		win.OnClose(func(e *mygo.CloseEvent) {
			if !appQuitting.Load() {
				e.PreventDefault()
				win.Hide()
				launcher.unsummon()
				if settings.current().CloseAction == "quit" {
					go mygo.App.Quit()
				}
			}
		})

		// Shortcuts and menu items run on the main thread, which changing
		// the displays may wait on: toggle on another goroutine.
		toggleVirtual := func() { go virtual.Toggle() }
		// The shortcut turns the virtual screen on or off, so that the
		// physical displays can come back without the remote side. Remote
		// desktop tools send their keys as input to this computer, so it
		// works from there too.
		hotkeys.handle("virtual", toggleVirtual)

		virtualItem := &mygo.MenuItem{Label: "断开物理屏", Click: func(*mygo.MenuItem, *mygo.Window) { toggleVirtual() }}
		virtual.onChange = func(active bool) {
			if active {
				virtualItem.SetLabel("恢复物理屏")
			} else {
				virtualItem.SetLabel("断开物理屏")
			}
		}

		raise := func() {
			win.Show()
			if win.IsMinimized() {
				win.Restore()
			}
			win.Focus()
		}
		showWindow := func() {
			launcher.unsummon()
			raise()
		}
		virtual.show = showWindow
		// Locked with the physical displays detached, the computer shows
		// nobody where to sign in, and the shortcut is off: its own
		// keyboard or mouse bring them back.
		virtual.idle = mygo.Power.IdleTime
		mygo.Power.OnLockScreen(func() { virtual.setLocked(true) })
		mygo.Power.OnUnlockScreen(func() { virtual.setLocked(false) })
		launcher.hideWindow = win.Hide
		// Started again, as from the Start menu while it waits in the tray.
		mygo.App.OnSecondInstance(func([]string, string) { showWindow() })
		hotkeys.handle("launcher", func() {
			raise()
			launcher.summon()
		})
		// A todo written after the shortcut hides the window again.
		hotkeys.handle("todo", func() {
			raise()
			launcher.setSummoned()
			ShowTool.Broadcast("notes")
		})
		// The monitor overlay, on top with the numbers the user picks.
		hotkeys.handle("overlay", func() { go overlay.Toggle() })
		// Screenshots, and with the second the selection's text translated.
		shot.main = win
		notes.main = win
		hotkeys.handle("shot", func() { go shot.start("", false) })
		hotkeys.handle("shotTranslate", func() { go shot.start("translate", false) })
		// From a menu, once the menu has faded out of the picture.
		shotItem := func(label, mode string) *mygo.MenuItem {
			return &mygo.MenuItem{Label: label, Click: func(*mygo.MenuItem, *mygo.Window) {
				go func() {
					time.Sleep(250 * time.Millisecond)
					shot.start(mode, false)
				}()
			}}
		}
		// Screen recording: the shortcut selects a region, or stops the
		// recording going on.
		record.main = win
		hotkeys.handle("record", func() { go record.toggle() })
		recordItem := &mygo.MenuItem{Label: "录屏", Click: func(*mygo.MenuItem, *mygo.Window) {
			go func() {
				time.Sleep(250 * time.Millisecond)
				record.toggle()
			}()
		}}
		record.onChange = func(on bool) {
			if on {
				recordItem.SetLabel("停止录屏")
			} else {
				recordItem.SetLabel("录屏")
			}
		}
		// The clipboard history: what is copied is kept, and the shortcut
		// brings it up at the pointer, to paste an item where it was.
		go clips.watch()
		hotkeys.handle("clipboard", func() { go clips.summon() })
		hotkeys.apply(prefs.Shortcuts)

		// The floating ball's menu, made anew with the current labels.
		showTool := func(id string) {
			showWindow()
			ShowTool.Broadcast(id)
		}
		widget.open = showWindow
		// A todo's reminder, when clicked, shows the todos; ringing todos
		// show in a bubble beside the floating ball.
		notes.onRemind = func() { showTool("notes") }
		reminder.open = func() { showTool("notes") }
		notes.onAlerts = reminder.update
		// Services that go down pop up in the same bubble.
		services.onAlerts = reminder.services
		services.open = func() { showTool("services") }
		go services.watch(mygo.App.WasOpenedAtLogin())
		// Flow's pipelines; a run that fails pops up in the bubble too.
		flow.onAlerts = reminder.flow
		flow.open = func() { showTool("flow") }
		go flow.watch()
		go updates.watch()
		// A QR code cut out of the screen shows in the dev tools.
		dev.open = func() { showTool("dev") }
		shot.onQR = dev.found
		widget.onMove = func() { reminder.place() }
		overlay.open = func() { showTool("monitor") }
		go notes.watch()
		widget.menu = func() *mygo.Menu {
			label := "断开物理屏"
			if virtual.IsActive() {
				label = "恢复物理屏"
			}
			recLabel := "录屏"
			if record.IsRecording() {
				recLabel = "停止录屏"
			}
			return mygo.NewMenu([]*mygo.MenuItem{
				{Label: "打开工具箱", Click: func(*mygo.MenuItem, *mygo.Window) { showWindow() }},
				{Label: "快捷启动", Click: func(*mygo.MenuItem, *mygo.Window) {
					raise()
					launcher.summon()
				}},
				{Label: "记一条待办", Click: func(*mygo.MenuItem, *mygo.Window) { showTool("notes") }},
				{Label: "剪贴板历史", Click: func(*mygo.MenuItem, *mygo.Window) { showTool("clips") }},
				{Label: "系统监控", Click: func(*mygo.MenuItem, *mygo.Window) { showTool("monitor") }},
				{Label: "服务监控", Click: func(*mygo.MenuItem, *mygo.Window) { showTool("services") }},
				{Label: "Flow 流水线", Click: func(*mygo.MenuItem, *mygo.Window) { showTool("flow") }},
				{Label: "显示 / 隐藏监控悬浮窗", Click: func(*mygo.MenuItem, *mygo.Window) { go overlay.Toggle() }},
				shotItem("截图", ""),
				shotItem("截图翻译", "translate"),
				shotItem("识别二维码", "qr"),
				{Label: recLabel, Click: recordItem.Click},
				mygo.Separator(),
				{Label: label, Click: virtualItem.Click},
				mygo.Separator(),
				{Label: "设置", Click: func(*mygo.MenuItem, *mygo.Window) { showTool("settings") }},
				{Label: "隐藏悬浮球", Click: func(*mygo.MenuItem, *mygo.Window) {
					go settings.update(func(s *AppSettings) { s.Widget.Show = false })
				}},
				{Role: mygo.RoleQuit},
			})
		}
		settings.onChange = func(s AppSettings) {
			widget.apply(s.Widget)
			hotkeys.apply(s.Shortcuts)
			reminder.place()
			overlay.apply(s.Monitor.Overlay)
		}
		go func() {
			widget.apply(prefs.Widget)
			overlay.apply(prefs.Monitor.Overlay)
			// Todos still ringing from the last run.
			notes.alerts(false)
		}()
		// When the displays change, as when the physical ones are detached
		// or a monitor is unplugged, the floating windows go back where the
		// settings have them, or onto a screen that is left. Changes come
		// several in a row: one placing after they settle.
		//
		// Where a display's size or scale changed, they are made anew: a
		// transparent window whose display changes its scale, as when the
		// remote side picks another resolution for the virtual display,
		// keeps a black box behind its page, whatever is done to it after.
		displays := make(chan struct{}, 1)
		var layout atomic.Value // the displays' sizes and scales the floating windows were made for
		layout.Store(displayLayout())
		var remake atomic.Bool
		mygo.Screen.OnDisplaysChanged(func() {
			// It may change and change back within the second.
			if displayLayout() != layout.Load() {
				remake.Store(true)
			}
			virtual.displaysChanged()
			select {
			case displays <- struct{}{}:
			default:
			}
		})
		go func() {
			for range displays {
				time.Sleep(time.Second)
				select {
				case <-displays:
				default:
				}
				if len(mygo.Screen.Displays()) == 0 {
					continue
				}
				if now := displayLayout(); now != layout.Load() || remake.Load() {
					layout.Store(now)
					remake.Store(false)
					widget.remake()
					overlay.remake()
					reminder.remake()
				}
				s := settings.current()
				widget.apply(s.Widget)
				overlay.apply(s.Monitor.Overlay)
				reminder.place()
			}
		}()

		tray, err := mygo.NewTray(mygo.TrayOptions{
			ID:      "toolbox",
			Icon:    trayIcon,
			ToolTip: "工具箱",
			Menu: mygo.NewMenu([]*mygo.MenuItem{
				virtualItem,
				shotItem("截图", ""),
				shotItem("截图翻译", "translate"),
				recordItem,
				{Label: "显示 / 隐藏监控悬浮窗", Click: func(*mygo.MenuItem, *mygo.Window) { go overlay.Toggle() }},
				{Label: "打开工具箱", Click: func(*mygo.MenuItem, *mygo.Window) { showWindow() }},
				mygo.Separator(),
				{Role: mygo.RoleQuit},
			}),
		})
		if err != nil {
			log.Println("tray:", err)
		} else {
			// On Windows a right click opens the menu; a left click only
			// fires OnClick, which opens the window.
			tray.OnClick(showWindow)
		}
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}

// displayLayout tells the displays' sizes and scales, to see whether they
// changed.
func displayLayout() string {
	var b strings.Builder
	for _, d := range mygo.Screen.Displays() {
		fmt.Fprintf(&b, "%dx%d@%g ", d.Bounds.Width, d.Bounds.Height, d.ScaleFactor)
	}
	return b.String()
}
