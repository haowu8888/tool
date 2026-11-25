package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// GoldQuote is a market's price, as Sina quotes it.
type GoldQuote struct {
	Code  string  `json:"code"`
	Name  string  `json:"name"`
	Unit  string  `json:"unit"`
	Price float64 `json:"price"`
	Open  float64 `json:"open"`
	High  float64 `json:"high"`
	Low   float64 `json:"low"`
	Prev  float64 `json:"prev"` // the close before
	Time  string  `json:"time"` // as 2026-11-23 09:46:00, the market's own
}

// GoldQuotes is the gold tab's prices, and the dollar in yuan to turn an
// ounce's dollars into a gram's yuan.
type GoldQuotes struct {
	Quotes []GoldQuote `json:"quotes"`
	USDCNY float64     `json:"usdcny"`
}

// GoldPoint is a point of a chart: a time (15:04 for today's, a date for
// the rest) and a price.
type GoldPoint struct {
	T string  `json:"t"`
	V float64 `json:"v"`
}

// GoldChart is London gold's price over a span, with the close before
// its first point.
type GoldChart struct {
	Points []GoldPoint `json:"points"`
	Prev   float64     `json:"prev,omitempty"`
}

var goldMarkets = []struct{ code, name, unit string }{
	{"hf_XAU", "伦敦金（现货）", "美元/盎司"},
	{"gds_AU9999", "上金所 Au99.99", "元/克"},
	{"gds_AUTD", "上金所 黄金 T+D", "元/克"},
	{"hf_GC", "纽约金（COMEX）", "美元/盎司"},
	{"hf_XAG", "伦敦银（现货）", "美元/盎司"},
}

var goldClient = &http.Client{Timeout: 10 * time.Second}

var goldDaily struct {
	sync.Mutex
	at     time.Time
	points []GoldPoint
}

// sinaGet gets a Sina finance address, which answers only with its own
// pages as the referrer.
func sinaGet(url string) ([]byte, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Referer", "https://finance.sina.com.cn/")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")
	resp, err := goldClient.Do(req)
	if err != nil {
		return nil, errors.New("连不上新浪财经：" + err.Error())
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("新浪财经返回 %s", resp.Status)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 8<<20))
}

// Gold gets the prices of gold (and silver) now.
func (d *Dev) Gold() (GoldQuotes, error) {
	codes := []string{"fx_susdcny"}
	for _, m := range goldMarkets {
		codes = append(codes, m.code)
	}
	b, err := sinaGet("https://hq.sinajs.cn/list=" + strings.Join(codes, ","))
	if err != nil {
		return GoldQuotes{}, err
	}
	return parseGold(string(b))
}

// parseGold reads Sina's quotes: lines of var hq_str_<code>="a,b,…";. The
// names in them are GBK, so the markets' own are used.
func parseGold(s string) (GoldQuotes, error) {
	fields := map[string][]string{}
	for _, line := range strings.Split(s, "\n") {
		code, rest, ok := strings.Cut(strings.TrimPrefix(strings.TrimSpace(line), "var hq_str_"), "=\"")
		if !ok {
			continue
		}
		rest, _, _ = strings.Cut(rest, "\"")
		if rest != "" {
			fields[code] = strings.Split(rest, ",")
		}
	}
	num := func(f []string, i int) float64 {
		if i >= len(f) {
			return 0
		}
		v, _ := strconv.ParseFloat(f[i], 64)
		return v
	}
	out := GoldQuotes{Quotes: []GoldQuote{}}
	// fx: time, buy, sell, close before, …, latest at 8.
	if f := fields["fx_susdcny"]; f != nil {
		out.USDCNY = num(f, 8)
		if out.USDCNY == 0 {
			out.USDCNY = num(f, 1)
		}
	}
	// hf_ and gds_: price, -, bid, ask, high, low, time, close before,
	// open, …, date at 12.
	for _, m := range goldMarkets {
		f := fields[m.code]
		if len(f) < 13 {
			continue
		}
		q := GoldQuote{Code: m.code, Name: m.name, Unit: m.unit, Price: num(f, 0), High: num(f, 4), Low: num(f, 5), Prev: num(f, 7), Open: num(f, 8), Time: f[12] + " " + f[6]}
		// Before a market opens it quotes no price.
		if q.Price <= 0 {
			q.Price = q.Prev
		}
		if q.Price > 0 {
			out.Quotes = append(out.Quotes, q)
		}
	}
	if len(out.Quotes) == 0 {
		return out, errors.New("新浪财经没有返回金价")
	}
	return out, nil
}

