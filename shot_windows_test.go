package main

import (
	"image"
	"image/draw"
	"image/png"
	"os"
	"strings"
	"testing"
)

// TestOCR reads a screenshot of the notes tool with Windows' recognizer:
// Chinese without spaces between characters, and digits kept together.
func TestOCR(t *testing.T) {
	f, err := os.Open("testdata/ocr-zh.png")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	src, err := png.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	img := image.NewRGBA(src.Bounds())
	draw.Draw(img, img.Rect, src, src.Bounds().Min, draw.Src)
	res, err := ocrPicture(img)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("%q", res.Text)
	for _, want := range []string{"笔记待办", "添加待办，回车保存", "明天"} {
		if !strings.Contains(res.Text, want) {
			t.Errorf("no %q in %q", want, res.Text)
		}
	}
	if strings.Contains(res.Text, "1 5") {
		t.Errorf("digits apart in %q", res.Text)
	}
	for _, l := range res.Lines {
		if l.W <= 0 || l.H <= 0 || l.Bg == "" || l.Fg == "" {
			t.Errorf("line without its box or colors: %+v", l)
		}
	}
}

// TestOCREnglish reads English text: with the English recognizer
// installed, Language.OCR~~~en-US, words come back whole and spaced.
func TestOCREnglish(t *testing.T) {
	f, err := os.Open("testdata/ocr-en.png")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	src, err := png.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	img := image.NewRGBA(src.Bounds())
	draw.Draw(img, img.Rect, src, src.Bounds().Min, draw.Src)
	res, err := ocrPicture(img)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("%q", res.Text)
	for _, want := range []string{"The quick brown fox jumps over the lazy dog.", "Screenshot translation works offline."} {
		if !strings.Contains(res.Text, want) {
			t.Errorf("no %q in %q", want, res.Text)
		}
	}
}
