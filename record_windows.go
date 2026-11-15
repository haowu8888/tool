package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"math"
	"runtime"
	"slices"
	"syscall"
	"time"
	"unsafe"
)

// Screen recording: GDI takes the region's picture every frame, WASAPI
// gives what the speakers play (loopback) and the microphone hears, and
// Media Foundation's sink writer encodes them, H.264 and AAC, into an MP4.
// It all runs on one thread of its own.

var (
	ole32                  = syscall.NewLazyDLL("ole32.dll")
	coInitializeEx         = ole32.NewProc("CoInitializeEx")
	coUninitialize         = ole32.NewProc("CoUninitialize")
	coCreateInstance       = ole32.NewProc("CoCreateInstance")
	coTaskMemFree          = ole32.NewProc("CoTaskMemFree")
	mfplat                 = syscall.NewLazyDLL("mfplat.dll")
	mfStartup              = mfplat.NewProc("MFStartup")
	mfShutdown             = mfplat.NewProc("MFShutdown")
	mfCreateMediaType      = mfplat.NewProc("MFCreateMediaType")
	mfCreateAttributes     = mfplat.NewProc("MFCreateAttributes")
	mfCreateSample         = mfplat.NewProc("MFCreateSample")
	mfCreateMemoryBuffer   = mfplat.NewProc("MFCreateMemoryBuffer")
	mfreadwrite            = syscall.NewLazyDLL("mfreadwrite.dll")
	mfCreateSinkWriter     = mfreadwrite.NewProc("MFCreateSinkWriterFromURL")
	queryPerformanceCount  = kernel32.NewProc("QueryPerformanceCounter")
	queryPerformanceFreq   = kernel32.NewProc("QueryPerformanceFrequency")
	getCursorInfo          = user32.NewProc("GetCursorInfo")
	getIconInfo            = user32.NewProc("GetIconInfo")
	drawIconEx             = user32.NewProc("DrawIconEx")
	gdiFlush               = gdi32.NewProc("GdiFlush")
	recordQPCFrequency     int64
	recordAudioRate        = 48000 // what the AAC encoder takes, and the file has
	recordAudioLatency     = int64(3_000_000)
	recordAudioMaxAheadSec = 1
)

// Media Foundation's GUIDs.
var (
	mfMTMajorType        = mustGUID("48eba18e-f8c9-4687-bf11-0a74c9f96a8f")
	mfMTSubtype          = mustGUID("f7e34c9a-42e8-4714-b74b-cb29d72c35e5")
	mfMTAvgBitrate       = mustGUID("20332624-fb0d-4d9e-bd0d-cbf6786c102e")
	mfMTInterlaceMode    = mustGUID("e2724bb8-e676-4806-b4b2-a8d6efb44ccd")
	mfMTFrameSize        = mustGUID("1652c33d-d6b2-4012-b834-72030849a37d")
	mfMTFrameRate        = mustGUID("c459a2e8-3d2c-4e44-b132-fee5156c7bb0")
	mfMTPixelAspect      = mustGUID("c6376a1e-8d0a-4027-be45-6d9a0ad39bb6")
	mfMTDefaultStride    = mustGUID("644b4e48-1e02-4516-b0eb-c01ca9d49ac6")
	mfMTMpeg2Profile     = mustGUID("ad76a80b-2d5c-4e0b-b375-64e520137036")
	mfMTAudioChannels    = mustGUID("37e48bf5-645e-4c5b-89de-ada9e29b696a")
	mfMTAudioRate        = mustGUID("5faeeae7-0290-4c31-9e8a-c534f68d9dba")
	mfMTAudioBits        = mustGUID("f2deb57f-40fa-4764-aa33-ed4f2d1ff669")
	mfMTAudioAvgBytes    = mustGUID("1aab75c8-cfef-451c-ab95-ac034b8e1731")
	mfMTAudioBlockAlign  = mustGUID("322de230-9eeb-43bd-ab7a-ff412251541d")
	mfMediaTypeVideo     = mustGUID("73646976-0000-0010-8000-00aa00389b71")
	mfMediaTypeAudio     = mustGUID("73647561-0000-0010-8000-00aa00389b71")
	mfVideoFormatH264    = mustGUID("34363248-0000-0010-8000-00aa00389b71")
	mfVideoFormatRGB32   = mustGUID("00000016-0000-0010-8000-00aa00389b71")
	mfAudioFormatAAC     = mustGUID("00001610-0000-0010-8000-00aa00389b71")
	mfAudioFormatPCM     = mustGUID("00000001-0000-0010-8000-00aa00389b71")
	mfHardwareTransforms = mustGUID("a634a91c-822b-41b9-a494-4de4643612b0")
)

