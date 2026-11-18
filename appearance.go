package main

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"image/png"
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
	if !safeFileName(a.Background) {
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

// safeFileName reports whether s names a file of the appearance folder
// itself, or is empty.
func safeFileName(s string) bool {
	return !strings.ContainsAny(s, `/\:`) && !strings.HasPrefix(s, ".")
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
	return st.pickPicture("选择背景图片", "bg-", func(s *AppSettings, name string) { s.Appearance.Background = name })
}

// maxPetImages is how many pictures of their own the user may keep for the
// floating ball.
const maxPetImages = 20

// PickPetImage asks for a picture, a GIF moving too, adds it to the floating
// ball's looks and makes it the one. It returns false when the user cancels.
func (st *Settings) PickPetImage() (bool, error) {
	if len(st.current().Widget.Images) >= maxPetImages {
		return false, fmt.Errorf("最多 %d 张自定义形象，先删掉几张", maxPetImages)
	}
	return st.pickPicture("选择悬浮球的形象", "pet-", func(s *AppSettings, name string) {
		s.Widget.Pet, s.Widget.Image, s.Widget.Images = "custom", name, append(s.Widget.Images, name)
	})
}

// AddPetImage adds a picture the image editor made, a PNG in base64, to the
// floating ball's looks and makes it the one.
func (st *Settings) AddPetImage(data string) error {
	if len(st.current().Widget.Images) >= maxPetImages {
		return fmt.Errorf("最多 %d 张自定义形象，先在「设置 → 悬浮球」里删掉几张", maxPetImages)
	}
	b, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return err
	}
	if _, err := png.DecodeConfig(bytes.NewReader(b)); err != nil {
		return errors.New("不是 PNG 图片")
	}
	dir, err := configPath("appearance")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	name := "pet-" + time.Now().Format("20060102150405.000") + ".png"
	name = strings.Replace(name, ".", "-", 1) // no dot but the extension's
	if err := os.WriteFile(filepath.Join(dir, name), b, 0o644); err != nil {
		return err
	}
	if err := st.change(func(s *AppSettings) {
		s.Widget.Pet, s.Widget.Image, s.Widget.Images = "custom", name, append(s.Widget.Images, name)
	}); err != nil {
		os.Remove(filepath.Join(dir, name))
		return err
	}
	cleanAppearance(st.current())
	return nil
}

// RemovePetImage deletes one of the floating ball's pictures; the ball
// shows another of them, or the ball, when it was the one.
func (st *Settings) RemovePetImage(name string) error {
	err := st.change(func(s *AppSettings) {
		w := &s.Widget
		w.Images = slices.DeleteFunc(w.Images, func(n string) bool { return n == name })
		if w.Image == name {
			w.Image = ""
		}
	})
	if err != nil {
		return err
	}
	cleanAppearance(st.current())
	return nil
}

// normalizePetImages keeps the pictures that are files of the appearance
// folder, each once, and an Image of them; custom without any picture is
// the ball.
func normalizePetImages(w *WidgetSettings) {
	images := []string{}
	for _, n := range append(w.Images, w.Image) {
		if n != "" && safeFileName(n) && !slices.Contains(images, n) && len(images) < maxPetImages {
			images = append(images, n)
		}
	}
	w.Images = images
	if !slices.Contains(images, w.Image) {
		w.Image = ""
	}
	if w.Pet == "custom" && w.Image == "" {
		if len(images) > 0 {
			w.Image = images[0]
		} else {
			w.Pet = "ball"
		}
	}
}

// pickPicture asks for a picture, copies it into the appearance folder
// under a new name and lets set put that name in the settings.
func (st *Settings) pickPicture(title, prefix string, set func(s *AppSettings, name string)) (bool, error) {
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Title:   title,
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
	name := prefix + time.Now().Format("20060102150405") + strings.ToLower(filepath.Ext(paths[0]))
	if err := copyFile(paths[0], filepath.Join(dir, name)); err != nil {
		return false, err
	}
	if err := st.change(func(s *AppSettings) { set(s, name) }); err != nil {
		os.Remove(filepath.Join(dir, name))
		return false, err
	}
	cleanAppearance(st.current())
	return true, nil
}

// ClearBackground takes the main window's background picture away.
func (st *Settings) ClearBackground() error {
	if err := st.change(func(s *AppSettings) { s.Appearance.Background = "" }); err != nil {
		return err
	}
	cleanAppearance(st.current())
	return nil
}

// cleanAppearance deletes the pictures of the appearance folder that are
// neither the background nor among the floating ball's.
func cleanAppearance(s AppSettings) {
	dir, err := configPath("appearance")
	if err != nil {
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if !e.IsDir() && e.Name() != s.Appearance.Background && !slices.Contains(s.Widget.Images, e.Name()) {
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