// GoldChart gets London gold's price over a span: day (by the minute),
// or month, quarter, year, or five years (by the day).
func (d *Dev) GoldChart(span string) (GoldChart, error) {
	if span == "day" {
		b, err := sinaGet("https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20t=/GlobalFuturesService.getGlobalFuturesMinLine?symbol=XAU")
		if err != nil {
			return GoldChart{}, err
		}
		return parseGoldMinutes(b)
	}
	days := map[string]int{"month": 31, "quarter": 92, "year": 366, "5y": 5*365 + 2}[span]
	if days == 0 {
		return GoldChart{}, errors.New("不认识的时间段 " + span)
	}
	goldDaily.Lock()
	defer goldDaily.Unlock()
	// Twenty years of days is 0.7MB: got again only every ten minutes.
	if goldDaily.points == nil || time.Since(goldDaily.at) > 10*time.Minute {
		b, err := sinaGet("https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20t=/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=XAU")
		if err != nil {
			return GoldChart{}, err
		}
		points, err := parseGoldDays(b)
		if err != nil {
			return GoldChart{}, err
		}
		goldDaily.points, goldDaily.at = points, time.Now()
	}
	from := time.Now().AddDate(0, 0, -days).Format("2006-01-02")
	all := goldDaily.points
	i := len(all)
	for i > 0 && all[i-1].T >= from {
		i--
	}
	out := GoldChart{Points: all[i:]}
	// The close before the span gives its first day's change.
	if i > 0 {
		out.Prev = all[i-1].V
	}
	return out, nil
}

// jsonpBody is what is inside var t=(…); of a JSONP answer.
func jsonpBody(b []byte) ([]byte, error) {
	s := string(b)
	i, j := strings.Index(s, "=("), strings.LastIndex(s, ")")
	if i < 0 || j < i {
		return nil, errors.New("新浪财经返回的不是行情数据")
	}
	return []byte(s[i+2 : j]), nil
}

// parseGoldMinutes reads today's minutes. Each row ends in price, …,
// 2026-11-23 07:01:00, the price 5 from the end; the first row also has
// the close before at 1.
func parseGoldMinutes(b []byte) (GoldChart, error) {
	body, err := jsonpBody(b)
	if err != nil {
		return GoldChart{}, err
	}
	var v struct {
		Rows [][]string `json:"minLine_1d"`
	}
	if err := json.Unmarshal(body, &v); err != nil {
		return GoldChart{}, errors.New("读不懂新浪财经的分时数据")
	}
	out := GoldChart{Points: []GoldPoint{}}
	for i, r := range v.Rows {
		if len(r) < 6 {
			continue
		}
		if i == 0 {
			out.Prev, _ = strconv.ParseFloat(r[1], 64)
		}
		p, _ := strconv.ParseFloat(r[len(r)-5], 64)
		t := r[len(r)-1]
		if len(t) >= 16 {
			t = t[11:16]
		}
		if p > 0 {
			out.Points = append(out.Points, GoldPoint{T: t, V: p})
		}
	}
	return out, nil
}

// parseGoldDays reads the daily closes, oldest first.
func parseGoldDays(b []byte) ([]GoldPoint, error) {
	body, err := jsonpBody(b)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		Date  string `json:"date"`
		Close string `json:"close"`
	}
	if err := json.Unmarshal(body, &rows); err != nil {
		return nil, errors.New("读不懂新浪财经的日线数据")
	}
	out := make([]GoldPoint, 0, len(rows))
	for _, r := range rows {
		if p, _ := strconv.ParseFloat(r.Close, 64); p > 0 {
			out = append(out, GoldPoint{T: r.Date, V: p})
		}
	}
	return out, nil
}