// WASAPI's.
var (
	clsidMMDeviceEnumerator = mustGUID("bcde0395-e52f-467c-8e3d-c4579291692e")
	iidMMDeviceEnumerator   = mustGUID("a95664d2-9614-4f35-a746-de8db63617e6")
	iidAudioClient          = mustGUID("1cb9ad4c-dbfa-4c32-b178-c2f568a703b2")
	iidAudioCaptureClient   = mustGUID("c8adbd64-e71e-48a0-a4de-185c395cd317")
)

// clock100ns is the recording's clock, in 100 ns: the performance
// counter, which WASAPI stamps its packets with too.
func clock100ns() int64 {
	if recordQPCFrequency == 0 {
		queryPerformanceFreq.Call(uintptr(unsafe.Pointer(&recordQPCFrequency)))
	}
	var c int64
	queryPerformanceCount.Call(uintptr(unsafe.Pointer(&c)))
	return int64(float64(c) * 1e7 / float64(recordQPCFrequency))
}

func hrErr(what string, hr int32) error {
	if hr >= 0 {
		return nil
	}
	return fmt.Errorf("%s 失败（0x%08X）", what, uint32(hr))
}

// recordScreen records rc's region until rc.stop is closed.
func recordScreen(rc *recording) error {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	coInitializeEx.Call(0, 0) // COINIT_MULTITHREADED
	defer coUninitialize.Call()
	if hr, _, _ := mfStartup.Call(0x20070, 0); int32(hr) < 0 {
		return hrErr("Media Foundation 启动", int32(hr))
	}
	defer mfShutdown.Call()

	g, err := newScreenGrabber(rc.rect, rc.opts.Cursor)
	if err != nil {
		return err
	}
	defer g.close()

	var srcs []*audioSource
	defer func() {
		for _, a := range srcs {
			a.close()
		}
	}()
	var notes []string
	if rc.opts.Sound {
		if a, err := openAudio(true); err != nil {
			notes = append(notes, "系统声音没录上："+err.Error())
		} else {
			srcs = append(srcs, a)
		}
	}
	if rc.opts.Mic {
		if a, err := openAudio(false); err != nil {
			notes = append(notes, "麦克风没录上："+err.Error())
		} else {
			srcs = append(srcs, a)
		}
	}
	w, h, fps := rc.rect.Dx(), rc.rect.Dy(), rc.opts.FPS
	mw, err := newMP4Writer(rc.path, w, h, fps, len(srcs) > 0, true)
	if err != nil {
		// Some hardware encoders refuse what the software one takes.
		mw, err = newMP4Writer(rc.path, w, h, fps, len(srcs) > 0, false)
	}
	if err != nil {
		return err
	}
	finished := false
	defer func() {
		if !finished {
			mw.release()
		}
	}()
	for _, a := range srcs {
		if err := a.begin(); err != nil {
			notes = append(notes, err.Error())
		}
	}
	rc.started(clock100ns(), notes)

	frameDur := int64(1e7) / int64(fps)
	lastFrame := int64(-1)
	var written int64 // audio frames given to the writer
	var mix []float32
	var pcm []byte
	// emit writes the sound up to t, mixed: silence where a source gave
	// nothing.
	emit := func(t int64) error {
		target := t * int64(recordAudioRate) / 1e7
		if len(srcs) == 0 || target <= written {
			return nil
		}
		n := int(target - written)
		mix = slices.Grow(mix[:0], n*2)[:n*2]
		clear(mix)
		for _, a := range srcs {
			a.take(written, mix)
		}
		pcm = slices.Grow(pcm[:0], n*4)[:n*4]
		for i, v := range mix {
			s := int16(math.Max(-1, math.Min(1, float64(v))) * 32767)
			binary.LittleEndian.PutUint16(pcm[i*2:], uint16(s))
		}
		err := mw.writeAudio(pcm, written*1e7/int64(recordAudioRate), int64(n)*1e7/int64(recordAudioRate))
		written = target
		return err
	}
	next := clock100ns()
	for {
		select {
		case <-rc.stop:
			if rc.discarded() {
				return nil
			}
			// The sound still on its way.
			t, _ := rc.pos(clock100ns())
			for _, a := range srcs {
				a.read(rc)
			}
			err := emit(t)
			finished = true
			if e := mw.finish(); err == nil {
				err = e
			}
			return err
		default:
		}
		if d := next - clock100ns(); d > 0 {
			time.Sleep(time.Duration(d * 100))
		}
		now := clock100ns()
		next += frameDur
		if next < now {
			next = now + frameDur // too slow: frames are left out
		}
		t, paused := rc.pos(now)
		for _, a := range srcs {
			a.read(rc)
		}
		if paused {
			continue
		}
		if n := t / frameDur; n > lastFrame {
			bgra, err := g.grab()
			if err == nil {
				err = mw.writeVideo(bgra, n*frameDur, frameDur)
			}
			if err != nil {
				return err
			}
			lastFrame = n
		}
		// Up to a little while ago, which every source has given by now.
		if err := emit(t - recordAudioLatency); err != nil {
			return err
		}
	}
}

