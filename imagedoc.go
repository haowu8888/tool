package main

import (
	"archive/zip"
	"bufio"
	"bytes"
	"compress/zlib"
	"encoding/base64"
	"errors"
	"fmt"
	"html"
	"image"
	"image/draw"
	"image/jpeg"
	"image/png"
	"io"
	"math"
	"os"
	"strconv"
	"strings"
	"time"
)

// 合并文档 puts pictures one per page into a PDF or a PowerPoint file. The
// page sends them in order, each a JPG or a PNG, after the user picked
// where the file goes; Go lays out the pages and writes the file.

// DocOptions is how 合并文档 lays out its pages.
type DocOptions struct {
	Kind string `json:"kind"` // pdf or pptx
	// Page is the pages' size: fit (each the picture's; a PowerPoint's all
	// of the first's shape), a4, a4l (landscape) or wide (16:9).
	Page   string `json:"page"`
	Margin int    `json:"margin"` // 0 none, 1 small, 2 large
	Name   string `json:"name"`   // the file's name, without extension
}

type docJob struct {
	path  string
	opts  DocOptions
	pages []docPage
}

// docPage is a picture of a page: a JPG or a PNG and its size in pixels.
type docPage struct {
	data   []byte
	format string // jpeg or png
	w, h   int
}

// docBox is a page and where its picture goes, in points from the top
// left.
type docBox struct {
	W, H         float64
	X, Y, IW, IH float64
}

// DocBegin asks where to write a document; it returns the job the pages go
// to, or "" when canceled.
func (m *ImageEdit) DocBegin(opts DocOptions) (string, error) {
	ext, label := "pdf", "PDF 文档"
	switch opts.Kind {
	case "pdf":
	case "pptx":
		ext, label = "pptx", "PowerPoint 演示文稿"
	default:
		return "", errors.New("不支持的格式：" + opts.Kind)
	}
	path, err := m.savePath("导出文档", ext, label, "", opts.Name)
	if err != nil || path == "" {
		return "", err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.docs == nil {
		m.docs = map[string]*docJob{}
	}
	m.seq++
	id := "doc" + strconv.Itoa(m.seq)
	m.docs[id] = &docJob{path: path, opts: opts}
	return id, nil
}

// DocAdd adds the next page's picture, base64, in a format: jpeg or png.
func (m *ImageEdit) DocAdd(job, data, format string) error {
	b, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return err
	}
	var cfg image.Config
	switch format {
	case "jpeg":
		cfg, err = jpeg.DecodeConfig(bytes.NewReader(b))
	case "png":
		cfg, err = png.DecodeConfig(bytes.NewReader(b))
	default:
		err = errors.New("PDF 和 PPT 里的图片只能是 JPG 或 PNG")
	}
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	j := m.docs[job]
	if j == nil {
		return errors.New("导出已经取消")
	}
	j.pages = append(j.pages, docPage{data: b, format: format, w: cfg.Width, h: cfg.Height})
	return nil
}

// DocCancel drops a job.
func (m *ImageEdit) DocCancel(job string) {
	m.mu.Lock()
	delete(m.docs, job)
	m.mu.Unlock()
}

// DocFinish writes a job's file and returns it.
func (m *ImageEdit) DocFinish(job string) (string, error) {
	m.mu.Lock()
	j := m.docs[job]
	delete(m.docs, job)
	m.mu.Unlock()
	if j == nil {
		return "", errors.New("导出已经取消")
	}
	if len(j.pages) == 0 {
		return "", errors.New("没有页面")
	}
	tmp := j.path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return "", err
	}
	w := bufio.NewWriterSize(f, 1<<20)
	if j.opts.Kind == "pptx" {
		err = writePPTX(w, j.pages, j.opts)
	} else {
		err = writePDF(w, j.pages, j.opts)
	}
	if err == nil {
		err = w.Flush()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Rename(tmp, j.path)
	}
	if err != nil {
		os.Remove(tmp)
		return "", err
	}
	return j.path, nil
}

// pageSize is a fixed page's size in points, or false for fit.
func pageSize(page string) (float64, float64, bool) {
	switch page {
	case "a4":
		return 595.28, 841.89, true
	case "a4l":
		return 841.89, 595.28, true
	case "wide":
		return 960, 540, true
	}
	return 0, 0, false
}

