package main

import (
	"image"
	"image/color"
	"math/rand"
	"testing"
)

// fakePage is a long page of text-like lines, some blank stretches and a
// colored band.
func fakePage(w, h int, seed int64) *image.RGBA {
	r := rand.New(rand.NewSource(seed))
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for i := range img.Pix {
		img.Pix[i] = 255
	}
	set := func(x, y int, c color.RGBA) { img.SetRGBA(x, y, c) }
	for y := 0; y < h; {
		if r.Intn(8) == 0 {
			y += 40 + r.Intn(60) // a blank stretch
			continue
		}
		lineH := 12 + r.Intn(8)
		for x := 8; x < w-40; {
			ww := 10 + r.Intn(50)
			c := color.RGBA{uint8(r.Intn(80)), uint8(r.Intn(80)), uint8(r.Intn(80)), 255}
			for yy := y; yy < min(y+lineH, h); yy++ {
				for xx := x; xx < min(x+ww, w-40); xx++ {
					if (xx+yy)%3 != 0 {
						set(xx, yy, c)
					}
				}
			}
			x += ww + 6 + r.Intn(10)
		}
		y += lineH + 6 + r.Intn(6)
	}
	return img
}

// view is what a window showing the page from row off looks like: a fixed
// header and footer, and a scroll bar at the right edge.
func view(page *image.RGBA, off, h, head, foot int) *image.RGBA {
	w := page.Rect.Dx()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			var c color.RGBA
			switch {
			case y < head:
				c = color.RGBA{30, 90, 200, 255}
				if x%17 < 9 && y > 8 && y < head-8 {
					c = color.RGBA{255, 255, 255, 255}
				}
			case y >= h-foot:
				c = color.RGBA{240, 240, 240, 255}
				if x%23 < 11 && y > h-foot+6 {
					c = color.RGBA{20, 20, 20, 255}
				}
			default:
				c = page.RGBAAt(x, off+y-head)
			}
			if x >= w-12 {
				c = color.RGBA{230, 230, 230, 255}
				thumb := off * h / page.Rect.Dy()
				if y >= thumb && y < thumb+60 {
					c = color.RGBA{120, 120, 120, 255}
				}
			}
			img.SetRGBA(x, y, c)
		}
	}
	return img
}

func TestStitch(t *testing.T) {
	const w, h, head, foot = 400, 500, 44, 30
	page := fakePage(w, 2600, 1)
	s := newStitcher(view(page, 0, h, head, foot))
	off := 0
	for _, step := range []int{0, 90, 133, 0, 180, 1, 260, 340, 75, 300, 222} {
		off += step
		got := s.add(view(page, off, h, head, foot))
		want := stitchAdded
		if step == 0 {
			want = stitchSame
		}
		if got != want {
			t.Fatalf("scrolling %d to %d: got %d, want %d", step, off, got, want)
		}
	}
	// Too far at once: it waits until scrolled back to where it can tell.
	if got := s.add(view(page, off+h, h, head, foot)); got != stitchLost {
		t.Fatalf("scrolling past a whole view: got %d", got)
	}
	if got := s.add(view(page, off-50, h, head, foot)); got != stitchLost {
		t.Fatalf("scrolling up: got %d", got)
	}
	off += 200
	if got := s.add(view(page, off, h, head, foot)); got != stitchAdded {
		t.Fatalf("scrolling back in reach: got %d", got)
	}

	img := s.image()
	content := h - head - foot
	if want := head + off + content + foot; img.Rect.Dy() != want {
		t.Fatalf("height %d, want %d", img.Rect.Dy(), want)
	}
	last := view(page, off, h, head, foot)
	for y := range img.Rect.Dy() {
		for x := range w - 24 {
			var want color.RGBA
			switch {
			case y < head:
				want = last.RGBAAt(x, y)
			case y >= img.Rect.Dy()-foot:
				want = last.RGBAAt(x, y-img.Rect.Dy()+h)
			default:
				want = page.RGBAAt(x, y-head)
			}
			if got := img.RGBAAt(x, y); got != want {
				t.Fatalf("pixel %d,%d is %v, want %v", x, y, got, want)
			}
		}
	}

	p := s.preview(150)
	if p.Rect.Dx() != w/3 || p.Rect.Dy() != img.Rect.Dy()/3 {
		t.Fatalf("preview %v", p.Rect)
	}
}

// A blinking cursor changes the picture without scrolling it.
func TestStitchInPlace(t *testing.T) {
	page := fakePage(300, 1000, 2)
	a := view(page, 100, 400, 0, 0)
	s := newStitcher(a)
	b := image.NewRGBA(a.Rect)
	copy(b.Pix, a.Pix)
	for y := 200; y < 216; y++ {
		for x := 50; x < 60; x++ {
			b.SetRGBA(x, y, color.RGBA{0, 0, 0, 255})
		}
	}
	if got := s.add(b); got != stitchInside {
		t.Fatalf("got %d", got)
	}
	if s.height() != 400 {
		t.Fatalf("height %d", s.height())
	}
}
