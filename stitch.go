package main

import "image"

// stitcher joins the pictures of a scrolling region into one long one. A
// picture is placed by the rows it shares with the last one: rows that do
// not move between them, at the top and the bottom, are the window's fixed
// bars, kept once.
type stitcher struct {
	w, h  int
	body  []byte // the long picture's RGBA rows, without the fixed bottom bar
	last  *image.RGBA
	sigs  []rowSig // last's rows
	foot  int      // the fixed bottom bar's rows
	lastD int      // how far the last picture had scrolled
	prev  []byte   // the preview's rows made from the body
	prevF int      // and how many pixels each of their pixels stands for
}

// sigN is the number of a row's parts its signature averages.
const sigN = 64

// rowSig is a row in short: its parts' average brightness, and whether it
// is all one color, which says nothing of where it is.
type rowSig struct {
	v    [sigN]uint8
	n    int
	flat bool
}

// The results of stitcher.add.
const (
	stitchSame   = iota // nothing moved
	stitchAdded         // the picture scrolled down and added rows
	stitchLost          // it scrolled too far to tell where it is, or up
	stitchInside        // something changed in it, but it did not scroll
)

// maxStitchHeight caps the long picture, in pixels; maxStitchPixels caps
// it for a wide region, whose rows take more memory each: 4 bytes a
// pixel, and as much again to copy or save it.
const (
	maxStitchHeight = 30000
	maxStitchPixels = 30_000_000
)

// full is whether the long picture is as long as it may get.
func (s *stitcher) full() bool {
	return s.height() >= min(maxStitchHeight, maxStitchPixels/max(s.w, 1))
}

func newStitcher(first *image.RGBA) *stitcher {
	s := &stitcher{w: first.Rect.Dx(), h: first.Rect.Dy()}
	s.body = make([]byte, 0, len(first.Pix)*4)
	for y := range s.h {
		s.body = append(s.body, s.row(first, y)...)
	}
	s.last, s.sigs = first, s.signatures(first)
	return s
}

func (s *stitcher) row(img *image.RGBA, y int) []byte {
	i := y * img.Stride
	return img.Pix[i : i+s.w*4]
}

// height is the long picture's, with its bottom bar.
func (s *stitcher) height() int { return len(s.body)/(s.w*4) + s.foot }

// signatures sums up a picture's rows. The right edge, where a scroll bar
// moves, is left out.
func (s *stitcher) signatures(img *image.RGBA) []rowSig {
	cols := s.w
	if cols >= 200 {
		cols -= 24
	}
	n := min(sigN, cols)
	sigs := make([]rowSig, s.h)
	for y := range s.h {
		px := s.row(img, y)
		sig := &sigs[y]
		sig.n = n
		lo, hi := 255, 0
		for k := range n {
			x0, x1 := k*cols/n, (k+1)*cols/n
			sum := 0
			for x := x0; x < x1; x++ {
				g := (int(px[x*4])*299 + int(px[x*4+1])*587 + int(px[x*4+2])*114) / 1000
				sum += g
				lo, hi = min(lo, g), max(hi, g)
			}
			sig.v[k] = uint8(sum / max(x1-x0, 1))
		}
		sig.flat = hi-lo < 10
	}
	return sigs
}

// same is whether two rows look alike, allowing for the slight changes of
// text drawn again at another place.
func same(a, b *rowSig) bool {
	d := 0
	for k := range a.n {
		d += abs(int(a.v[k]) - int(b.v[k]))
	}
	return d <= a.n*2
}