// ---- The region's picture ----

type screenGrabber struct {
	rect   image.Rectangle
	cursor bool
	screen uintptr
	mem    uintptr
	bmp    uintptr
	old    uintptr
	bits   []byte
	hot    map[uintptr]image.Point // a cursor's hot spot
}

func newScreenGrabber(r image.Rectangle, cursor bool) (*screenGrabber, error) {
	g := &screenGrabber{rect: r, cursor: cursor, hot: map[uintptr]image.Point{}}
	g.screen, _, _ = getDC.Call(0)
	if g.screen == 0 {
		return nil, errors.New("拿不到屏幕")
	}
	g.mem, _, _ = createCompatibleDC.Call(g.screen)
	if g.mem == 0 {
		g.close()
		return nil, errors.New("CreateCompatibleDC 失败")
	}
	bi := struct {
		size                 uint32
		width, height        int32
		planes, bitCount     uint16
		compression, sizeImg uint32
		xppm, yppm           int32
		clrUsed, clrImp      uint32
	}{width: int32(r.Dx()), height: -int32(r.Dy()), planes: 1, bitCount: 32} // top-down BGRA
	bi.size = uint32(unsafe.Sizeof(bi))
	var bits *byte
	g.bmp, _, _ = createDIBSection.Call(g.screen, uintptr(unsafe.Pointer(&bi)), 0, uintptr(unsafe.Pointer(&bits)), 0, 0)
	if g.bmp == 0 || bits == nil {
		g.close()
		return nil, errors.New("CreateDIBSection 失败")
	}
	g.old, _, _ = selectObject.Call(g.mem, g.bmp)
	g.bits = unsafe.Slice(bits, r.Dx()*r.Dy()*4)
	return g, nil
}

// grab takes the region's picture, with the pointer on it, as top-down
// BGRA.
func (g *screenGrabber) grab() ([]byte, error) {
	const srcCopy, captureBlt = 0x00CC0020, 0x40000000
	r := g.rect
	if ok, _, err := bitBlt.Call(g.mem, 0, 0, uintptr(r.Dx()), uintptr(r.Dy()), g.screen, uintptr(int32(r.Min.X)), uintptr(int32(r.Min.Y)), srcCopy|captureBlt); ok == 0 {
		return nil, fmt.Errorf("截屏失败：%v", err)
	}
	if g.cursor {
		g.drawCursor()
	}
	gdiFlush.Call()
	return g.bits, nil
}

func (g *screenGrabber) drawCursor() {
	ci := struct {
		size   uint32
		flags  uint32
		cursor uintptr
		x, y   int32
	}{}
	ci.size = uint32(unsafe.Sizeof(ci))
	if ok, _, _ := getCursorInfo.Call(uintptr(unsafe.Pointer(&ci))); ok == 0 || ci.flags&1 == 0 || ci.cursor == 0 {
		return
	}
	hot, ok := g.hot[ci.cursor]
	if !ok {
		ii := struct {
			icon       int32
			x, y       uint32
			mask, colr uintptr
		}{}
		if r, _, _ := getIconInfo.Call(ci.cursor, uintptr(unsafe.Pointer(&ii))); r != 0 {
			hot = image.Pt(int(ii.x), int(ii.y))
			if ii.mask != 0 {
				deleteObject.Call(ii.mask)
			}
			if ii.colr != 0 {
				deleteObject.Call(ii.colr)
			}
		}
		g.hot[ci.cursor] = hot
	}
	x, y := int(ci.x)-hot.X-g.rect.Min.X, int(ci.y)-hot.Y-g.rect.Min.Y
	if x > g.rect.Dx() || y > g.rect.Dy() || x < -64 || y < -64 {
		return
	}
	const diNormal = 3
	drawIconEx.Call(g.mem, uintptr(int32(x)), uintptr(int32(y)), ci.cursor, 0, 0, 0, 0, diNormal)
}