func marginOf(level int, w, h float64) float64 {
	k := [...]float64{0, 0.03, 0.07}[min(max(level, 0), 2)]
	return math.Round(math.Min(w, h) * k)
}

// docLayout sizes the pages and places each picture on its own, as large
// as fits within the margin, centered. A PDF's fit pages are the pictures'
// own size at 96 dpi with the margin around them; a PowerPoint has one
// slide size, the first picture's shape at 13.33 inches on the long side.
func docLayout(opts DocOptions, pages []docPage) []docBox {
	out := make([]docBox, len(pages))
	W, H, fixed := pageSize(opts.Page)
	if !fixed && opts.Kind == "pptx" && len(pages) > 0 {
		r := float64(pages[0].w) / float64(max(pages[0].h, 1))
		if r >= 1 {
			W, H = 960, math.Max(72, math.Round(960/r))
		} else {
			W, H = math.Max(72, math.Round(960*r)), 960
		}
		fixed = true
	}
	for i, p := range pages {
		iw, ih := float64(p.w)*0.75, float64(p.h)*0.75
		if !fixed {
			// PDF pages are at most 200 inches on a side.
			m := marginOf(opts.Margin, iw, ih)
			if k := (14400 - 2*m) / math.Max(iw, ih); k < 1 {
				iw, ih = iw*k, ih*k
			}
			out[i] = docBox{W: iw + 2*m, H: ih + 2*m, X: m, Y: m, IW: iw, IH: ih}
			continue
		}
		m := marginOf(opts.Margin, W, H)
		k := math.Min((W-2*m)/iw, (H-2*m)/ih)
		out[i] = docBox{W: W, H: H, X: (W - iw*k) / 2, Y: (H - ih*k) / 2, IW: iw * k, IH: ih * k}
	}
	return out
}

// pdfImage is a page's picture as a PDF image: JPG as it is, PNG as
// compressed RGB with its transparency, if any, as a soft mask.
func pdfImage(p docPage) (filter string, rgb, alpha []byte, err error) {
	if p.format == "jpeg" {
		return "/DCTDecode", p.data, nil, nil
	}
	img, err := png.Decode(bytes.NewReader(p.data))
	if err != nil {
		return "", nil, nil, err
	}
	b := img.Bounds()
	nrgba := image.NewNRGBA(b)
	draw.Draw(nrgba, b, img, b.Min, draw.Src)
	n := b.Dx() * b.Dy()
	raw := make([]byte, 0, n*3)
	mask := make([]byte, 0, n)
	opaque := true
	for i := 0; i < len(nrgba.Pix); i += 4 {
		raw = append(raw, nrgba.Pix[i], nrgba.Pix[i+1], nrgba.Pix[i+2])
		mask = append(mask, nrgba.Pix[i+3])
		if nrgba.Pix[i+3] != 255 {
			opaque = false
		}
	}
	if rgb, err = deflate(raw); err != nil {
		return "", nil, nil, err
	}
	if !opaque {
		if alpha, err = deflate(mask); err != nil {
			return "", nil, nil, err
		}
	}
	return "/FlateDecode", rgb, alpha, nil
}

