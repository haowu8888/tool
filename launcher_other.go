//go:build !windows

package main

func shellExecute(path, args, dir string, admin bool) error { return errWindowsOnly }

func expandEnv(s string) string { return s }

func installedApps() ([]InstalledApp, error) { return nil, errWindowsOnly }
