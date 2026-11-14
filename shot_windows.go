package main

import (
	"errors"
	"fmt"
	"image"
	"runtime"
	"slices"
	"strings"
	"syscall"
	"time"
	"unicode"
	"unsafe"
)

var (
	gdi32                  = syscall.NewLazyDLL("gdi32.dll")
	getDC                  = user32.NewProc("GetDC")
	releaseDC              = user32.NewProc("ReleaseDC")
	getMonitorInfo         = user32.NewProc("GetMonitorInfoW")
	createCompatibleDC     = gdi32.NewProc("CreateCompatibleDC")
	createDIBSection       = gdi32.NewProc("CreateDIBSection")
	selectObject           = gdi32.NewProc("SelectObject")
	bitBlt                 = gdi32.NewProc("BitBlt")
	deleteObject           = gdi32.NewProc("DeleteObject")
	deleteDC               = gdi32.NewProc("DeleteDC")
	combase                = syscall.NewLazyDLL("combase.dll")
	roInitialize           = combase.NewProc("RoInitialize")
	roGetActivationFactory = combase.NewProc("RoGetActivationFactory")
	windowsCreateString    = combase.NewProc("WindowsCreateString")
	windowsDeleteString    = combase.NewProc("WindowsDeleteString")
	windowsGetStringRaw    = combase.NewProc("WindowsGetStringRawBuffer")
)

// captureDisplay takes a picture of the monitor whose handle is a
// mygo.Display's ID, in its pixels. Layered windows, as the floating ball,
// are in it.
func captureDisplay(id int64) (*image.RGBA, error) {
	r, err := monitorRect(id)
	if err != nil {
		return nil, err
	}
	return captureScreen(r)
}

// monitorRect is where a monitor is on the virtual screen, in pixels.
func monitorRect(id int64) (image.Rectangle, error) {
	var mi struct {
		size          uint32
		monitor, work [4]int32
		flags         uint32
	}
	mi.size = uint32(unsafe.Sizeof(mi))
	if r, _, _ := getMonitorInfo.Call(uintptr(id), uintptr(unsafe.Pointer(&mi))); r == 0 {
		return image.Rectangle{}, errors.New("找不到这块显示器")
	}
	r := image.Rect(int(mi.monitor[0]), int(mi.monitor[1]), int(mi.monitor[2]), int(mi.monitor[3]))
	if r.Empty() {
		return r, errors.New("显示器大小不对")
	}
	return r, nil
}

// captureScreen takes a picture of a part of the virtual screen. Windows
// excluded from capture, as the long screenshot's frame, are not in it.
func captureScreen(r image.Rectangle) (*image.RGBA, error) {
	x, y, w, h := r.Min.X, r.Min.Y, r.Dx(), r.Dy()
	screen, _, _ := getDC.Call(0)
	if screen == 0 {
		return nil, errors.New("拿不到屏幕")
	}
	defer releaseDC.Call(0, screen)
	mem, _, _ := createCompatibleDC.Call(screen)
	if mem == 0 {
		return nil, errors.New("CreateCompatibleDC 失败")
	}
	defer deleteDC.Call(mem)
	bi := struct {
		size                 uint32
		width, height        int32
		planes, bitCount     uint16
		compression, sizeImg uint32
		xppm, yppm           int32
		clrUsed, clrImp      uint32
	}{width: int32(w), height: -int32(h), planes: 1, bitCount: 32} // top-down BGRA
	bi.size = uint32(unsafe.Sizeof(bi))
	var bits *byte
	bmp, _, _ := createDIBSection.Call(screen, uintptr(unsafe.Pointer(&bi)), 0, uintptr(unsafe.Pointer(&bits)), 0, 0)
	if bmp == 0 || bits == nil {
		return nil, errors.New("CreateDIBSection 失败")
	}
	defer deleteObject.Call(bmp)
	old, _, _ := selectObject.Call(mem, bmp)
	defer selectObject.Call(mem, old)
	const srcCopy, captureBlt = 0x00CC0020, 0x40000000
	if r, _, err := bitBlt.Call(mem, 0, 0, uintptr(w), uintptr(h), screen, uintptr(int32(x)), uintptr(int32(y)), srcCopy|captureBlt); r == 0 {
		return nil, fmt.Errorf("截屏失败：%v", err)
	}
	src := unsafe.Slice(bits, w*h*4)
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for i := 0; i < len(src); i += 4 {
		img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = src[i+2], src[i+1], src[i], 255
	}
	return img, nil
}

// ---- Windows' own text recognition, Windows.Media.Ocr, through WinRT ----

