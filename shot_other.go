//go:build !windows

package main

import (
	"errors"
	"image"
)

func captureDisplay(int64) (*image.RGBA, error) { return nil, errors.New("只支持 Windows") }

func monitorRect(int64) (image.Rectangle, error) {
	return image.Rectangle{}, errors.New("只支持 Windows")
}

func captureScreen(image.Rectangle) (*image.RGBA, error) { return nil, errors.New("只支持 Windows") }

func cursorPos() image.Point { return image.Point{} }

func moveCursor(image.Point) {}

func wheelDown() {}

func recognize(*image.RGBA) (OCRResult, error) { return OCRResult{}, errors.New("只支持 Windows") }
