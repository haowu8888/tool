// sign signs the release files for the toolbox's updates, as the Flow
// pipeline runs it after the build:
//
//	go run ./deploy/sign build/release/*
//
// It writes <file>.sig beside each: base64 of the Ed25519 signature, with
// the seed in TOOLBOX_SIGN_KEY (a secret of the pipeline), of
// "toolbox-update\n<file name>\n<SHA-256 in hex>\n" — what updater.go
// checks with the public key before it installs a download.
package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

func main() {
	seed, err := base64.StdEncoding.DecodeString(strings.TrimSpace(os.Getenv("TOOLBOX_SIGN_KEY")))
	if err != nil || len(seed) != ed25519.SeedSize {
		fail("TOOLBOX_SIGN_KEY 没有设置或不对：发布的文件必须签名，工具箱才会自动更新")
	}
	key := ed25519.NewKeyFromSeed(seed)
	files := 0
	for _, path := range os.Args[1:] {
		if strings.HasSuffix(path, ".sig") {
			continue
		}
		f, err := os.Open(path)
		if err != nil {
			fail(err.Error())
		}
		h := sha256.New()
		_, err = io.Copy(h, f)
		f.Close()
		if err != nil {
			fail(err.Error())
		}
		name := filepath.Base(path)
		msg := "toolbox-update\n" + name + "\n" + hex.EncodeToString(h.Sum(nil)) + "\n"
		sig := base64.StdEncoding.EncodeToString(ed25519.Sign(key, []byte(msg)))
		if err := os.WriteFile(path+".sig", []byte(sig+"\n"), 0o644); err != nil {
			fail(err.Error())
		}
		fmt.Printf("已签名 %s\n", name)
		files++
	}
	if files == 0 {
		fail("没有要签名的文件")
	}
}

func fail(msg string) {
	fmt.Fprintln(os.Stderr, msg)
	os.Exit(1)
}
