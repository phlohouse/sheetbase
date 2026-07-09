package main

import (
	"errors"
	"strings"
	"testing"
)

func TestMissingCommandsOnlyChecksDocker(t *testing.T) {
	missing := missingCommands()
	for _, command := range missing {
		if command != "docker" {
			t.Fatalf("missingCommands = %v, want only docker when anything is missing", missing)
		}
	}
}

func TestDockerPrereqErrorPrefersMissingCommand(t *testing.T) {
	err := dockerPrereqError([]string{"docker"}, errors.New("daemon down"))
	if err == nil || !strings.Contains(err.Error(), "missing required commands: docker") {
		t.Fatalf("dockerPrereqError = %v, want missing command", err)
	}
}

func TestDockerPrereqErrorReportsDaemon(t *testing.T) {
	err := dockerPrereqError(nil, errors.New("daemon down"))
	if err == nil || !strings.Contains(err.Error(), "docker daemon is not available") {
		t.Fatalf("dockerPrereqError = %v, want daemon error", err)
	}
}
