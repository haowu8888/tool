package main

import (
	"encoding/json"
	"testing"
)

// A part of LibreHardwareMonitor's data.json.
const lhmSample = `{"Text":"Sensor","Children":[{"Text":"HAOWU","ImageURL":"images_icon/computer.png","Value":"","Children":[
 {"Text":"13th Gen Intel Core i9-13900H","ImageURL":"images_icon/cpu.png","Value":"","Children":[
  {"Text":"Temperatures","ImageURL":"images_icon/temperature.png","Value":"","Children":[
   {"Text":"CPU Package","Value":"61.0 °C","Type":"Temperature","Children":[]},
   {"Text":"Core Max","Value":"64.0 °C","Type":"Temperature","Children":[]}]},
  {"Text":"Powers","ImageURL":"images_icon/power.png","Value":"","Children":[
   {"Text":"CPU Package","Value":"18,5 W","Type":"Power","Children":[]}]}]},
 {"Text":"Intel(R) Iris(R) Xe Graphics","ImageURL":"images_icon/intel.png","Value":"","Children":[
  {"Text":"Powers","ImageURL":"images_icon/power.png","Value":"","Children":[
   {"Text":"GPU Power","Value":"0.9 W","Children":[]}]},
  {"Text":"Clocks","ImageURL":"images_icon/clock.png","Value":"","Children":[
   {"Text":"GPU Core","Value":"1500.0 MHz","Children":[]}]}]},
 {"Text":"HUAWEI CREFG-XX","ImageURL":"images_icon/mainboard.png","Value":"","Children":[
  {"Text":"ITE IT5570","ImageURL":"images_icon/chip.png","Value":"","Children":[
   {"Text":"Fans","ImageURL":"images_icon/fan.png","Value":"","Children":[
    {"Text":"Fan #1","Value":"2350 RPM","Type":"Fan","Children":[]}]}]}]},
 {"Text":"WD PC SN740","ImageURL":"images_icon/nvme.png","Value":"","Children":[
  {"Text":"Temperatures","ImageURL":"images_icon/temperature.png","Value":"","Children":[
   {"Text":"Composite Temperature","Value":"38.0 °C","Children":[]}]}]}]}]}`

func TestAddSensors(t *testing.T) {
	var root lhmNode
	if err := json.Unmarshal([]byte(lhmSample), &root); err != nil {
		t.Fatal(err)
	}
	var s MonitorSample
	addSensors(&s, root)
	if s.CPU.Temp != 61 || s.CPU.Power != 18.5 {
		t.Errorf("cpu = %v °C, %v W; want 61, 18.5", s.CPU.Temp, s.CPU.Power)
	}
	if len(s.Temps) != 2 || s.Temps[0].Group != "CPU" || s.Temps[0].Name != "13th Gen Intel Core i9-13900H · CPU Package" {
		t.Errorf("temps = %+v", s.Temps)
	}
	if s.GPU.Power != 0.9 || s.GPU.Clock != 1500 {
		t.Errorf("gpu = %v W, %v MHz; want 0.9, 1500", s.GPU.Power, s.GPU.Clock)
	}
	if len(s.Fans) != 1 || s.Fans[0].Group != "主板" || s.Fans[0].Value != 2350 {
		t.Errorf("fans = %+v", s.Fans)
	}
}