// comObj is a COM or WinRT interface pointer.
type comObj struct{ vtbl *[64]uintptr }

func (o *comObj) call(method int, args ...uintptr) int32 {
	r, _, _ := syscall.SyscallN(o.vtbl[method], append([]uintptr{uintptr(unsafe.Pointer(o))}, args...)...)
	return int32(r)
}

func (o *comObj) release() {
	if o != nil {
		o.call(2)
	}
}

func (o *comObj) query(iid *guid) (*comObj, error) {
	var out *comObj
	if hr := o.call(0, uintptr(unsafe.Pointer(iid)), uintptr(unsafe.Pointer(&out))); hr < 0 || out == nil {
		return nil, fmt.Errorf("QueryInterface 0x%08X", uint32(hr))
	}
	return out, nil
}

// close calls IClosable.Close, which BitmapBuffer and its reference need
// before the bitmap can be read again.
func (o *comObj) close() {
	if c, err := o.query(&iidClosable); err == nil {
		c.call(6)
		c.release()
	}
}

type guid struct {
	d1     uint32
	d2, d3 uint16
	d4     [8]byte
}

// mustGUID reads 5a14bc41-5b76-3140-b680-8825562683ac.
func mustGUID(s string) guid {
	var g guid
	var b [16]byte
	hex := strings.ReplaceAll(s, "-", "")
	for i := range b {
		fmt.Sscanf(hex[2*i:2*i+2], "%02x", &b[i])
	}
	g.d1 = uint32(b[0])<<24 | uint32(b[1])<<16 | uint32(b[2])<<8 | uint32(b[3])
	g.d2 = uint16(b[4])<<8 | uint16(b[5])
	g.d3 = uint16(b[6])<<8 | uint16(b[7])
	copy(g.d4[:], b[8:])
	return g
}

// The interfaces, with their methods' places after IInspectable's six,
// as Windows' metadata lists them.
var (
	iidOcrEngineStatics       = mustGUID("5bffa85a-3384-3540-9940-699120d428a8") // 9 TryCreateFromLanguage, 10 TryCreateFromUserProfileLanguages
	iidSoftwareBitmapFactory  = mustGUID("c99feb69-2d62-4d47-a6b3-4fdb6a07fdf8") // 6 Create
	iidMemoryBuffer           = mustGUID("fbc4dd2a-245b-11e4-af98-689423260cf8") // 6 CreateReference
	iidMemoryBufferByteAccess = mustGUID("5b0d3235-4dba-4d44-865e-8f1d0e4fd04d") // 3 GetBuffer (IUnknown based)
	iidAsyncInfo              = mustGUID("00000036-0000-0000-c000-000000000046") // 7 Status, 8 ErrorCode
	iidClosable               = mustGUID("30d5a829-7fa4-4026-83bb-d75bae4ea99e") // 6 Close
	iidLanguageFactory        = mustGUID("9b0252ac-0c27-44f8-b792-9793fb66c63e") // 6 CreateLanguage
)

func hstring(s string) (uintptr, error) {
	u := syscall.StringToUTF16(s)
	var h uintptr
	if hr, _, _ := windowsCreateString.Call(uintptr(unsafe.Pointer(&u[0])), uintptr(len(u)-1), uintptr(unsafe.Pointer(&h))); int32(hr) < 0 {
		return 0, fmt.Errorf("WindowsCreateString 0x%08X", uint32(hr))
	}
	return h, nil
}

// takeString reads and frees an HSTRING.
func takeString(h uintptr) string {
	if h == 0 {
		return ""
	}
	defer windowsDeleteString.Call(h)
	var n uint32
	r, _, _ := windowsGetStringRaw.Call(h, uintptr(unsafe.Pointer(&n)))
	if r == 0 || n == 0 {
		return ""
	}
	p := *(**uint16)(unsafe.Pointer(&r))
	return syscall.UTF16ToString(unsafe.Slice(p, n))
}

func activationFactory(class string, iid *guid) (*comObj, error) {
	h, err := hstring(class)
	if err != nil {
		return nil, err
	}
	defer windowsDeleteString.Call(h)
	var f *comObj
	if hr, _, _ := roGetActivationFactory.Call(h, uintptr(unsafe.Pointer(iid)), uintptr(unsafe.Pointer(&f))); int32(hr) < 0 || f == nil {
		return nil, fmt.Errorf("%s 不可用（0x%08X）", class, uint32(hr))
	}
	return f, nil
}

// ocrJob is an image to read on the OCR thread.
type ocrJob struct {
	img  *image.RGBA
	done chan ocrDone
}

type ocrDone struct {
	res OCRResult
	err error
}

