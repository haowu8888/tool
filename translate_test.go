package main

import (
	"context"
	"os"
	"strings"
	"testing"
)

// TestTranslateLive asks the real translators; it runs only with
// TOOLBOX_LIVE=1.
func TestTranslateLive(t *testing.T) {
	if os.Getenv("TOOLBOX_LIVE") == "" {
		t.Skip("set TOOLBOX_LIVE=1 to ask the translators")
	}
	src := "笔记待办\n添加待办，回车保存\n明天 15:00 开会"
	for _, engine := range []string{"google", "bing"} {
		out, err := machineTranslate(context.Background(), engine, src, "en")
		if err != nil {
			t.Errorf("%s: %v", engine, err)
			continue
		}
		t.Logf("%s: %q", engine, out)
		if n := len(strings.Split(strings.TrimSpace(out), "\n")); n != 3 {
			t.Errorf("%s: %d lines, want 3", engine, n)
		}
	}
}
