package main

import (
	"image"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

// TestRecordScreen records two seconds of the screen's corner, with the
// speakers' sound if there are speakers, and reads the file's length back.
// Over SSH there is no desktop to capture: run it with .dev/desktest.ps1.
func TestRecordScreen(t *testing.T) {
	needDesktop(t)
	for _, fps := range []int{30, 60} {
		path := filepath.Join(t.TempDir(), "rec.mp4")
		rc := &recording{rect: image.Rect(0, 0, 640, 360), opts: RecordSettings{FPS: fps, Cursor: true, Sound: true, Mic: true}, path: path, stop: make(chan struct{}), done: make(chan struct{})}
		done := make(chan error, 1)
		go func() { done <- recordScreen(rc) }()
		waitRecording(t, rc)
		time.Sleep(2 * time.Second)
		rc.mu.Lock()
		rc.stopped = true
		rc.mu.Unlock()
		close(rc.stop)
		if err := <-done; err != nil {
			t.Fatal(err)
		}
		fi, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		d := mp4Duration(path)
		t.Logf("%d fps: %d bytes, %d ms, note %q", fps, fi.Size(), d, rc.note)
		if out := os.Getenv("TOOLBOX_RECORD_OUT"); out != "" {
			b, _ := os.ReadFile(path)
			os.WriteFile(filepath.Join(out, filepath.Base(t.Name())+"-"+strconv.Itoa(fps)+".mp4"), b, 0o644)
		}
		if d < 1800 || d > 2300 {
			t.Errorf("%d fps: duration %d ms, want about 2000", fps, d)
		}
	}
}

// TestRecordPause leaves a pause out of the video.
func TestRecordPause(t *testing.T) {
	needDesktop(t)
	path := filepath.Join(t.TempDir(), "rec.mp4")
	rc := &recording{rect: image.Rect(0, 0, 320, 240), opts: RecordSettings{FPS: 30, Sound: true}, path: path, stop: make(chan struct{}), done: make(chan struct{})}
	done := make(chan error, 1)
	go func() { done <- recordScreen(rc) }()
	waitRecording(t, rc)
	time.Sleep(time.Second)
	rc.mu.Lock()
	rc.pausedAt = clock100ns()
	rc.mu.Unlock()
	time.Sleep(time.Second)
	rc.mu.Lock()
	rc.pausedFor += clock100ns() - rc.pausedAt
	rc.pausedAt = 0
	rc.mu.Unlock()
	time.Sleep(time.Second)
	close(rc.stop)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if d := mp4Duration(path); d < 1800 || d > 2300 {
		t.Errorf("duration %d ms, want about 2000", d)
	}
}

// waitRecording waits for the first frame.
func waitRecording(t *testing.T, rc *recording) {
	for range 100 {
		rc.mu.Lock()
		st := rc.state
		rc.mu.Unlock()
		if st == "recording" {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("recording did not start")
}

// TestRecordFullScreen logs how many frames a whole screen gets, at 30
// and 60 a second: BitBlt and the encoder have to keep up.
func TestRecordFullScreen(t *testing.T) {
	if os.Getenv("TOOLBOX_RECORD_OUT") == "" {
		t.Skip("on the desktop only (.dev/desktest.ps1)")
	}
	// The app is per-monitor DPI aware: the whole screen in its pixels.
	user32.NewProc("SetProcessDpiAwarenessContext").Call(^uintptr(3))
	w, _, _ := getSystemMetrics.Call(0)
	h, _, _ := getSystemMetrics.Call(1)
	for _, fps := range []int{30, 60} {
		path := filepath.Join(t.TempDir(), "full.mp4")
		rc := &recording{rect: image.Rect(0, 0, int(w)&^1, int(h)&^1), opts: RecordSettings{FPS: fps, Cursor: true, Sound: true}, path: path, stop: make(chan struct{}), done: make(chan struct{})}
		done := make(chan error, 1)
		go func() { done <- recordScreen(rc) }()
		waitRecording(t, rc)
		start := time.Now()
		time.Sleep(3 * time.Second)
		close(rc.stop)
		if err := <-done; err != nil {
			t.Fatal(err)
		}
		fi, _ := os.Stat(path)
		t.Logf("%dx%d %d fps: %d bytes, %d ms, saved in %v", w, h, fps, fi.Size(), mp4Duration(path), time.Since(start)-3*time.Second)
		b, _ := os.ReadFile(path)
		os.WriteFile(filepath.Join(os.Getenv("TOOLBOX_RECORD_OUT"), "full-"+strconv.Itoa(fps)+".mp4"), b, 0o644)
	}
}

// needDesktop skips a test where the screen cannot be captured, as over
// SSH.
func needDesktop(t *testing.T) {
	if _, err := captureScreen(image.Rect(0, 0, 8, 8)); err != nil {
		t.Skip("no desktop to capture (run it with .dev/desktest.ps1):", err)
	}
}
