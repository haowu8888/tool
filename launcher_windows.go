package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
	"unsafe"
)

var (
	shell32                   = syscall.NewLazyDLL("shell32.dll")
	shellExecuteW             = shell32.NewProc("ShellExecuteW")
	shGetFolderPath           = shell32.NewProc("SHGetFolderPathW")
	kernel32                  = syscall.NewLazyDLL("kernel32.dll")
	expandEnvironmentStringsW = kernel32.NewProc("ExpandEnvironmentStringsW")
)

// shellExecute opens a program, document, folder or URL as Explorer does,
// with the elevation prompt when admin is true. Without a working
// directory a file starts in its own folder, as its shortcut would.
func shellExecute(path, args, dir string, admin bool) error {
	path = expandEnv(path)
	if dir = expandEnv(dir); dir == "" {
		if st, err := os.Stat(path); err == nil && !st.IsDir() {
			dir = filepath.Dir(path)
		}
	}
	verb := "open"
	if admin {
		verb = "runas"
	}
	p := func(s string) *uint16 {
		if s == "" {
			return nil
		}
		u, _ := syscall.UTF16PtrFromString(s)
		return u
	}
	const swShowNormal = 1
	r, _, err := shellExecuteW.Call(0, uintptr(unsafe.Pointer(p(verb))), uintptr(unsafe.Pointer(p(path))), uintptr(unsafe.Pointer(p(args))), uintptr(unsafe.Pointer(p(dir))), swShowNormal)
	if r > 32 {
		return nil
	}
	if errors.Is(err, syscall.Errno(1223)) { // ERROR_CANCELLED: the user said no to the elevation prompt
		return nil
	}
	switch r {
	case 2, 3: // SE_ERR_FNF, SE_ERR_PNF
		return fmt.Errorf("找不到：%s", path)
	case 31: // SE_ERR_NOASSOC
		return fmt.Errorf("没有程序能打开：%s", path)
	}
	return fmt.Errorf("启动失败（%d）：%v", r, err)
}

// expandEnv expands %VARIABLES% in s.
func expandEnv(s string) string {
	if !strings.Contains(s, "%") {
		return s
	}
	src, _ := syscall.UTF16PtrFromString(s)
	buf := make([]uint16, 32768)
	if n, _, _ := expandEnvironmentStringsW.Call(uintptr(unsafe.Pointer(src)), uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf))); n == 0 || int(n) > len(buf) {
		return s
	}
	return syscall.UTF16ToString(buf)
}

// folderPath returns a special folder by its CSIDL.
func folderPath(csidl int) string {
	buf := make([]uint16, 260)
	if r, _, _ := shGetFolderPath.Call(0, uintptr(csidl), 0, 0, uintptr(unsafe.Pointer(&buf[0]))); r != 0 {
		return ""
	}
	return syscall.UTF16ToString(buf)
}

// skipNames marks the shortcuts that are no apps: uninstallers, manuals
// and web pages.
var skipNames = []string{"uninstall", "卸载", "反安装", "readme", "read me", "help", "帮助", "manual", "说明", "website", "官网", "官方网站", "license", "documentation", "release notes", "changelog"}

// installedApps lists the shortcuts of the Start menu, then those of the
// desktop, then the Store's apps, by name, each name once.
func installedApps() ([]InstalledApp, error) {
	const (
		csidlPrograms               = 0x02
		csidlCommonPrograms         = 0x17
		csidlDesktopDirectory       = 0x10
		csidlCommonDesktopDirectory = 0x19
	)
	var apps []InstalledApp
	seen := map[string]bool{}
	add := func(a InstalledApp) {
		lower := strings.ToLower(a.Name)
		if seen[lower] {
			return
		}
		for _, s := range skipNames {
			if strings.Contains(lower, s) {
				return
			}
		}
		seen[lower] = true
		apps = append(apps, a)
	}
	walk := func(root, source string, exts ...string) {
		if root == "" {
			return
		}
		filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			ext := strings.ToLower(filepath.Ext(p))
			if slices.Contains(exts, ext) {
				name := strings.TrimSuffix(d.Name(), filepath.Ext(d.Name()))
				if strings.EqualFold(filepath.Ext(name), ".exe") { // CCleaner64.exe.lnk
					name = strings.TrimSuffix(name, filepath.Ext(name))
				}
				add(InstalledApp{Name: name, Path: p, Source: source})
			}
			return nil
		})
	}
	walk(folderPath(csidlPrograms), "开始菜单", ".lnk", ".url", ".appref-ms")
	walk(folderPath(csidlCommonPrograms), "开始菜单", ".lnk", ".url", ".appref-ms")
	walk(folderPath(csidlDesktopDirectory), "桌面", ".lnk", ".url", ".appref-ms", ".exe")
	walk(folderPath(csidlCommonDesktopDirectory), "桌面", ".lnk", ".url", ".appref-ms", ".exe")

	// Store apps have no shortcut file: Explorer starts them by their
	// AppUserModelID, which has a "!".
	out, err := powershell("[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-StartApps | ConvertTo-Json -Compress")
	if err != nil {
		log.Println("Get-StartApps:", err)
	} else {
		var store []struct{ Name, AppID string }
		if err := json.Unmarshal([]byte(strings.TrimSpace(out)), &store); err != nil {
			log.Println("Get-StartApps:", err)
		}
		for _, s := range store {
			if strings.Contains(s.AppID, "!") {
				add(InstalledApp{Name: s.Name, Path: `shell:AppsFolder\` + s.AppID, Source: "应用商店"})
			}
		}
	}
	slices.SortStableFunc(apps, func(a, b InstalledApp) int { return strings.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name)) })
	return apps, nil
}

// powershell runs a script without showing a console window.
func powershell(script string) (string, error) {
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("%w: %s", err, strings.TrimSpace(string(out)))
	}
	return string(out), nil
}
