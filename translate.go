package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Free machine translation, as the browsers' built-in translators use:
// Google's, and Bing's where Google cannot be reached. Text goes a line a
// line: they keep the line breaks, so that every line's translation can
// cover its own.

// browserUA is what the translators see: they turn some clients away.
const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

var translateClient = &http.Client{Timeout: 20 * time.Second}

// machineTranslate translates text into zh or en with the engine: google,
// bing, or auto for Google and then Bing.
func machineTranslate(ctx context.Context, engine, text, to string) (string, error) {
	switch engine {
	case "google":
		return googleTranslate(ctx, text, to)
	case "bing":
		return bingTranslate(ctx, text, to)
	}
	out, err := googleTranslate(ctx, text, to)
	if err == nil {
		return out, nil
	}
	out, err2 := bingTranslate(ctx, text, to)
	if err2 != nil {
		return "", fmt.Errorf("谷歌翻译：%v；必应翻译：%v", err, err2)
	}
	return out, nil
}

func googleTranslate(ctx context.Context, text, to string) (string, error) {
	tl := map[string]string{"zh": "zh-CN", "en": "en"}[to]
	form := url.Values{"q": {text}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl="+tl+"&dt=t", strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded;charset=utf-8")
	req.Header.Set("User-Agent", browserUA)
	b, err := send(req)
	if err != nil {
		return "", err
	}
	// [[["译文","原文",…],…],…]: the pieces, a sentence each, with the
	// line breaks in them.
	var res []json.RawMessage
	if err := json.Unmarshal(b, &res); err != nil || len(res) == 0 {
		return "", errors.New("返回的不是翻译结果")
	}
	var parts [][]any
	if err := json.Unmarshal(res[0], &parts); err != nil {
		return "", errors.New("返回的不是翻译结果")
	}
	var out strings.Builder
	for _, p := range parts {
		if len(p) > 0 {
			if s, ok := p[0].(string); ok {
				out.WriteString(s)
			}
		}
	}
	if out.Len() == 0 {
		return "", errors.New("没有翻译结果")
	}
	return out.String(), nil
}

// bing is Bing Translator's page's session: its keys, from the page, last
// about an hour.
var bing struct {
	sync.Mutex
	client        *http.Client
	host, ig, iid string
	key, token    string
	expires       time.Time
}

var (
	bingIG    = regexp.MustCompile(`IG:"([0-9A-Fa-f]+)"`)
	bingIID   = regexp.MustCompile(`data-iid="(translator\.\d+)"`)
	bingAbuse = regexp.MustCompile(`params_AbusePreventionHelper\s*=\s*\[(\d+),"([^"]+)",(\d+)\]`)
)

// bingSession reads the keys off Bing Translator's page, or keeps them.
func bingSession(ctx context.Context, fresh bool) error {
	if !fresh && bing.client != nil && time.Now().Before(bing.expires) {
		return nil
	}
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Timeout: 20 * time.Second, Jar: jar}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://www.bing.com/translator", nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", browserUA)
	res, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("连不上：%w", err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	ig, iid, abuse := bingIG.FindSubmatch(b), bingIID.FindSubmatch(b), bingAbuse.FindSubmatch(b)
	if ig == nil || iid == nil || abuse == nil {
		return errors.New("页面变了，读不到翻译的参数")
	}
	var ms int64
	fmt.Sscan(string(abuse[3]), &ms)
	bing.client, bing.host = client, res.Request.URL.Host // it may send China to cn.bing.com
	bing.ig, bing.iid, bing.key, bing.token = string(ig[1]), string(iid[1]), string(abuse[1]), string(abuse[2])
	bing.expires = time.Now().Add(time.Duration(ms)*time.Millisecond - time.Minute)
	return nil
}

func bingTranslate(ctx context.Context, text, to string) (string, error) {
	bing.Lock()
	defer bing.Unlock()
	lang := map[string]string{"zh": "zh-Hans", "en": "en"}[to]
	for try := 0; ; try++ {
		if err := bingSession(ctx, try > 0); err != nil {
			return "", err
		}
		form := url.Values{"fromLang": {"auto-detect"}, "to": {lang}, "text": {text}, "token": {bing.token}, "key": {bing.key}}
		u := fmt.Sprintf("https://%s/ttranslatev3?isVertical=1&&IG=%s&IID=%s", bing.host, bing.ig, bing.iid)
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, strings.NewReader(form.Encode()))
		if err != nil {
			return "", err
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		req.Header.Set("User-Agent", browserUA)
		req.Header.Set("Referer", "https://"+bing.host+"/translator")
		res, err := bing.client.Do(req)
		if err != nil {
			return "", fmt.Errorf("连不上：%w", err)
		}
		b, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
		res.Body.Close()
		var out []struct {
			Translations []struct {
				Text string `json:"text"`
			} `json:"translations"`
		}
		if json.Unmarshal(b, &out) == nil && len(out) > 0 && len(out[0].Translations) > 0 {
			return out[0].Translations[0].Text, nil
		}
		// {"statusCode":…}: the keys ran out; once more with new ones.
		if try > 0 {
			return "", fmt.Errorf("翻译失败：%s", strings.TrimSpace(string(b[:min(len(b), 200)])))
		}
	}
}

// send does a request and returns the body of a 200 answer.
func send(req *http.Request) ([]byte, error) {
	res, err := translateClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("连不上：%w", err)
	}
	defer res.Body.Close()
	b, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", res.StatusCode)
	}
	return b, nil
}