var ocrJobs chan ocrJob

// recognize reads the text of an image with Windows' OCR, in the user's
// languages. WinRT wants a thread of its own, set up once.
func recognize(img *image.RGBA) (OCRResult, error) {
	if ocrJobs == nil {
		ocrJobs = make(chan ocrJob)
		go ocrThread()
	}
	job := ocrJob{img: img, done: make(chan ocrDone, 1)}
	ocrJobs <- job
	d := <-job.done
	return d.res, d.err
}

// ocrEngine is a recognizer and its language, as zh-Hans-CN.
type ocrEngine struct {
	obj *comObj
	tag string
}

// spaced is whether the language puts spaces between its words.
func (e *ocrEngine) spaced() bool {
	return !strings.HasPrefix(e.tag, "zh") && !strings.HasPrefix(e.tag, "ja")
}

// ocrThread reads the jobs' images with the user's language's recognizer.
// Text mostly in letters, when that is Chinese, is read again with the
// English one, and the other way round, where Windows has it: each reads
// the other's text badly.
func ocrThread() {
	runtime.LockOSThread()
	roInitialize.Call(1) // RO_INIT_MULTITHREADED
	engines := map[string]*ocrEngine{}
	engine := func(tag string) (*ocrEngine, error) {
		if e := engines[tag]; e != nil {
			return e, nil
		}
		// Tried again every time: the language may have been installed.
		e, err := newOcrEngine(tag)
		if err == nil {
			engines[tag] = e
		}
		return e, err
	}
	for job := range ocrJobs {
		var d ocrDone
		var main *ocrEngine
		if main, d.err = engine(""); main != nil {
			d.res, d.err = runOcr(main.obj, job.img, main.spaced())
			want := "en-US"
			if mostlyChinese(d.res.Text) {
				want = "zh-Hans-CN"
			}
			if d.err == nil && !strings.HasPrefix(main.tag, want[:2]) {
				if other, _ := engine(want); other != nil {
					if res, err := runOcr(other.obj, job.img, other.spaced()); err == nil && len(res.Lines) > 0 {
						d.res = res
					}
				}
			}
		}
		job.done <- d
	}
}

// newOcrEngine makes the recognizer of a language, or of the user's
// languages for "".
func newOcrEngine(tag string) (*ocrEngine, error) {
	statics, err := activationFactory("Windows.Media.Ocr.OcrEngine", &iidOcrEngineStatics)
	if err != nil {
		return nil, err
	}
	defer statics.release()
	var engine *comObj
	if tag == "" {
		statics.call(10, uintptr(unsafe.Pointer(&engine))) // TryCreateFromUserProfileLanguages
	} else {
		f, err := activationFactory("Windows.Globalization.Language", &iidLanguageFactory)
		if err != nil {
			return nil, err
		}
		defer f.release()
		h, err := hstring(tag)
		if err != nil {
			return nil, err
		}
		defer windowsDeleteString.Call(h)
		var lang *comObj
		if hr := f.call(6, h, uintptr(unsafe.Pointer(&lang))); hr < 0 || lang == nil { // CreateLanguage
			return nil, fmt.Errorf("CreateLanguage 0x%08X", uint32(hr))
		}
		defer lang.release()
		statics.call(9, uintptr(unsafe.Pointer(lang)), uintptr(unsafe.Pointer(&engine))) // TryCreateFromLanguage
	}
	if engine == nil {
		if tag != "" {
			return nil, errors.New("没有 " + tag + " 的识别语言")
		}
		return nil, errors.New("Windows 没有可用的文字识别语言：在「设置 → 时间和语言 → 语言」里给中文或英文装上「光学字符识别」")
	}
	// Its language: 7 RecognizerLanguage, then ILanguage's 6 LanguageTag.
	e := &ocrEngine{obj: engine, tag: tag}
	var lang *comObj
	if engine.call(7, uintptr(unsafe.Pointer(&lang))) >= 0 && lang != nil {
		var hs uintptr
		lang.call(6, uintptr(unsafe.Pointer(&hs)))
		e.tag = takeString(hs)
		lang.release()
	}
	return e, nil
}