func (g *screenGrabber) close() {
	if g.old != 0 {
		selectObject.Call(g.mem, g.old)
	}
	if g.bmp != 0 {
		deleteObject.Call(g.bmp)
	}
	if g.mem != 0 {
		deleteDC.Call(g.mem)
	}
	if g.screen != 0 {
		releaseDC.Call(0, g.screen)
	}
}

// ---- The MP4 ----

// mp4Writer is Media Foundation's sink writer, with a video stream and,
// if asked, an audio one.
type mp4Writer struct {
	w           *comObj
	video       uint32
	audio       uint32
	frameSize   int
	stride      int
	height      int
	attrs, outV *comObj
}

func newMediaType() (*comObj, error) {
	var t *comObj
	if hr, _, _ := mfCreateMediaType.Call(uintptr(unsafe.Pointer(&t))); int32(hr) < 0 || t == nil {
		return nil, hrErr("MFCreateMediaType", int32(hr))
	}
	return t, nil
}

// The IMFAttributes methods, which media types and samples have too.
const (
	attrSetUINT32 = 21
	attrSetUINT64 = 22
	attrSetGUID   = 24
)

func setGUID(o *comObj, key, v *guid) {
	o.call(attrSetGUID, uintptr(unsafe.Pointer(key)), uintptr(unsafe.Pointer(v)))
}

func setU32(o *comObj, key *guid, v uint32) {
	o.call(attrSetUINT32, uintptr(unsafe.Pointer(key)), uintptr(v))
}

func setU64(o *comObj, key *guid, hi, lo uint32) {
	o.call(attrSetUINT64, uintptr(unsafe.Pointer(key)), uintptr(uint64(hi)<<32|uint64(lo)))
}

// The IMFSinkWriter methods.
const (
	swAddStream         = 3
	swSetInputMediaType = 4
	swBeginWriting      = 5
	swWriteSample       = 6
	swFinalize          = 11
)

