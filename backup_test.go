package main

import (
	"path/filepath"
	"testing"
	"time"
)

func TestDefaultBackupPathUsesAppHomeBackups(t *testing.T) {
	paths := newAppPaths("/var/lib/sheetbase")
	got := defaultBackupPath(paths, time.Date(2026, 7, 9, 10, 45, 12, 0, time.UTC))
	want := filepath.Join("/var/lib/sheetbase", "backups", "sheetbase-20260709T104512Z.dump")
	if got != want {
		t.Fatalf("defaultBackupPath = %q, want %q", got, want)
	}
}