// softwareBitmap copies an image into a Bgra8 SoftwareBitmap.
func softwareBitmap(img *image.RGBA) (*comObj, error) {
	f, err := activationFactory("Windows.Graphics.Imaging.SoftwareBitmap", &iidSoftwareBitmapFactory)
	if err != nil {
		return nil, err
	}
	defer f.release()
	w, h := img.Rect.Dx(), img.Rect.Dy()
	var bmp *comObj
	const bgra8 = 87
	if hr := f.call(6, bgra8, uintptr(w), uintptr(h), uintptr(unsafe.Pointer(&bmp))); hr < 0 || bmp == nil {
		return nil, fmt.Errorf("SoftwareBitmap 0x%08X", uint32(hr))
	}
	var buf *comObj
	const write = 2 // BitmapBufferAccessMode.Write
	if hr := bmp.call(15, write, uintptr(unsafe.Pointer(&buf))); hr < 0 || buf == nil {
		bmp.release()
		return nil, fmt.Errorf("LockBuffer 0x%08X", uint32(hr))
	}
	defer func() {
		buf.close()
		buf.release()
	}()
	var plane struct{ start, width, height, stride int32 }
	buf.call(7, 0, uintptr(unsafe.Pointer(&plane))) // GetPlaneDescription
	mem, err := buf.query(&iidMemoryBuffer)
	if err != nil {
		bmp.release()
		return nil, err
	}
	defer mem.release()
	var ref *comObj
	if hr := mem.call(6, uintptr(unsafe.Pointer(&ref))); hr < 0 || ref == nil {
		bmp.release()
		return nil, fmt.Errorf("CreateReference 0x%08X", uint32(hr))
	}
	defer func() {
		ref.close()
		ref.release()
	}()
	access, err := ref.query(&iidMemoryBufferByteAccess)
	if err != nil {
		bmp.release()
		return nil, err
	}
	defer access.release()
	var data *byte
	var size uint32
	if hr := access.call(3, uintptr(unsafe.Pointer(&data)), uintptr(unsafe.Pointer(&size))); hr < 0 || data == nil {
		bmp.release()
		return nil, fmt.Errorf("GetBuffer 0x%08X", uint32(hr))
	}
	dst := unsafe.Slice(data, size)
	for y := range h {
		row := img.Pix[y*img.Stride : y*img.Stride+w*4]
		out := dst[int(plane.start)+y*int(plane.stride):]
		for x := 0; x < w*4; x += 4 {
			out[x], out[x+1], out[x+2], out[x+3] = row[x+2], row[x+1], row[x], 255
		}
	}
	return bmp, nil
}

// await waits for an IAsyncOperation and returns its result.
func await(op *comObj, timeout time.Duration) (*comObj, error) {
	info, err := op.query(&iidAsyncInfo)
	if err != nil {
		return nil, err
	}
	defer info.release()
	end := time.Now().Add(timeout)
	for {
		var status int32
		info.call(7, uintptr(unsafe.Pointer(&status)))
		switch status {
		case 0: // Started
			if time.Now().After(end) {
				info.call(9) // Cancel
				return nil, errors.New("文字识别超时")
			}
			time.Sleep(5 * time.Millisecond)
			continue
		case 1: // Completed
			var res *comObj
			if hr := op.call(8, uintptr(unsafe.Pointer(&res))); hr < 0 || res == nil {
				return nil, fmt.Errorf("GetResults 0x%08X", uint32(hr))
			}
			return res, nil
		default:
			var code int32
			info.call(8, uintptr(unsafe.Pointer(&code)))
			return nil, fmt.Errorf("文字识别失败（0x%08X）", uint32(code))
		}
	}
}

// vectorView walks an IVectorView: 6 GetAt, 7 Size.
func vectorView(v *comObj, fn func(item *comObj)) {
	var n uint32
	v.call(7, uintptr(unsafe.Pointer(&n)))
	for i := range n {
		var item *comObj
		if v.call(6, uintptr(i), uintptr(unsafe.Pointer(&item))) >= 0 && item != nil {
			fn(item)
			item.release()
		}
	}
}

