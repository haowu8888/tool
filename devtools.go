package main

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
	"github.com/makiuchi-d/gozxing"
	multiqr "github.com/makiuchi-d/gozxing/multi/qrcode"
	"github.com/makiuchi-d/gozxing/qrcode"
)

// DevQRFound is sent with what a QR code cut out of the screen says, for
// the dev tools' page.
var DevQRFound = mygo.NewEvent[DevQRResult]("devQRFound")

// DevQRResult is what the QR codes of a picture say, or why nothing was
// read.
type DevQRResult struct {
	Texts []string `json:"texts"`
	Error string   `json:"error,omitempty"`
}

// Dev is the developer's small tools that need Go: QR codes, and saving or
// copying a picture. The rest, as JSON, timestamps and the calculator, is
// the page's own.
type Dev struct {
	mu   sync.Mutex
	last *DevQRResult // a screen's QR code the page has not shown yet
	open func()       // shows the tool's page
	shot *Shot
}

// QR makes a QR code of a text: a PNG in base64.
func (d *Dev) QR(text string, size int) (string, error) {
	if text == "" {
		return "", errors.New("没有内容")
	}
	size = min(max(size, 128), 1024)
	hints := map[gozxing.EncodeHintType]any{
		gozxing.EncodeHintType_ERROR_CORRECTION: "M",
		gozxing.EncodeHintType_CHARACTER_SET:    "UTF-8",
		gozxing.EncodeHintType_MARGIN:           2,
	}
	m, err := qrcode.NewQRCodeWriter().Encode(text, gozxing.BarcodeFormat_QR_CODE, size, size, hints)
	if err != nil {
		return "", errors.New("内容太长，放不进二维码")
	}
	var b bytes.Buffer
	if err := png.Encode(&b, m); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(b.Bytes()), nil
}

// DecodeQR reads the QR codes of a picture: PNG, JPEG or GIF bytes in
// base64, as pasted.
func (d *Dev) DecodeQR(data string) (DevQRResult, error) {
	b, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return DevQRResult{}, errors.New("不是图片")
	}
	img, _, err := image.Decode(bytes.NewReader(b))
	if err != nil {
		return DevQRResult{}, errors.New("读不出这张图片")
	}
	return readQR(img), nil
}

// DecodeQRFile reads the QR codes of a picture file, as dropped.
func (d *Dev) DecodeQRFile(path string) (DevQRResult, error) {
	f, err := os.Open(path)
	if err != nil {
		return DevQRResult{}, err
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	if err != nil {
		return DevQRResult{}, errors.New("读不出这张图片（支持 PNG、JPG、GIF）")
	}
	return readQR(img), nil
}

// readQR reads every QR code of a picture; a small one, as a screenshot
// of a code on a web page, is tried at twice the size too.
func readQR(img image.Image) DevQRResult {
	for _, im := range []image.Image{img, scaleUp(img)} {
		if im == nil {
			continue
		}
		bmp, err := gozxing.NewBinaryBitmapFromImage(im)
		if err != nil {
			continue
		}
		hints := map[gozxing.DecodeHintType]any{gozxing.DecodeHintType_TRY_HARDER: true, gozxing.DecodeHintType_CHARACTER_SET: "UTF-8"}
		var texts []string
		if rs, err := multiqr.NewQRCodeMultiReader().DecodeMultiple(bmp, hints); err == nil {
			for _, r := range rs {
				texts = append(texts, r.GetText())
			}
		}
		if len(texts) == 0 {
			if r, err := qrcode.NewQRCodeReader().Decode(bmp, hints); err == nil {
				texts = append(texts, r.GetText())
			}
		}
		if len(texts) > 0 {
			return DevQRResult{Texts: texts}
		}
	}
	return DevQRResult{Texts: []string{}, Error: "没找到二维码：框选时把整个二维码框进去，四周留一点空白"}
}

// scaleUp doubles a small picture's size, nil for a large one.
func scaleUp(img image.Image) image.Image {
	b := img.Bounds()
	if b.Dx() > 600 || b.Dy() > 600 {
		return nil
	}
	out := image.NewRGBA(image.Rect(0, 0, b.Dx()*2, b.Dy()*2))
	for y := range out.Rect.Dy() {
		for x := range out.Rect.Dx() {
			out.Set(x, y, img.At(b.Min.X+x/2, b.Min.Y+y/2))
		}
	}
	return out
}

// ScanScreen cuts out a part of the screen and reads its QR codes, which
// the page gets with devQRFound.
func (d *Dev) ScanScreen() {
	d.shot.Start("qr")
}

// found is told what a QR code cut out of the screen says: the page shows
// it.
func (d *Dev) found(r DevQRResult) {
	d.mu.Lock()
	d.last = &r
	d.mu.Unlock()
	if d.open != nil {
		d.open()
	}
	DevQRFound.Broadcast(r)
}

// TakeQR returns a screen's QR code the page has not shown, once.
func (d *Dev) TakeQR() *DevQRResult {
	d.mu.Lock()
	defer d.mu.Unlock()
	r := d.last
	d.last = nil
	return r
}

// CopyImage puts a PNG in base64 on the clipboard.
func (d *Dev) CopyImage(data string) error {
	b, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return err
	}
	img, err := png.Decode(bytes.NewReader(b))
	if err != nil {
		return err
	}
	return copyImage(img)
}

// SaveImage asks where to save a PNG in base64.
func (d *Dev) SaveImage(data, name string) error {
	b, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return err
	}
	dir := ""
	if home, err := os.UserHomeDir(); err == nil {
		dir = filepath.Join(home, "Pictures")
	}
	path, err := mygo.Dialog.Save(mygo.SaveDialogOptions{
		Title:       "保存图片",
		DefaultPath: filepath.Join(dir, name+" "+time.Now().Format("150405")+".png"),
		Filters:     []mygo.FileFilter{{Name: "PNG 图片", Extensions: []string{"png"}}},
	})
	if err != nil || path == "" {
		return err
	}
	if !strings.EqualFold(filepath.Ext(path), ".png") {
		path += ".png"
	}
	return os.WriteFile(path, b, 0o644)
}
