//go:build !windows

package main

import "errors"

func runUpdater(tmp, file, src, exe string) error { return errors.New("只支持 Windows") }
