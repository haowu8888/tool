//go:build !windows

package main

import (
	"errors"
	"time"
)

func clock100ns() int64 { return time.Now().UnixNano() / 100 }

func recordScreen(*recording) error { return errors.New("只支持 Windows") }
