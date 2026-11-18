package main

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"testing"
)

func testPages(t *testing.T) []docPage {
	t.Helper()
	photo := image.NewRGBA(image.Rect(0, 0, 400, 300))
	for y := range 300 {
		for x := range 400 {
			photo.Set(x, y, color.RGBA{uint8(x * 255 / 400), uint8(y * 255 / 300), 128, 255})
		}
	}
	var j bytes.Buffer
	if err := jpeg.Encode(&j, photo, &jpeg.Options{Quality: 85}); err != nil {
		t.Fatal(err)
	}
	// A tall PNG, transparent at the top half.
	pic := image.NewNRGBA(image.Rect(0, 0, 200, 500))
	for y := range 500 {
		for x := range 200 {
			a := uint8(255)
			if y < 250 {
				a = 80
			}
			pic.Set(x, y, color.NRGBA{200, 30, 30, a})
		}
	}
	var p bytes.Buffer
	if err := png.Encode(&p, pic); err != nil {
		t.Fatal(err)
	}
	return []docPage{{data: j.Bytes(), format: "jpeg", w: 400, h: 300}, {data: p.Bytes(), format: "png", w: 200, h: 500}}
}

// docOut is where the test's files go: TOOLBOX_DOC_OUT, to open them, or
// a temporary folder.
func docOut(t *testing.T) string {
	if d := os.Getenv("TOOLBOX_DOC_OUT"); d != "" {
		os.MkdirAll(d, 0o755)
		return d
	}
	return t.TempDir()
}

func TestDocLayout(t *testing.T) {
	pages := testPages(t)
	near := func(a, b float64) bool { return math.Abs(a-b) < 0.6 }
	// A PDF's fit pages are each picture's own size with the margin around.
	b := docLayout(DocOptions{Kind: "pdf", Page: "fit", Margin: 1}, pages)
	if !near(b[0].IW, 300) || !near(b[0].IH, 225) || !near(b[0].W, 300+2*b[0].X) || b[0].X == 0 {
		t.Errorf("pdf fit page 1: %+v", b[0])
	}
	if !near(b[1].IW, 150) || !near(b[1].IH, 375) {
		t.Errorf("pdf fit page 2: %+v", b[1])
	}
	// A4: the picture as large as fits, centered.
	b = docLayout(DocOptions{Kind: "pdf", Page: "a4"}, pages)
	if !near(b[0].IW, 595.28) || !near(b[0].Y, (841.89-b[0].IH)/2) || !near(b[1].IH, 841.89) {
		t.Errorf("a4: %+v %+v", b[0], b[1])
	}
	// A PowerPoint's slides are all the first picture's shape.
	b = docLayout(DocOptions{Kind: "pptx", Page: "fit"}, pages)
	if !near(b[0].W, 960) || !near(b[0].H, 720) || !near(b[1].W, 960) || !near(b[1].IH, 720) {
		t.Errorf("pptx fit: %+v %+v", b[0], b[1])
	}
}

func TestWriteDocs(t *testing.T) {
	pages := testPages(t)
	dir := docOut(t)
	for _, kind := range []string{"pdf", "pptx"} {
		var b bytes.Buffer
		var err error
		opts := DocOptions{Kind: kind, Page: "wide", Margin: 1, Name: "测试 & <合并>"}
		if kind == "pdf" {
			err = writePDF(&b, pages, opts)
		} else {
			err = writePPTX(&b, pages, opts)
		}
		if err != nil {
			t.Fatal(kind, err)
		}
		if err := os.WriteFile(filepath.Join(dir, "test."+kind), b.Bytes(), 0o644); err != nil {
			t.Fatal(err)
		}
		if kind == "pdf" && !bytes.HasPrefix(b.Bytes(), []byte("%PDF-1.4")) || kind == "pptx" && !bytes.HasPrefix(b.Bytes(), []byte("PK")) {
			t.Errorf("%s: not a %s", kind, kind)
		}
	}
	// Fit pages too, for a look.
	var b bytes.Buffer
	if err := writePDF(&b, pages, DocOptions{Kind: "pdf", Page: "fit"}); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(dir, "fit.pdf"), b.Bytes(), 0o644)
}

func TestDocAddRejects(t *testing.T) {
	m := &ImageEdit{docs: map[string]*docJob{"d": {}}}
	if err := m.DocAdd("d", "aGk=", "webp"); err == nil {
		t.Error("webp accepted")
	}
	if err := m.DocAdd("x", "", "png"); err == nil {
		t.Error("unknown job accepted")
	}
	if _, err := m.DocFinish("d"); err == nil {
		t.Error("an empty document written")
	}
}
