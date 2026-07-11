package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestStopNativeProcessEscalatesWhenTermIsIgnored(t *testing.T) {
	dir := t.TempDir()
	pidFile := filepath.Join(dir, "stubborn.pid")
	logFile := filepath.Join(dir, "stubborn.log")
	if err := startDetached("/bin/sh", []string{"-c", "trap '' TERM; while :; do sleep 1; done"}, nil, logFile, pidFile); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = stopNativeProcessWithin(pidFile, 10*time.Millisecond, 100*time.Millisecond) })
	deadline := time.Now().Add(time.Second)
	for !nativeProcessStatus(pidFile).Running && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if err := stopNativeProcessWithin(pidFile, 100*time.Millisecond, time.Second); err != nil {
		t.Fatal(err)
	}
	if nativeProcessStatus(pidFile).Running {
		t.Fatal("process remained running after forced stop")
	}
	if _, err := os.Stat(pidFile); !os.IsNotExist(err) {
		t.Fatalf("pid file remains: %v", err)
	}
}