func deflate(b []byte) ([]byte, error) {
	var out bytes.Buffer
	z, _ := zlib.NewWriterLevel(&out, zlib.BestSpeed)
	if _, err := z.Write(b); err != nil {
		return nil, err
	}
	if err := z.Close(); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// countWriter counts what is written, for the PDF's cross-reference table.
type countWriter struct {
	w   io.Writer
	n   int64
	err error
}

func (c *countWriter) Write(b []byte) (int, error) {
	if c.err != nil {
		return 0, c.err
	}
	n, err := c.w.Write(b)
	c.n += int64(n)
	c.err = err
	return n, err
}

func (c *countWriter) printf(format string, a ...any) { fmt.Fprintf(c, format, a...) }

// writePDF writes a PDF of the pages, one picture each. Objects: 1 the
// catalog, 2 the page tree, then each page, its contents, its image and
// its image's mask.
func writePDF(out io.Writer, pages []docPage, opts DocOptions) error {
	w := &countWriter{w: out}
	boxes := docLayout(opts, pages)
	offsets := []int64{0}
	begin := func(n int) {
		for len(offsets) <= n {
			offsets = append(offsets, 0)
		}
		offsets[n] = w.n
		w.printf("%d 0 obj\n", n)
	}
	f := func(v float64) string { return strconv.FormatFloat(v, 'f', 2, 64) }
	w.printf("%%PDF-1.4\n%%\xe2\xe3\xcf\xd3\n")
	pageObj := func(i int) int { return 3 + i*4 }
	kids := make([]string, len(pages))
	for i := range pages {
		kids[i] = fmt.Sprintf("%d 0 R", pageObj(i))
	}
	begin(1)
	w.printf("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
	begin(2)
	w.printf("<< /Type /Pages /Kids [%s] /Count %d >>\nendobj\n", strings.Join(kids, " "), len(pages))
	for i, p := range pages {
		filter, data, alpha, err := pdfImage(p)
		if err != nil {
			return fmt.Errorf("第 %d 页：%w", i+1, err)
		}
		b := boxes[i]
		n := pageObj(i)
		begin(n)
		w.printf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %s %s] /Resources << /XObject << /Im0 %d 0 R >> >> /Contents %d 0 R >>\nendobj\n", f(b.W), f(b.H), n+2, n+1)
		content := fmt.Sprintf("q %s 0 0 %s %s %s cm /Im0 Do Q", f(b.IW), f(b.IH), f(b.X), f(b.H-b.Y-b.IH))
		begin(n + 1)
		w.printf("<< /Length %d >>\nstream\n%s\nendstream\nendobj\n", len(content), content)
		begin(n + 2)
		smask := ""
		if alpha != nil {
			smask = fmt.Sprintf(" /SMask %d 0 R", n+3)
		}
		w.printf("<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter %s%s /Length %d >>\nstream\n", p.w, p.h, filter, smask, len(data))
		w.Write(data)
		w.printf("\nendstream\nendobj\n")
		begin(n + 3)
		if alpha != nil {
			w.printf("<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length %d >>\nstream\n", p.w, p.h, len(alpha))
			w.Write(alpha)
			w.printf("\nendstream\nendobj\n")
		} else {
			w.printf("null\nendobj\n")
		}
	}
	xref := w.n
	w.printf("xref\n0 %d\n0000000000 65535 f \n", len(offsets))
	for _, o := range offsets[1:] {
		w.printf("%010d 00000 n \n", o)
	}
	w.printf("trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets), xref)
	return w.err
}

// ---- PowerPoint ----

const (
	nsA       = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`
	nsR       = `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`
	nsP       = `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`
	xmlHead   = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n"
	relsNS    = `http://schemas.openxmlformats.org/package/2006/relationships`
	relType   = `http://schemas.openxmlformats.org/officeDocument/2006/relationships/`
	emptyTree = `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`
)

const pptxTheme = `<a:theme ` + nsA + ` name="Office"><a:themeElements>` +
	`<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>` +
	`<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>` +
	`<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>` +
	`<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>` +
	`<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
	`<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>` +
	`<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>` +
	`<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
	`<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>` +
	`</a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`

func rels(list ...[2]string) string {
	var b strings.Builder
	b.WriteString(xmlHead + `<Relationships xmlns="` + relsNS + `">`)
	for i, r := range list {
		typ := r[0]
		if !strings.HasPrefix(typ, "http") {
			typ = relType + typ
		}
		fmt.Fprintf(&b, `<Relationship Id="rId%d" Type="%s" Target="%s"/>`, i+1, typ, r[1])
	}
	b.WriteString(`</Relationships>`)
	return b.String()
}

// writePPTX writes a PowerPoint file of the pages, a picture on each
// blank slide: the least a presentation needs, one master, one layout,
// one theme.
func writePPTX(out io.Writer, pages []docPage, opts DocOptions) error {
	z := zip.NewWriter(out)
	put := func(name, body string) error {
		w, err := z.Create(name)
		if err != nil {
			return err
		}
		_, err = io.WriteString(w, body)
		return err
	}
	boxes := docLayout(opts, pages)
	emu := func(pt float64) int64 { return int64(math.Round(pt * 12700)) }
	var types, slideIDs strings.Builder
	types.WriteString(xmlHead + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
		`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
		`<Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/>` +
		`<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>` +
		`<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>` +
		`<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>` +
		`<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
		`<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
		`<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`)
	presRels := [][2]string{{"slideMaster", "slideMasters/slideMaster1.xml"}, {"theme", "theme/theme1.xml"}}
	for i := range pages {
		n := i + 1
		fmt.Fprintf(&types, `<Override PartName="/ppt/slides/slide%d.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`, n)
		presRels = append(presRels, [2]string{"slide", fmt.Sprintf("slides/slide%d.xml", n)})
		fmt.Fprintf(&slideIDs, `<p:sldId id="%d" r:id="rId%d"/>`, 255+n, len(presRels))
	}
	types.WriteString(`</Types>`)
	W, H := emu(boxes[0].W), emu(boxes[0].H)
	title := html.EscapeString(opts.Name)
	now := time.Now().UTC().Format("2006-01-02T15:04:05Z")
	parts := []struct{ name, body string }{
		{"[Content_Types].xml", types.String()},
		{"_rels/.rels", rels([2]string{"officeDocument", "ppt/presentation.xml"}, [2]string{"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml"}, [2]string{"extended-properties", "docProps/app.xml"})},
		{"docProps/core.xml", xmlHead + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
			`<dc:title>` + title + `</dc:title><dc:creator>工具箱</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">` + now + `</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">` + now + `</dcterms:modified></cp:coreProperties>`},
		{"docProps/app.xml", xmlHead + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>工具箱</Application>` + fmt.Sprintf(`<Slides>%d</Slides>`, len(pages)) + `</Properties>`},
		{"ppt/presentation.xml", xmlHead + `<p:presentation ` + nsA + ` ` + nsR + ` ` + nsP + ` saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
			`<p:sldIdLst>` + slideIDs.String() + `</p:sldIdLst>` + fmt.Sprintf(`<p:sldSz cx="%d" cy="%d"/>`, W, H) + `<p:notesSz cx="6858000" cy="9144000"/></p:presentation>`},
		{"ppt/_rels/presentation.xml.rels", rels(presRels...)},
		{"ppt/slideMasters/slideMaster1.xml", xmlHead + `<p:sldMaster ` + nsA + ` ` + nsR + ` ` + nsP + `><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>` + emptyTree + `</p:spTree></p:cSld>` +
			`<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
			`<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`},
		{"ppt/slideMasters/_rels/slideMaster1.xml.rels", rels([2]string{"slideLayout", "../slideLayouts/slideLayout1.xml"}, [2]string{"theme", "../theme/theme1.xml"})},
		{"ppt/slideLayouts/slideLayout1.xml", xmlHead + `<p:sldLayout ` + nsA + ` ` + nsR + ` ` + nsP + ` type="blank" preserve="1"><p:cSld name="空白"><p:spTree>` + emptyTree + `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`},
		{"ppt/slideLayouts/_rels/slideLayout1.xml.rels", rels([2]string{"slideMaster", "../slideMasters/slideMaster1.xml"})},
		{"ppt/theme/theme1.xml", xmlHead + pptxTheme},
	}
	for _, p := range parts {
		if err := put(p.name, p.body); err != nil {
			return err
		}
	}
	for i, p := range pages {
		n := i + 1
		ext := "png"
		if p.format == "jpeg" {
			ext = "jpeg"
		}
		w, err := z.Create(fmt.Sprintf("ppt/media/image%d.%s", n, ext))
		if err != nil {
			return err
		}
		if _, err := w.Write(p.data); err != nil {
			return err
		}
		b := boxes[i]
		slide := xmlHead + `<p:sld ` + nsA + ` ` + nsR + ` ` + nsP + `><p:cSld><p:spTree>` + emptyTree +
			fmt.Sprintf(`<p:pic><p:nvPicPr><p:cNvPr id="2" name="图片 %d"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>`, n) +
			`<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
			fmt.Sprintf(`<p:spPr><a:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`, emu(b.X), emu(b.Y), emu(b.IW), emu(b.IH)) +
			`</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
		if err := put(fmt.Sprintf("ppt/slides/slide%d.xml", n), slide); err != nil {
			return err
		}
		if err := put(fmt.Sprintf("ppt/slides/_rels/slide%d.xml.rels", n), rels([2]string{"slideLayout", "../slideLayouts/slideLayout1.xml"}, [2]string{"image", fmt.Sprintf("../media/image%d.%s", n, ext)})); err != nil {
			return err
		}
	}
	return z.Close()
}
