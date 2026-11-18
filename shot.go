package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/transfer"
)

// ShotCaptured tells the selection windows that a new screenshot waits.
var ShotCaptured = mygo.NewEvent[int]("shotCaptured")

// ShotEnded tells the selection windows, hidden now, to let go of the
// screenshot: a whole screen's picture each, decoded, and its canvas.
var ShotEnded = mygo.NewEvent[int]("shotEnded")

// PinAction asks a pinned picture's page, from its menu, to recognize or
// translate its text.
var PinAction = mygo.NewEvent[PinActionEvent]("pinAction")

// PinActionEvent is a pinned picture and what to do with it: ocr or
// translate.
type PinActionEvent struct {
	ID     string `json:"id"`
	Action string `json:"action"`
}

// The screenshots and the pinned pictures are served through the shot
// scheme, which WebView2 gives this address.
const shotScheme = "shot"

const shotURL = "http://shot.localhost/"

// pinPad is the transparent margin around a pinned picture, for its
// shadow.
const pinPad = 8

// ShotSettings are the screenshot tool's.
type ShotSettings struct {
	// To is the language translations go into: auto (Chinese, or English
	// for Chinese text), zh or en.
	To string `json:"to"`
	// Engine translates: auto (Google, or Bing where Google cannot be
	// reached), google, bing, or ai for the AI service of AI.
	Engine  string `json:"engine"`
	SaveDir string `json:"saveDir"` // where the last picture was saved
	// AI is the service the ai engine translates with, set apart from the
	// AI writing's: a fast model suits translating.
	AI AISettings `json:"ai"`
}

// ShotFrame is a display's screenshot, for its selection window.
type ShotFrame struct {
	Seq    int    `json:"seq"`
	URL    string `json:"url"`
	Width  int    `json:"width"` // in the display's pixels
	Height int    `json:"height"`
	// Mode is what a selection does at once: ocr or translate; empty to
	// show the toolbar.
	Mode string `json:"mode"`
}

// ShotRect is a selection, in a screenshot's pixels.
type ShotRect struct {
	X int `json:"x"`
	Y int `json:"y"`
	W int `json:"w"`
	H int `json:"h"`
}

// PinInfo is a pinned picture, for its window's page.
type PinInfo struct {
	URL    string `json:"url"`
	Width  int    `json:"width"` // its size on screen, in DIPs
	Height int    `json:"height"`
	// MaxWidth and MaxHeight are its display's work area, which the
	// window with its text panel should fit.
	MaxWidth  int    `json:"maxWidth"`
	MaxHeight int    `json:"maxHeight"`
	Mode      string `json:"mode"` // ocr or translate to do at once
	Pad       int    `json:"pad"`
}

// OCRLine is a line of recognized text and where it is, in the picture's
// pixels, with the colors around it and of it, for a translation to cover
// it.
type OCRLine struct {
	Text string `json:"text"`
	X    int    `json:"x"`
	Y    int    `json:"y"`
	W    int    `json:"w"`
	H    int    `json:"h"`
	Bg   string `json:"bg"`
	Fg   string `json:"fg"`
}

// OCRResult is the text recognized in a picture, a line a line.
type OCRResult struct {
	Text  string    `json:"text"`
	Lines []OCRLine `json:"lines"`
}

// Translation is a picture's text translated, a line for every
// recognized line; Lines is empty when the AI did not keep to them.
type Translation struct {
	To    string   `json:"to"` // zh or en
	Text  string   `json:"text"`
	Lines []string `json:"lines"`
}

