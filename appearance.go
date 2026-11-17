package main

import (
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/egoist/mygo"
)

// The main window's background picture is a file of the appearance folder,
// which the appearance scheme serves.
const appearanceScheme = "appearance"

// AppearanceSettings are how the windows look, beyond light and dark.
type AppearanceSettings struct {
	// Style gives the colors of the background, cards and lines: default,
	// warm, cool, mint or pure.
	Style  string `json:"style"`
	Accent string `json:"accent"` // #rrggbb
	// Background is the main window's picture, a file name of the
	// appearance folder; empty for none.
	Background string `json:"background"`
	Opacity    int    `json:"opacity"` // percent opacity of the picture
	Dim        int    `json:"dim"`     // percent of the background color over the picture
	Blur       int    `json:"blur"`    // px the picture is blurred
	Cards      int    `json:"cards"`   // percent opacity of the cards over the picture
}

var appearanceStyles = []string{"default", "warm", "cool", "mint", "pure"}

func normalizeAppearance(a *AppearanceSettings) {
	d := defaultSettings.Appearance
	if !slices.Contains(appearanceStyles, a.Style) {
		a.Style = d.Style
	}
	if !isHexColor(a.Accent) {
		a.Accent = d.Accent
	}
	a.Accent = strings.ToLower(a.Accent)
	if strings.ContainsAny(a.Background, `/\:`) || strings.HasPrefix(a.Background, ".") {
		a.Background = ""
	}
	if a.Opacity == 0 {
		a.Opacity = d.Opacity
	}
	a.Opacity = min(max(a.Opacity, 10), 100)
	a.Dim = min(max(a.Dim, 0), 90)
	a.Blur = min(max(a.Blur, 0), 30)
	if a.Cards == 0 {
		a.Cards = d.Cards
	}
	a.Cards = min(max(a.Cards, 40), 100)
}

func isHexColor(s string) bool {
	if len(s) != 7 || s[0] != '#' {
		return false
	}
	for _, c := range strings.ToLower(s[1:]) {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

// serveAppearance registers the appearance scheme; call it before any
// window is made.
func serveAppearance() {
	dir, err := configPath("appearance")
	if err != nil {
		log.Println("appearance:", err)
		return
	}
	files := http.FileServer(http.Dir(dir))
	mygo.Protocol.HandleFunc(appearanceScheme, func(w http.ResponseWriter, r *http.Request) {
		// Every picture gets a new name, so it never changes.
		w.Header().Set("Cache-Control", "max-age=31536000, immutable")
		files.ServeHTTP(w, r)
	})
}

// PickBackground asks for a picture and makes it the main window's
// background. It returns false when the user cancels.
func (st *Settings) PickBackground() (bool, error) {
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Title:   "选择背景图片",
		Filters: []mygo.FileFilter{{Name: "图片", Extensions: []string{"png", "jpg", "jpeg", "webp", "gif", "bmp"}}},
	})
	if err != nil || len(paths) == 0 {
		return false, err
	}
	dir, err := configPath("appearance")
	if err != nil {
		return false, err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return false, err
	}
	name := "bg-" + time.Now().Format("20060102150405") + strings.ToLower(filepath.Ext(paths[0]))
	if err := copyFile(paths[0], filepath.Join(dir, name)); err != nil {
		return false, err
	}
	if err := st.change(func(s *AppSettings) { s.Appearance.Background = name }); err != nil {
		os.Remove(filepath.Join(dir, name))
		return false, err
	}
	cleanBackgrounds(name)
	return true, nil
}

// ClearBackground takes the main window's background picture away.
func (st *Settings) ClearBackground() error {
	if err := st.change(func(s *AppSettings) { s.Appearance.Background = "" }); err != nil {
		return err
	}
	cleanBackgrounds("")
	return nil
}

// cleanBackgrounds deletes the pictures of the appearance folder but keep.
func cleanBackgrounds(keep string) {
	dir, err := configPath("appearance")
	if err != nil {
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if !e.IsDir() && e.Name() != keep {
			os.Remove(filepath.Join(dir, e.Name()))
		}
	}
}

func copyFile(from, to string) error {
	src, err := os.Open(from)
	if err != nil {
		return err
	}
	defer src.Close()
	st, err := src.Stat()
	if err != nil {
		return err
	}
	if st.Size() > 50<<20 {
		return errors.New("图片太大了（超过 50MB）")
	}
	dst, err := os.Create(to)
	if err != nil {
		return err
	}
	_, err = io.Copy(dst, src)
	if cerr := dst.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(to)
	}
	return err
}
