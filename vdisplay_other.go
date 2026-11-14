//go:build !windows

package main

import "errors"

var errWindowsOnly = errors.New("只支持 Windows")

type virtualSwitch struct{}

func switchToVirtual() (*virtualSwitch, error) { return nil, errWindowsOnly }

func (v *virtualSwitch) restore() {}

func (v *virtualSwitch) broken() bool { return false }

func restoreDisplaysLeftOver() {}

func rescueDisplays() (bool, error) { return false, nil }

func listDisplays() []DisplayInfo { return nil }