// Shot takes screenshots: a window over every display shows its picture
// to select from, and the selection is copied, saved, pinned on top of
// the other windows, or has its text recognized and translated there.
type Shot struct {
	mu     sync.Mutex
	seq    int
	active bool
	mode   string
	frames map[int64]*shotFrame   // display → its screenshot, while selecting
	wins   map[int64]*mygo.Window // display → its selection window, kept hidden
	pins   map[string]*shotPin
	// restore shows the toolbox again, which a capture from its page hid.
	restore bool
	scroll  *scrollShot // a long screenshot going on
	rec     *Record

	settings *Settings
	main     *mygo.Window
	// onQR is told what the QR codes of a selection say, in mode qr.
	onQR func(DevQRResult)
	// onEdit opens a selection, or a pinned picture, in the image editor.
	onEdit func(png []byte, name string)
}

type shotFrame struct {
	display mygo.Display
	img     *image.RGBA
	bmp     []byte
}

type shotPin struct {
	img    *image.RGBA
	png    []byte
	win    *mygo.Window
	w, h   int // the picture's size in DIPs
	maxW   int
	maxH   int
	mode   string
	ocr    *OCRResult
	cancel context.CancelFunc // a translation going on
}

// serveShots registers the shot scheme; call it before any window is made.
func (s *Shot) serve() {
	mygo.Protocol.HandleFunc(shotScheme, func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/")
		s.mu.Lock()
		var b []byte
		kind := "image/png"
		if id, ok := strings.CutPrefix(name, "pin/"); ok {
			if p := s.pins[strings.TrimSuffix(id, ".png")]; p != nil {
				b = p.png
			}
		} else if strings.HasPrefix(name, "scroll/") {
			s.mu.Unlock()
			b, kind = s.scrollPreview(), "image/bmp"
			s.mu.Lock()
		} else if v, ok := strings.CutPrefix(name, "video/"); ok && s.rec != nil {
			s.mu.Unlock()
			// A recording, which the page plays: ranges, for seeking.
			if p, ok := s.rec.serveVideo(v); ok {
				w.Header().Set("Cache-Control", "no-store")
				http.ServeFile(w, r, p)
				return
			}
			http.NotFound(w, r)
			return
		} else if f, ok := strings.CutPrefix(name, "frame/"); ok {
			display, _, _ := strings.Cut(f, "-")
			n, _ := strconv.ParseInt(display, 10, 64)
			if fr := s.frames[n]; fr != nil {
				b, kind = fr.bmp, "image/bmp"
			}
		}
		s.mu.Unlock()
		if b == nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", kind)
		// The selection window draws the screenshot on a canvas to read
		// back, for the mosaic and the marks.
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(b)
	})
}

// Start takes a screenshot, as the toolbox's buttons ask: the toolbox
// steps aside for it. Mode is ocr, translate or qr to do with the
// selection at once, or empty.
func (s *Shot) Start(mode string) {
	go s.start(mode, true)
}

// start takes a screenshot of every display and shows it to select from.
func (s *Shot) start(mode string, fromPage bool) {
	s.mu.Lock()
	if s.active || s.scroll != nil {
		s.mu.Unlock()
		return
	}
	s.active = true
	s.seq++
	seq := s.seq
	s.mode = mode
	s.mu.Unlock()
	if fromPage && s.main != nil && s.main.IsVisible() {
		s.main.Hide()
		s.mu.Lock()
		s.restore = true
		s.mu.Unlock()
		// The window fades out.
		time.Sleep(300 * time.Millisecond)
	}
	frames := map[int64]*shotFrame{}
	for _, d := range mygo.Screen.Displays() {
		img, err := captureDisplay(d.ID)
		if err != nil {
			log.Println("shot:", err)
			continue
		}
		frames[d.ID] = &shotFrame{display: d, img: img, bmp: encodeBMP(img)}
	}
	if len(frames) == 0 {
		s.Cancel()
		return
	}
	s.mu.Lock()
	s.frames = frames
	if s.wins == nil {
		s.wins = map[int64]*mygo.Window{}
	}
	// Windows of displays that went away go too.
	for id, win := range s.wins {
		if frames[id] == nil {
			win.Destroy()
			delete(s.wins, id)
		}
	}
	for id, f := range frames {
		if win := s.wins[id]; win != nil {
			win.SetBounds(f.display.Bounds)
			continue
		}
		b := f.display.Bounds
		win := mygo.NewWindow(mygo.WindowOptions{
			Title:           "截图",
			URL:             fmt.Sprintf("/?shot=%d", id),
			X:               b.X,
			Y:               b.Y,
			Width:           b.Width,
			Height:          b.Height,
			MinWidth:        b.Width,
			MinHeight:       b.Height,
			Hidden:          true,
			Frameless:       true,
			AlwaysOnTop:     true,
			SkipTaskbar:     true,
			DisableResize:   true,
			DisableMinimize: true,
			DisableMaximize: true,
			DisableShadow:   true,
			BackgroundColor: "#000000",
		})
		// Alt+F4 cancels, and the window stays for the next time.
		win.OnClose(func(e *mygo.CloseEvent) {
			if appQuitting.Load() {
				return
			}
			e.PreventDefault()
			go s.Cancel()
		})
		s.wins[id] = win
	}
	s.mu.Unlock()
	ShotCaptured.Broadcast(seq)
}