func newMP4Writer(path string, w, h, fps int, audio, hardware bool) (m *mp4Writer, err error) {
	var attrs *comObj
	if hr, _, _ := mfCreateAttributes.Call(uintptr(unsafe.Pointer(&attrs)), 2); int32(hr) < 0 || attrs == nil {
		return nil, hrErr("MFCreateAttributes", int32(hr))
	}
	defer attrs.release()
	if hardware {
		setU32(attrs, &mfHardwareTransforms, 1)
	}
	p, _ := syscall.UTF16PtrFromString(path)
	var sw *comObj
	if hr, _, _ := mfCreateSinkWriter.Call(uintptr(unsafe.Pointer(p)), 0, uintptr(unsafe.Pointer(attrs)), uintptr(unsafe.Pointer(&sw))); int32(hr) < 0 || sw == nil {
		return nil, hrErr("创建视频文件", int32(hr))
	}
	m = &mp4Writer{w: sw, frameSize: w * h * 4, stride: w * 4, height: h}
	defer func() {
		if err != nil {
			m.release()
		}
	}()

	out, err := newMediaType()
	if err != nil {
		return nil, err
	}
	defer out.release()
	// Screens are mostly still: about 0.07 bits a pixel a frame keeps
	// text sharp, between 2 and 16 Mbps (1080p at 30: 4.4 Mbps).
	bitrate := min(max(float64(w*h*fps)*0.07, 2e6), 16e6)
	setGUID(out, &mfMTMajorType, &mfMediaTypeVideo)
	setGUID(out, &mfMTSubtype, &mfVideoFormatH264)
	setU32(out, &mfMTAvgBitrate, uint32(bitrate))
	setU32(out, &mfMTInterlaceMode, 2) // progressive
	setU32(out, &mfMTMpeg2Profile, 77)  // Main, which every player takes
	setU64(out, &mfMTFrameSize, uint32(w), uint32(h))
	setU64(out, &mfMTFrameRate, uint32(fps), 1)
	setU64(out, &mfMTPixelAspect, 1, 1)
	if hr := sw.call(swAddStream, uintptr(unsafe.Pointer(out)), uintptr(unsafe.Pointer(&m.video))); hr < 0 {
		return nil, hrErr("添加视频轨", hr)
	}
	in, err := newMediaType()
	if err != nil {
		return nil, err
	}
	defer in.release()
	setGUID(in, &mfMTMajorType, &mfMediaTypeVideo)
	setGUID(in, &mfMTSubtype, &mfVideoFormatRGB32)
	setU32(in, &mfMTInterlaceMode, 2)
	setU32(in, &mfMTDefaultStride, uint32(w*4)) // positive: top-down
	setU64(in, &mfMTFrameSize, uint32(w), uint32(h))
	setU64(in, &mfMTFrameRate, uint32(fps), 1)
	setU64(in, &mfMTPixelAspect, 1, 1)
	if hr := sw.call(swSetInputMediaType, uintptr(m.video), uintptr(unsafe.Pointer(in)), 0); hr < 0 {
		return nil, hrErr("设置视频编码", hr)
	}

	if audio {
		ao, err := newMediaType()
		if err != nil {
			return nil, err
		}
		defer ao.release()
		setGUID(ao, &mfMTMajorType, &mfMediaTypeAudio)
		setGUID(ao, &mfMTSubtype, &mfAudioFormatAAC)
		setU32(ao, &mfMTAudioBits, 16)
		setU32(ao, &mfMTAudioRate, uint32(recordAudioRate))
		setU32(ao, &mfMTAudioChannels, 2)
		setU32(ao, &mfMTAudioAvgBytes, 24000) // 192 kbps
		if hr := sw.call(swAddStream, uintptr(unsafe.Pointer(ao)), uintptr(unsafe.Pointer(&m.audio))); hr < 0 {
			return nil, hrErr("添加音轨", hr)
		}
		ai, err := newMediaType()
		if err != nil {
			return nil, err
		}
		defer ai.release()
		setGUID(ai, &mfMTMajorType, &mfMediaTypeAudio)
		setGUID(ai, &mfMTSubtype, &mfAudioFormatPCM)
		setU32(ai, &mfMTAudioBits, 16)
		setU32(ai, &mfMTAudioRate, uint32(recordAudioRate))
		setU32(ai, &mfMTAudioChannels, 2)
		setU32(ai, &mfMTAudioBlockAlign, 4)
		setU32(ai, &mfMTAudioAvgBytes, uint32(recordAudioRate*4))
		if hr := sw.call(swSetInputMediaType, uintptr(m.audio), uintptr(unsafe.Pointer(ai)), 0); hr < 0 {
			return nil, hrErr("设置音频编码", hr)
		}
	}
	if hr := sw.call(swBeginWriting); hr < 0 {
		return nil, hrErr("开始写视频", hr)
	}
	return m, nil
}

// The IMFSample and IMFMediaBuffer methods.
const (
	smpSetTime     = 36
	smpSetDuration = 38
	smpAddBuffer   = 42
	bufLock        = 3
	bufUnlock      = 4
	bufSetLength   = 6
)

// write gives the writer a sample of data at t for dur, in 100 ns.
func (m *mp4Writer) write(stream uint32, data []byte, t, dur int64) error {
	var buf *comObj
	if hr, _, _ := mfCreateMemoryBuffer.Call(uintptr(len(data)), uintptr(unsafe.Pointer(&buf))); int32(hr) < 0 || buf == nil {
		return hrErr("MFCreateMemoryBuffer", int32(hr))
	}
	defer buf.release()
	var p *byte
	if hr := buf.call(bufLock, uintptr(unsafe.Pointer(&p)), 0, 0); hr < 0 || p == nil {
		return hrErr("Lock", hr)
	}
	copy(unsafe.Slice(p, len(data)), data)
	buf.call(bufUnlock)
	buf.call(bufSetLength, uintptr(len(data)))
	var smp *comObj
	if hr, _, _ := mfCreateSample.Call(uintptr(unsafe.Pointer(&smp))); int32(hr) < 0 || smp == nil {
		return hrErr("MFCreateSample", int32(hr))
	}
	defer smp.release()
	smp.call(smpAddBuffer, uintptr(unsafe.Pointer(buf)))
	smp.call(smpSetTime, uintptr(t))
	smp.call(smpSetDuration, uintptr(dur))
	if hr := m.w.call(swWriteSample, uintptr(stream), uintptr(unsafe.Pointer(smp))); hr < 0 {
		return hrErr("写入视频", hr)
	}
	return nil
}

