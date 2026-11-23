package main

import "testing"

func TestParseGold(t *testing.T) {
	s := `var hq_str_fx_susdcny="09:45:02,6.6733000000,6.6736000000,6.6714000000,33.0000000000,6.6744000000,6.6760000000,6.6727000000,6.6734000000,x,0.0300,0.0020,0.0033,x,0.0000,0.0000,,2026-11-23";
var hq_str_hf_XAU="3610.25,3534.640,3610.25,3610.60,3630.32,3554.42,09:46:00,3534.64,3559.83,0,0,0,2026-11-23,x";
var hq_str_gds_AU9999="0,0,776.69,777.00,783.00,755.01,09:44:19,764.55,770.50,206836,200.00,160.00,2026-11-23,x";
var hq_str_hf_GC="";`
	g, err := parseGold(s)
	if err != nil {
		t.Fatal(err)
	}
	if g.USDCNY != 6.6734 || len(g.Quotes) != 2 {
		t.Fatalf("got %+v", g)
	}
	x := g.Quotes[0]
	if x.Code != "hf_XAU" || x.Price != 3610.25 || x.Prev != 3534.64 || x.Open != 3559.83 || x.High != 3630.32 || x.Low != 3554.42 || x.Time != "2026-11-23 09:46:00" {
		t.Errorf("XAU: %+v", x)
	}
	// No price yet: the close before.
	if q := g.Quotes[1]; q.Code != "gds_AU9999" || q.Price != 764.55 {
		t.Errorf("AU9999: %+v", q)
	}
	if _, err := parseGold(""); err == nil {
		t.Error("no quotes: no error")
	}
}

func TestParseGoldCharts(t *testing.T) {
	m := `/*<script>location.href='//sina.com';</script>*/
var t=({"minLine_1d":[["2026-11-23","3534.640","LIFFE","","07:00","3581.200","0","0","3562.863","2026-11-23 07:00:00"],["07:01","3573.520","0","0","3566.372","2026-11-23 07:01:00"]]});`
	c, err := parseGoldMinutes([]byte(m))
	if err != nil {
		t.Fatal(err)
	}
	if c.Prev != 3534.64 || len(c.Points) != 2 || c.Points[0] != (GoldPoint{"07:00", 3581.2}) || c.Points[1] != (GoldPoint{"07:01", 3573.52}) {
		t.Errorf("minutes: %+v", c)
	}
	d := `var t=([{"date":"2026-11-19","open":"1","high":"1","low":"1","close":"3625.010"},{"date":"2026-11-20","close":"3534.640"}]);`
	p, err := parseGoldDays([]byte(d))
	if err != nil || len(p) != 2 || p[1] != (GoldPoint{"2026-11-20", 3534.64}) {
		t.Errorf("days: %+v %v", p, err)
	}
}