// Frame returns a display's screenshot to select from, or nil.
func (s *Shot) Frame(display int64) *ShotFrame {
	s.mu.Lock()
	defer s.mu.Unlock()
	f := s.frames[display]
	if !s.active || f == nil {
		return nil
	}
	return &ShotFrame{
		Seq:    s.seq,
		URL:    fmt.Sprintf("%sframe/%d-%d.bmp", shotURL, display, s.seq),
		Width:  f.img.Rect.Dx(),
		Height: f.img.Rect.Dy(),
		Mode:   s.mode,
	}
}

// Ready shows a display's selection window once its page shows the
// screenshot; the one under the pointer takes the keys.
func (s *Shot) Ready(display int64, seq int) {
	s.mu.Lock()
	win, f := s.wins[display], s.frames[display]
	if !s.active || seq != s.seq || win == nil || f == nil {
		s.mu.Unlock()
		return
	}
	s.mu.Unlock()
	win.SetBounds(f.display.Bounds)
	win.Show()
	b := f.display.Bounds
	if c := mygo.Screen.CursorScreenPoint(); c.X >= b.X && c.X < b.X+b.Width && c.Y >= b.Y && c.Y < b.Y+b.Height {
		win.Focus()
	}
}

// Cancel ends a screenshot without keeping anything.
func (s *Shot) Cancel() {
	s.end()
}

// end hides the selection windows and lets the screenshots go.
func (s *Shot) end() {
	s.mu.Lock()
	wins := make([]*mygo.Window, 0, len(s.wins))
	for _, w := range s.wins {
		wins = append(wins, w)
	}
	restore := s.restore
	s.active, s.frames, s.restore = false, nil, false
	s.mu.Unlock()
	for _, w := range wins {
		w.Hide()
	}
	ShotEnded.Broadcast(0)
	freeSoon()
	if restore && s.main != nil {
		s.main.Show()
	}
}

// freeSoon gives the memory the screenshots took back to Windows once
// what is done with them is over: Go would keep it for the next ones, and
// the app waits in the tray most of the time.
func freeSoon() { time.AfterFunc(5*time.Second, debug.FreeOSMemory) }

