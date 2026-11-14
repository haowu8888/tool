//go:build !windows

package main

import (
	"errors"
	"os/exec"
	"time"
)

func ping(string, time.Duration) error { return errors.New("只支持 Windows") }

func tailscaleExe() string {
	p, _ := exec.LookPath("tailscale")
	return p
}
