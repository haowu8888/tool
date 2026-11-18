@echo off
rem Runs gofmt, vet and the Go tests matching %1, for host-exec, which mangles quotes.
cd /d %~dp0..
gofmt -l .
go vet ./...
go test -count=1 -run "%~1" -v . 2>&1 | findstr /r /c:"^--- " /c:"^ok" /c:"^FAIL" /c:"_test.go"