// Finish ends a screenshot with the selection on a display: copy, save,
// pin, ocr or translate. Layer is what was drawn on the selection, a
// transparent PNG in base64 of its size, or empty.
func (s *Shot) Finish(display int64, r ShotRect, action, layer string) error {
	var marks image.Image
	if layer != "" {
		b, err := base64.StdEncoding.DecodeString(layer)
		if err == nil {
			marks, err = png.Decode(bytes.NewReader(b))
		}
		if err != nil {
			return fmt.Errorf("读不出画的标注：%w", err)
		}
	}
	s.mu.Lock()
	f := s.frames[display]
	if !s.active || f == nil {
		s.mu.Unlock()
		return errors.New("截图已经结束")
	}
	rect := image.Rect(r.X, r.Y, r.X+r.W, r.Y+r.H).Intersect(f.img.Rect)
	if rect.Empty() {
		s.mu.Unlock()
		return errors.New("没有选中区域")
	}
	img := image.NewRGBA(image.Rect(0, 0, rect.Dx(), rect.Dy()))
	for y := range rect.Dy() {
		copy(img.Pix[y*img.Stride:], f.img.Pix[(rect.Min.Y+y)*f.img.Stride+rect.Min.X*4:(rect.Min.Y+y)*f.img.Stride+rect.Max.X*4])
	}
	d := f.display
	s.mu.Unlock()
	if marks != nil {
		draw.Draw(img, img.Rect, marks, marks.Bounds().Min, draw.Over)
	}
	s.end()
	// The selection window is gone: a message box tells what went wrong.
	if err := s.use(img, d, rect, action); err != nil {
		mygo.Dialog.Error("截图", err.Error())
	}
	return nil
}

// use copies, saves or pins a selection.
func (s *Shot) use(img *image.RGBA, d mygo.Display, rect image.Rectangle, action string) error {
	switch action {
	case "copy":
		return copyImage(img)
	case "qr":
		if s.onQR != nil {
			s.onQR(readQR(img))
		}
		return nil
	case "save":
		return s.save(img)
	case "edit":
		b, err := encodePNG(img)
		if err != nil || s.onEdit == nil {
			return err
		}
		s.onEdit(b, "截图 "+time.Now().Format("2006-01-02 150405"))
		return nil
	case "pin", "ocr", "translate":
		scale := d.ScaleFactor
		if scale <= 0 {
			scale = 1
		}
		at := mygo.Rectangle{
			X:      d.Bounds.X + int(math.Round(float64(rect.Min.X)/scale)),
			Y:      d.Bounds.Y + int(math.Round(float64(rect.Min.Y)/scale)),
			Width:  max(1, int(math.Round(float64(rect.Dx())/scale))),
			Height: max(1, int(math.Round(float64(rect.Dy())/scale))),
		}
		mode := action
		if mode == "pin" {
			mode = ""
		}
		return s.pin(img, at, d.WorkArea, mode)
	}
	return errors.New("不支持的操作：" + action)
}

func encodePNG(img image.Image) ([]byte, error) {
	var b bytes.Buffer
	enc := png.Encoder{CompressionLevel: png.BestSpeed}
	if err := enc.Encode(&b, img); err != nil {
		return nil, err
	}
	return b.Bytes(), nil
}

// encodeBMP writes a 32-bit top-down BMP, which costs nothing to make,
// for the selection windows to show at once.
func encodeBMP(img *image.RGBA) []byte {
	w, h := img.Rect.Dx(), img.Rect.Dy()
	const header = 14 + 40
	b := make([]byte, header+w*h*4)
	le := binary.LittleEndian
	b[0], b[1] = 'B', 'M'
	le.PutUint32(b[2:], uint32(len(b)))
	le.PutUint32(b[10:], header)
	le.PutUint32(b[14:], 40)
	le.PutUint32(b[18:], uint32(w))
	le.PutUint32(b[22:], uint32(int32(-h)))
	le.PutUint16(b[26:], 1)
	le.PutUint16(b[28:], 32)
	px := b[header:]
	for i := 0; i < len(img.Pix); i += 4 {
		px[i], px[i+1], px[i+2], px[i+3] = img.Pix[i+2], img.Pix[i+1], img.Pix[i], 255
	}
	return b
}

func copyImage(img image.Image) error {
	b, err := encodePNG(img)
	if err != nil {
		return err
	}
	return mygo.Clipboard.Write(transfer.New(transfer.NewItem(transfer.Bytes(transfer.PNG, b))))
}