// runOcr reads an image with a recognizer; spaced is whether its
// language puts spaces between words, as English does.
func runOcr(engine *comObj, img *image.RGBA, spaced bool) (OCRResult, error) {
	bmp, err := softwareBitmap(img)
	if err != nil {
		return OCRResult{}, err
	}
	defer func() {
		bmp.close()
		bmp.release()
	}()
	var op *comObj
	if hr := engine.call(6, uintptr(unsafe.Pointer(bmp)), uintptr(unsafe.Pointer(&op))); hr < 0 || op == nil {
		return OCRResult{}, fmt.Errorf("RecognizeAsync 0x%08X", uint32(hr))
	}
	defer op.release()
	res, err := await(op, 30*time.Second)
	if err != nil {
		return OCRResult{}, err
	}
	defer res.release()
	var lines *comObj
	if hr := res.call(6, uintptr(unsafe.Pointer(&lines))); hr < 0 || lines == nil {
		return OCRResult{}, fmt.Errorf("Lines 0x%08X", uint32(hr))
	}
	defer lines.release()
	out := OCRResult{Lines: []OCRLine{}}
	vectorView(lines, func(line *comObj) {
		var words *comObj
		if line.call(6, uintptr(unsafe.Pointer(&words))) < 0 || words == nil {
			return
		}
		defer words.release()
		var ws []ocrWord
		vectorView(words, func(word *comObj) {
			var w ocrWord
			word.call(6, uintptr(unsafe.Pointer(&w.r)))
			var hs uintptr
			word.call(7, uintptr(unsafe.Pointer(&hs)))
			if w.text = takeString(hs); w.text != "" {
				ws = append(ws, w)
			}
		})
		if len(ws) == 0 {
			return
		}
		l := OCRLine{Text: joinWords(ws, spaced)}
		x0, y0, x1, y1 := ws[0].r.x, ws[0].r.y, ws[0].r.x+ws[0].r.w, ws[0].r.y+ws[0].r.h
		for _, w := range ws[1:] {
			x0, y0, x1, y1 = min(x0, w.r.x), min(y0, w.r.y), max(x1, w.r.x+w.r.w), max(y1, w.r.y+w.r.h)
		}
		l.X, l.Y, l.W, l.H = int(x0), int(y0), int(x1-x0+0.5), int(y1-y0+0.5)
		out.Lines = append(out.Lines, l)
	})
	texts := make([]string, len(out.Lines))
	for i, l := range out.Lines {
		texts[i] = l.Text
	}
	out.Text = strings.Join(texts, "\n")
	return out, nil
}

// ocrWord is a recognized word and its box.
type ocrWord struct {
	text string
	r    struct{ x, y, w, h float32 }
}

// joinWords makes a line of its words. The Chinese recognizer sees every
// character and digit as a word: a space goes only where the words are
// well apart for the line's characters, and never beside the punctuation
// of such scripts, which has its space in it.
func joinWords(ws []ocrWord, spaced bool) string {
	texts := make([]string, len(ws))
	heights := make([]float32, len(ws))
	for i, w := range ws {
		texts[i], heights[i] = w.text, w.r.h
	}
	if spaced {
		return strings.Join(texts, " ")
	}
	slices.Sort(heights)
	h := heights[len(heights)/2]
	var b strings.Builder
	for i, w := range ws {
		if i > 0 {
			prev := ws[i-1]
			a, c := lastRune(prev.text), firstRune(w.text)
			gap := w.r.x - (prev.r.x + prev.r.w)
			apart := float32(0.35)
			if closeScript(a) && closeScript(c) {
				apart = 0.8
			}
			if !cjkPunct(a) && !cjkPunct(c) && gap > apart*h {
				b.WriteByte(' ')
			}
		}
		b.WriteString(w.text)
	}
	return b.String()
}

func cjkPunct(r rune) bool { return r >= 0x3000 && r <= 0x303f || r >= 0xff00 && r <= 0xffef }

// closeScript is whether r is written without spaces between words, as
// Chinese and Japanese, or is their punctuation.
func closeScript(r rune) bool {
	return unicode.In(r, unicode.Han, unicode.Hiragana, unicode.Katakana) || cjkPunct(r)
}

func firstRune(s string) rune {
	for _, r := range s {
		return r
	}
	return 0
}

func lastRune(s string) rune {
	r := []rune(s)
	if len(r) == 0 {
		return 0
	}
	return r[len(r)-1]
}

var (
	getCursorPos = user32.NewProc("GetCursorPos")
	setCursorPos = user32.NewProc("SetCursorPos")
	sendInput    = user32.NewProc("SendInput")
)

// cursorPos is where the pointer is on the virtual screen, in pixels.
func cursorPos() image.Point {
	var p struct{ x, y int32 }
	getCursorPos.Call(uintptr(unsafe.Pointer(&p)))
	return image.Pt(int(p.x), int(p.y))
}

func moveCursor(p image.Point) {
	setCursorPos.Call(uintptr(int32(p.X)), uintptr(int32(p.Y)))
}

// wheelDown turns the mouse wheel a notch towards the user, for the
// window under the pointer to scroll down.
func wheelDown() {
	in := struct {
		typ         uint32
		_           uint32
		dx, dy      int32
		data, flags uint32
		time        uint32
		_           uint32
		extra       uintptr
	}{typ: 0, data: uint32(0xFFFFFF88), flags: 0x0800} // INPUT_MOUSE, -120, MOUSEEVENTF_WHEEL
	sendInput.Call(1, uintptr(unsafe.Pointer(&in)), unsafe.Sizeof(in))
}
