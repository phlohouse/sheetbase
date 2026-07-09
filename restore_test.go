package main

import (
	"strings"
	"testing"
)

func TestRestoreRequiresInputFile(t *testing.T) {
	err := restoreApp([]string{"--home", t.TempDir()})
	if err == nil || !strings.Contains(err.Error(), "--in FILE") {
		t.Fatalf("restoreApp error = %v, want --in FILE", err)
	}
}