// save asks where to save a picture, starting in the folder of the last.
func (s *Shot) save(img image.Image) error {
	dir := s.settings.current().Shot.SaveDir
	if dir == "" {
		if home, err := os.UserHomeDir(); err == nil {
			dir = filepath.Join(home, "Pictures")
		}
	}
	path, err := mygo.Dialog.Save(mygo.SaveDialogOptions{
		Title:       "保存截图",
		DefaultPath: filepath.Join(dir, "截图 "+time.Now().Format("2006-01-02 150405")+".png"),
		Filters:     []mygo.FileFilter{{Name: "PNG 图片", Extensions: []string{"png"}}},
	})
	if err != nil || path == "" {
		return err
	}
	if !strings.EqualFold(filepath.Ext(path), ".png") {
		path += ".png"
	}
	b, err := encodePNG(img)
	if err != nil {
		return err
	}
	if err := os.WriteFile(path, b, 0o644); err != nil {
		return err
	}
	return s.settings.change(func(cur *AppSettings) { cur.Shot.SaveDir = filepath.Dir(path) })
}

// pin shows a picture on top of the other windows where it was cut out.
func (s *Shot) pin(img *image.RGBA, at, work mygo.Rectangle, mode string) error {
	b, err := encodePNG(img)
	if err != nil {
		return err
	}
	id := newID()
	p := &shotPin{img: img, png: b, w: at.Width, h: at.Height, maxW: work.Width, maxH: work.Height, mode: mode}
	s.mu.Lock()
	if s.pins == nil {
		s.pins = map[string]*shotPin{}
	}
	s.pins[id] = p
	s.mu.Unlock()
	w, h := at.Width+2*pinPad, at.Height+2*pinPad
	p.win = mygo.NewWindow(mygo.WindowOptions{
		Title:           "贴图",
		URL:             "/?pin=" + id,
		X:               at.X - pinPad,
		Y:               at.Y - pinPad,
		Width:           w,
		Height:          h,
		MinWidth:        w,
		MinHeight:       h,
		Hidden:          true,
		Frameless:       true,
		Transparent:     true,
		AlwaysOnTop:     true,
		SkipTaskbar:     true,
		DisableResize:   true,
		DisableMinimize: true,
		DisableMaximize: true,
		DisableShadow:   true,
	})
	p.win.OnClose(func(*mygo.CloseEvent) { s.dropPin(id) })
	return nil
}

func (s *Shot) getPin(id string) (*shotPin, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.pins[id]
	if p == nil {
		return nil, errors.New("贴图已经关了")
	}
	return p, nil
}

// Pin returns a pinned picture for its page.
func (s *Shot) Pin(id string) (PinInfo, error) {
	p, err := s.getPin(id)
	if err != nil {
		return PinInfo{}, err
	}
	return PinInfo{URL: shotURL + "pin/" + id + ".png", Width: p.w, Height: p.h, MaxWidth: p.maxW, MaxHeight: p.maxH, Mode: p.mode, Pad: pinPad}, nil
}

// PinReady shows a pinned picture once its page shows it.
func (s *Shot) PinReady(id string) {
	if p, err := s.getPin(id); err == nil {
		p.win.Show()
		p.win.Focus()
	}
}

// ResizePin fits a pinned picture's window to its page: zoomed, or with
// the text panel. It grows from its top left, but stays on its screen.
func (s *Shot) ResizePin(id string, w, h int) {
	p, err := s.getPin(id)
	if err != nil {
		return
	}
	w, h = max(w, 24), max(h, 24)
	x, y := p.win.Position()
	wa := mygo.Screen.DisplayNearestPoint(mygo.Point{X: x + pinPad, Y: y + pinPad}).WorkArea
	if x+w > wa.X+wa.Width {
		x = max(wa.X+wa.Width-w, wa.X) - pinPad
	}
	if y+h > wa.Y+wa.Height {
		y = max(wa.Y+wa.Height-h, wa.Y) - pinPad
	}
	p.win.SetMinimumSize(w, h)
	p.win.SetMaximumSize(w, h)
	p.win.SetBounds(mygo.Rectangle{X: x, Y: y, Width: w, Height: h})
}

