package main

import (
	"bytes"
	"encoding/base64"
	"image/png"
	"slices"
	"testing"
)

func TestQRRoundTrip(t *testing.T) {
	d := &Dev{}
	text := "https://example.com/?q=工具箱"
	b64, err := d.QR(text, 256)
	if err != nil {
		t.Fatal(err)
	}
	r, err := d.DecodeQR(b64)
	if err != nil || !slices.Equal(r.Texts, []string{text}) {
		t.Fatalf("got %+v %v", r, err)
	}
	// A small code, as cut out of a web page, is read too.
	small, _ := d.QR(text, 128)
	b, _ := base64.StdEncoding.DecodeString(small)
	img, _ := png.Decode(bytes.NewReader(b))
	if r := readQR(img); !slices.Equal(r.Texts, []string{text}) {
		t.Errorf("small: %+v", r)
	}
	if r, _ := d.DecodeQR(base64.StdEncoding.EncodeToString(b[:0])); r.Error == "" && len(r.Texts) > 0 {
		t.Error("empty picture read")
	}
}

func TestHash(t *testing.T) {
	h := (&Dev{}).Hash("abc")
	if h.MD5 != "900150983cd24fb0d6963f7d28e17f72" || h.SHA256 != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" || h.CRC32 != "352441c2" || h.Size != 3 {
		t.Errorf("got %+v", h)
	}
}
