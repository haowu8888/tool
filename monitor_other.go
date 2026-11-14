//go:build !windows

package main

import (
	"errors"
	"os/exec"
	"time"
)

type sampler struct{}

func newSampler() *sampler { return &sampler{} }

func (s *sampler) close() {}

func (s *sampler) sample(int) MonitorSample {
	return MonitorSample{Time: time.Now().UnixMilli(), Disks: []DiskSample{}, Temps: []SensorReading{}, Fans: []SensorReading{}}
}

func hideWindow(*exec.Cmd) {}

func endProcess(int) error { return errors.New("只支持 Windows") }