// DragPin moves a pinned picture with the pointer until the button is
// released.
func (s *Shot) DragPin(id string) {
	p, err := s.getPin(id)
	if err != nil {
		return
	}
	go func() {
		x, y := p.win.Position()
		c := mygo.Screen.CursorScreenPoint()
		dx, dy := c.X-x, c.Y-y
		for mouseDown() {
			time.Sleep(10 * time.Millisecond)
			c := mygo.Screen.CursorScreenPoint()
			if c.X-dx != x || c.Y-dy != y {
				x, y = c.X-dx, c.Y-dy
				p.win.SetPosition(x, y)
			}
		}
	}()
}

// ClosePin closes a pinned picture.
func (s *Shot) ClosePin(id string) {
	if p, err := s.getPin(id); err == nil {
		p.win.Close()
	}
}

// CloseAllPins closes every pinned picture.
func (s *Shot) CloseAllPins() {
	s.mu.Lock()
	var wins []*mygo.Window
	for _, p := range s.pins {
		wins = append(wins, p.win)
	}
	s.mu.Unlock()
	for _, w := range wins {
		w.Close()
	}
}

func (s *Shot) dropPin(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if p := s.pins[id]; p != nil {
		if p.cancel != nil {
			p.cancel()
		}
		delete(s.pins, id)
	}
}

// PinMenu shows a pinned picture's menu at the pointer.
func (s *Shot) PinMenu(id string) {
	p, err := s.getPin(id)
	if err != nil {
		return
	}
	act := func(action string) func(*mygo.MenuItem, *mygo.Window) {
		return func(*mygo.MenuItem, *mygo.Window) { PinAction.Broadcast(PinActionEvent{ID: id, Action: action}) }
	}
	mygo.NewMenu([]*mygo.MenuItem{
		{Label: "识别文字", Click: act("ocr")},
		{Label: "翻译", Click: act("translate")},
		mygo.Separator(),
		{Label: "复制图片", Click: func(*mygo.MenuItem, *mygo.Window) { go s.CopyPin(id) }},
		{Label: "另存为…", Click: func(*mygo.MenuItem, *mygo.Window) { go s.SavePin(id) }},
		{Label: "在图片编辑里打开", Click: func(*mygo.MenuItem, *mygo.Window) {
			if s.onEdit != nil {
				go s.onEdit(p.png, "贴图 "+time.Now().Format("2006-01-02 150405"))
			}
		}},
		mygo.Separator(),
		{Label: "关闭", Click: func(*mygo.MenuItem, *mygo.Window) { go s.ClosePin(id) }},
		{Label: "关闭全部贴图", Click: func(*mygo.MenuItem, *mygo.Window) { go s.CloseAllPins() }},
	}).Popup(p.win)
}

// CopyPin copies a pinned picture.
func (s *Shot) CopyPin(id string) error {
	p, err := s.getPin(id)
	if err != nil {
		return err
	}
	return mygo.Clipboard.Write(transfer.New(transfer.NewItem(transfer.Bytes(transfer.PNG, p.png))))
}

// SavePin saves a pinned picture.
func (s *Shot) SavePin(id string) error {
	p, err := s.getPin(id)
	if err != nil {
		return err
	}
	return s.save(p.img)
}

// OCR recognizes a pinned picture's text, once.
func (s *Shot) OCR(id string) (OCRResult, error) {
	p, err := s.getPin(id)
	if err != nil {
		return OCRResult{}, err
	}
	s.mu.Lock()
	done := p.ocr
	s.mu.Unlock()
	if done != nil {
		return *done, nil
	}
	res, err := ocrPicture(p.img)
	if err != nil {
		return OCRResult{}, err
	}
	s.mu.Lock()
	p.ocr = &res
	s.mu.Unlock()
	return res, nil
}