func (m *mp4Writer) writeVideo(bgra []byte, t, dur int64) error {
	return m.write(m.video, bgra[:m.frameSize], t, dur)
}

func (m *mp4Writer) writeAudio(pcm []byte, t, dur int64) error {
	return m.write(m.audio, pcm, t, dur)
}

// finish writes the end of the file, which makes it playable.
func (m *mp4Writer) finish() error {
	defer m.release()
	return hrErr("保存视频", m.w.call(swFinalize))
}

func (m *mp4Writer) release() {
	if m.w != nil {
		m.w.release()
		m.w = nil
	}
}

// ---- The sound ----

// audioSource is the speakers' sound, or the microphone's, turned into
// stereo float samples at recordAudioRate, laid out on the recording's
// time line.
type audioSource struct {
	client   *comObj
	capture  *comObj
	channels int
	rate     int
	format   int // 3 float, 1 integer
	bits     int
	block    int
	// buf holds the samples from the frame base on, interleaved.
	buf  []float32
	base int64
	dead bool
	// The resampler's place between two input frames, and the last frame.
	frac float64
	last [2]float32
}

// openAudio opens the default speakers, to record what they play, or the
// default microphone.
func openAudio(loopback bool) (*audioSource, error) {
	var en *comObj
	if hr, _, _ := coCreateInstance.Call(uintptr(unsafe.Pointer(&clsidMMDeviceEnumerator)), 0, 0x17, uintptr(unsafe.Pointer(&iidMMDeviceEnumerator)), uintptr(unsafe.Pointer(&en))); int32(hr) < 0 || en == nil {
		return nil, hrErr("打开声音设备列表", int32(hr))
	}
	defer en.release()
	flow := uintptr(1) // eCapture
	if loopback {
		flow = 0 // eRender
	}
	var dev *comObj
	if hr := en.call(4, flow, 0, uintptr(unsafe.Pointer(&dev))); hr < 0 || dev == nil {
		if loopback {
			return nil, errors.New("没有扬声器")
		}
		return nil, errors.New("没有麦克风")
	}
	defer dev.release()
	a := &audioSource{}
	if hr := dev.call(3, uintptr(unsafe.Pointer(&iidAudioClient)), 0x17, 0, uintptr(unsafe.Pointer(&a.client))); hr < 0 || a.client == nil {
		return nil, hrErr("打开声音设备", hr)
	}
	var wf *byte
	if hr := a.client.call(8, uintptr(unsafe.Pointer(&wf))); hr < 0 || wf == nil {
		a.close()
		return nil, hrErr("读声音格式", hr)
	}
	defer coTaskMemFree.Call(uintptr(unsafe.Pointer(wf)))
	h := unsafe.Slice(wf, 40)
	le := binary.LittleEndian
	tag := le.Uint16(h[0:])
	a.channels = int(le.Uint16(h[2:]))
	a.rate = int(le.Uint32(h[4:]))
	a.block = int(le.Uint16(h[12:]))
	a.bits = int(le.Uint16(h[14:]))
	a.format = int(tag)
	if tag == 0xFFFE { // WAVE_FORMAT_EXTENSIBLE: the sub-format's first word
		a.format = int(le.Uint16(h[24:]))
	}
	if !(a.format == 3 && a.bits == 32 || a.format == 1 && (a.bits == 16 || a.bits == 32)) || a.channels < 1 || a.rate < 8000 {
		a.close()
		return nil, fmt.Errorf("不支持的声音格式（%d 位，格式 %d）", a.bits, a.format)
	}
	flags := uintptr(0)
	if loopback {
		flags = 0x00020000 // AUDCLNT_STREAMFLAGS_LOOPBACK
	}
	// Shared, a second of buffer: it is read every frame.
	if hr := a.client.call(3, 0, flags, 10_000_000, 0, uintptr(unsafe.Pointer(wf)), 0); hr < 0 {
		a.close()
		return nil, hrErr("打开声音设备", hr)
	}
	iid := iidAudioCaptureClient
	if hr := a.client.call(14, uintptr(unsafe.Pointer(&iid)), uintptr(unsafe.Pointer(&a.capture))); hr < 0 || a.capture == nil {
		a.close()
		return nil, hrErr("打开录音", hr)
	}
	return a, nil
}