// add places a new picture of the region under the long one.
func (s *stitcher) add(img *image.RGBA) int {
	if img.Rect.Dx() != s.w || img.Rect.Dy() != s.h {
		return stitchLost
	}
	sigs := s.signatures(img)
	h := s.h
	top := 0
	for top < h && same(&sigs[top], &s.sigs[top]) {
		top++
	}
	if top == h {
		return stitchSame
	}
	bottom := 0
	for bottom < h && same(&sigs[h-1-bottom], &s.sigs[h-1-bottom]) {
		bottom++
	}
	minBand := max(24, h/5)
	foot := max(s.foot, bottom)
	if h-top-foot < minBand {
		// Only a little changed in place, as a blinking cursor.
		if h-top-bottom < minBand {
			s.last, s.sigs = img, sigs
			return stitchInside
		}
		foot = s.foot
	}
	// d is how many rows the content moved up: new row i is old row i+d.
	band := h - top - foot
	bestD, best := 0, -1
	type cand struct{ d, score int }
	var cands []cand
	for d := 1; d <= band-12; d++ {
		overlap := band - d
		allowed := overlap/50 + 1
		bad, score := 0, 0
		for i := top; i < h-foot-d; i++ {
			a, b := &sigs[i], &s.sigs[i+d]
			if !same(a, b) {
				if bad++; bad > allowed {
					break
				}
			} else if !a.flat || !b.flat {
				score++
			}
		}
		if bad > allowed || score < 6 {
			continue
		}
		cands = append(cands, cand{d, score})
		best = max(best, score)
	}
	if best < 0 {
		return stitchLost
	}
	// Repeating content fits several places: of the good ones, the one
	// closest to how far it scrolled last time.
	for _, c := range cands {
		if c.score*10 >= best*9 && (bestD == 0 || abs(c.d-s.lastD) < abs(bestD-s.lastD)) {
			bestD = c.d
		}
	}
	if foot > s.foot {
		s.body = s.body[:len(s.body)-(foot-s.foot)*s.w*4]
		s.foot = foot
	}
	for y := h - foot - bestD; y < h-foot; y++ {
		s.body = append(s.body, s.row(img, y)...)
	}
	s.last, s.sigs, s.lastD = img, sigs, bestD
	return stitchAdded
}

// image is the long picture, with the bottom bar of the last picture.
func (s *stitcher) image() *image.RGBA {
	out := image.NewRGBA(image.Rect(0, 0, s.w, s.height()))
	copy(out.Pix, s.body)
	for y := s.h - s.foot; y < s.h; y++ {
		copy(out.Pix[(len(s.body)/(s.w*4)+y-(s.h-s.foot))*out.Stride:], s.row(s.last, y))
	}
	return out
}

// preview is the long picture made smaller, to at most width pixels wide,
// each of its pixels the average of the ones it stands for. The rows made
// from the body are kept for the next time.
func (s *stitcher) preview(width int) *image.RGBA {
	f := max(1, (s.w+width-1)/width)
	pw := max(s.w/f, 1)
	if s.prevF != f || len(s.prev)/(pw*4)*f > len(s.body)/(s.w*4) {
		s.prev, s.prevF = nil, f
	}
	rowAt := func(y int) []byte {
		if n := len(s.body) / (s.w * 4); y < n {
			return s.body[y*s.w*4 : (y+1)*s.w*4]
		} else {
			return s.row(s.last, y-n+s.h-s.foot)
		}
	}
	shrink := func(y int) []byte {
		out := make([]byte, pw*4)
		n := f * f
		for x := range pw {
			var r, g, b int
			for dy := range f {
				px := rowAt(y*f + dy)
				for dx := range f {
					i := (x*f + dx) * 4
					r, g, b = r+int(px[i]), g+int(px[i+1]), b+int(px[i+2])
				}
			}
			out[x*4], out[x*4+1], out[x*4+2], out[x*4+3] = uint8(r/n), uint8(g/n), uint8(b/n), 255
		}
		return out
	}
	bodyRows := len(s.body) / (s.w * 4) / f
	for y := len(s.prev) / (pw * 4); y < bodyRows; y++ {
		s.prev = append(s.prev, shrink(y)...)
	}
	ph := max(s.height()/f, 1)
	out := image.NewRGBA(image.Rect(0, 0, pw, ph))
	copy(out.Pix, s.prev)
	for y := bodyRows; y < s.height()/f; y++ {
		copy(out.Pix[y*out.Stride:], shrink(y))
	}
	return out
}