// ocrPicture recognizes a picture's text. Small pictures are read twice
// as large, which the recognizer reads small text better in.
func ocrPicture(img *image.RGBA) (OCRResult, error) {
	w, h := img.Rect.Dx(), img.Rect.Dy()
	scale := 1
	if w*h < 1_000_000 && w*2 <= 10000 && h*2 <= 10000 {
		scale = 2
	}
	src := img
	if scale > 1 {
		src = image.NewRGBA(image.Rect(0, 0, w*scale, h*scale))
		for y := range h * scale {
			for x := range w * scale {
				copy(src.Pix[y*src.Stride+x*4:y*src.Stride+x*4+4], img.Pix[(y/scale)*img.Stride+(x/scale)*4:])
			}
		}
	}
	res, err := recognize(src)
	if err != nil {
		return res, err
	}
	for i := range res.Lines {
		l := &res.Lines[i]
		l.X, l.Y, l.W, l.H = l.X/scale, l.Y/scale, (l.W+scale-1)/scale, (l.H+scale-1)/scale
		l.Bg, l.Fg = lineColors(img, image.Rect(l.X, l.Y, l.X+l.W, l.Y+l.H))
	}
	return res, nil
}

// lineColors guesses a line's background, from the pixels around it, and
// its text's color, from the pixels in it least like the background.
func lineColors(img *image.RGBA, r image.Rectangle) (bg, fg string) {
	at := func(x, y int) (int, int, int) {
		i := img.PixOffset(x, y)
		return int(img.Pix[i]), int(img.Pix[i+1]), int(img.Pix[i+2])
	}
	ring := r.Inset(-2).Intersect(img.Rect)
	var sr, sg, sb, n int
	for x := ring.Min.X; x < ring.Max.X; x++ {
		for _, y := range []int{ring.Min.Y, ring.Max.Y - 1} {
			cr, cg, cb := at(x, y)
			sr, sg, sb, n = sr+cr, sg+cg, sb+cb, n+1
		}
	}
	for y := ring.Min.Y; y < ring.Max.Y; y++ {
		for _, x := range []int{ring.Min.X, ring.Max.X - 1} {
			cr, cg, cb := at(x, y)
			sr, sg, sb, n = sr+cr, sg+cg, sb+cb, n+1
		}
	}
	if n == 0 {
		return "#ffffff", "#111111"
	}
	br, bgc, bb := sr/n, sg/n, sb/n
	in := r.Intersect(img.Rect)
	dist := func(cr, cg, cb int) int { return abs(cr-br) + abs(cg-bgc) + abs(cb-bb) }
	far := 0
	for y := in.Min.Y; y < in.Max.Y; y++ {
		for x := in.Min.X; x < in.Max.X; x++ {
			far = max(far, dist(at(x, y)))
		}
	}
	var fr, fgc, fb, m int
	for y := in.Min.Y; y < in.Max.Y; y++ {
		for x := in.Min.X; x < in.Max.X; x++ {
			if cr, cg, cb := at(x, y); dist(cr, cg, cb)*10 >= far*7 {
				fr, fgc, fb, m = fr+cr, fgc+cg, fb+cb, m+1
			}
		}
	}
	if m == 0 || far < 60 {
		// No text to tell: black or white, whichever reads.
		if br*299+bgc*587+bb*114 > 128000 {
			return hexColor(br, bgc, bb), "#111111"
		}
		return hexColor(br, bgc, bb), "#ffffff"
	}
	return hexColor(br, bgc, bb), hexColor(fr/m, fgc/m, fb/m)
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

func hexColor(r, g, b int) string { return fmt.Sprintf("#%02x%02x%02x", r, g, b) }

// Translate translates a pinned picture's text, a line for a line so
// that it can cover the picture's, with the engine of the settings: free
// machine translation, or the AI service. To is zh, en, or auto as the
// settings say.
func (s *Shot) Translate(id, to string) (Translation, error) {
	res, err := s.OCR(id)
	if err != nil {
		return Translation{}, err
	}
	if len(res.Lines) == 0 {
		return Translation{}, errors.New("图里没有识别到文字")
	}
	cfg := s.settings.current()
	if to == "" || to == "auto" {
		to = cfg.Shot.To
	}
	if to != "zh" && to != "en" {
		to = "zh"
		if mostlyChinese(res.Text) {
			to = "en"
		}
	}
	texts := make([]string, len(res.Lines))
	for i, l := range res.Lines {
		texts[i] = l.Text
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	if p, err := s.getPin(id); err == nil {
		s.mu.Lock()
		if p.cancel != nil {
			p.cancel()
		}
		p.cancel = cancel
		s.mu.Unlock()
	}
	var text string
	if cfg.Shot.Engine == "ai" {
		text, err = translateAI(ctx, cfg.Shot.AI, texts, to)
	} else {
		text, err = machineTranslate(ctx, cfg.Shot.Engine, strings.Join(texts, "\n"), to)
	}
	if errors.Is(err, context.Canceled) {
		return Translation{}, errors.New("已取消")
	}
	if err != nil {
		return Translation{}, err
	}
	out := Translation{To: to, Text: strings.TrimSpace(text), Lines: []string{}}
	lines := strings.Split(strings.ReplaceAll(out.Text, "\r", ""), "\n")
	if len(lines) == len(texts) {
		for i := range lines {
			lines[i] = strings.TrimSpace(lines[i])
		}
		out.Lines = lines
		out.Text = strings.Join(lines, "\n")
	}
	// Not a line for a line: the text alone, without covering the picture.
	return out, nil
}

// translateAI translates lines with the AI service, which answers with
// them a line a line.
func translateAI(ctx context.Context, cfg AISettings, texts []string, to string) (string, error) {
	if strings.TrimSpace(cfg.BaseURL) == "" || strings.TrimSpace(cfg.Model) == "" {
		return "", errors.New("用 AI 翻译要先在「设置 → AI 翻译」里填接口地址、密钥和模型")
	}
	lang := map[string]string{"zh": "Simplified Chinese", "en": "English"}[to]
	src, _ := json.Marshal(texts)
	messages := []map[string]string{
		{"role": "system", "content": "You are a professional translator. Translate every item of the JSON array the user sends into " + lang + ". " +
			"The items are consecutive lines of text recognized from a screenshot, so one sentence may run across several items: translate with that context, " +
			"but keep exactly one output item for each input item, in the same order. Fix obvious recognition mistakes. " +
			"Keep numbers, code, URLs and product names as they are; items already in " + lang + " stay as they are. " +
			"Reply with only a JSON array of strings with the same number of items, without any explanation or code fence."},
		{"role": "user", "content": string(src)},
	}
	var answer strings.Builder
	if err := chat(ctx, cfg, messages, func(t string) { answer.WriteString(t) }); err != nil {
		return "", err
	}
	text := strings.TrimSpace(answer.String())
	if i, j := strings.Index(text, "["), strings.LastIndex(text, "]"); i >= 0 && j > i {
		var lines []string
		if json.Unmarshal([]byte(text[i:j+1]), &lines) == nil && len(lines) == len(texts) {
			for k := range lines {
				lines[k] = strings.ReplaceAll(lines[k], "\n", " ")
			}
			return strings.Join(lines, "\n"), nil
		}
	}
	return text, nil
}

// mostlyChinese is whether most letters of a text are Chinese characters.
func mostlyChinese(s string) bool {
	han, other := 0, 0
	for _, r := range s {
		switch {
		case unicode.Is(unicode.Han, r):
			han++
		case unicode.IsLetter(r):
			other++
		}
	}
	// A Chinese character says as much as a word of letters.
	return han*4 > other
}