func (a *audioSource) begin() error {
	return hrErr("开始录音", a.client.call(10))
}

// read takes the packets waiting, and puts them where their time stamps
// say on the recording's time line. Sound from a pause is let go.
func (a *audioSource) read(rc *recording) {
	if a.dead {
		return
	}
	for {
		var n uint32
		if hr := a.capture.call(5, uintptr(unsafe.Pointer(&n))); hr < 0 {
			a.dead = true
			return
		}
		if n == 0 {
			return
		}
		var data *byte
		var frames, flags uint32
		var devPos, qpc uint64
		if hr := a.capture.call(3, uintptr(unsafe.Pointer(&data)), uintptr(unsafe.Pointer(&frames)), uintptr(unsafe.Pointer(&flags)), uintptr(unsafe.Pointer(&devPos)), uintptr(unsafe.Pointer(&qpc))); hr < 0 {
			a.dead = true
			return
		}
		if t, paused := rc.pos(int64(qpc)); !paused && frames > 0 {
			var raw []byte
			if flags&2 == 0 && data != nil { // not AUDCLNT_BUFFERFLAGS_SILENT
				raw = unsafe.Slice(data, int(frames)*a.block)
			}
			a.put(t, raw, int(frames))
		}
		a.capture.call(4, uintptr(frames))
	}
}

// put adds frames recorded at t (100 ns into the recording); raw nil is
// silence.
func (a *audioSource) put(t int64, raw []byte, frames int) {
	at := t * int64(recordAudioRate) / 1e7
	end := a.base + int64(len(a.buf)/2)
	// After a silence the speakers give nothing: the gap is filled up to
	// where the sound starts again. Jitter of a few milliseconds is not.
	if gap := at - end; gap > int64(recordAudioRate)/50 {
		for range gap * 2 {
			a.buf = append(a.buf, 0)
		}
		a.frac = 0
	}
	le := binary.LittleEndian
	sample := func(i, ch int) float32 {
		if raw == nil {
			return 0
		}
		c := min(ch, a.channels-1)
		o := i*a.block + c*a.bits/8
		switch {
		case a.format == 3:
			return math.Float32frombits(le.Uint32(raw[o:]))
		case a.bits == 16:
			return float32(int16(le.Uint16(raw[o:]))) / 32768
		default:
			return float32(int32(le.Uint32(raw[o:]))) / 2147483648
		}
	}
	if a.rate == recordAudioRate {
		for i := range frames {
			a.buf = append(a.buf, sample(i, 0), sample(i, 1))
		}
	} else {
		// Linear interpolation is enough for a voice or a video's sound.
		step := float64(a.rate) / float64(recordAudioRate)
		for i := range frames {
			l, r := sample(i, 0), sample(i, 1)
			for a.frac < 1 {
				f := float32(a.frac)
				a.buf = append(a.buf, a.last[0]+(l-a.last[0])*f, a.last[1]+(r-a.last[1])*f)
				a.frac += step
			}
			a.frac--
			a.last = [2]float32{l, r}
		}
	}
	// A clock that runs fast leaves a source ahead: what is too far ahead
	// goes, rather than the sound drifting off the picture.
	if over := len(a.buf)/2 - (recordAudioMaxAheadSec+1)*recordAudioRate; over > 0 {
		a.buf = a.buf[over*2:]
		a.base += int64(over)
	}
}

// take mixes the frames from `from` on, as many as mix holds, into mix,
// and lets them go. Where the source has nothing, it was silent.
func (a *audioSource) take(from int64, mix []float32) {
	n := int64(len(mix) / 2)
	if a.base < from {
		skip := min(from-a.base, int64(len(a.buf)/2))
		a.buf = a.buf[skip*2:]
		a.base = from
	}
	off := a.base - from // a source that starts later
	used := max(0, min(n-off, int64(len(a.buf)/2)))
	for i := range used * 2 {
		mix[off*2+i] += a.buf[i]
	}
	a.buf = a.buf[used*2:]
	a.base += used
	if len(a.buf) == 0 {
		a.base = max(a.base, from+n)
	}
}

func (a *audioSource) close() {
	if a.client != nil {
		a.client.call(11) // Stop
	}
	a.capture.release()
	a.client.release()
	a.capture, a.client = nil, nil
}
