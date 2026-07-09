package main

import "testing"

func TestMissingCommandsOnlyChecksDocker(t *testing.T) {
	missing := missingCommands()
	for _, command := range missing {
		if command != "docker" {
			t.Fatalf("missingCommands = %v, want only docker when anything is missing", missing)
		}
	}
}
