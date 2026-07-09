package main

import "testing"

func TestMissingCommandsReportsPostgREST(t *testing.T) {
	missing := missingCommands(appConfig{postgrestBin: "/definitely/not/postgrest"})
	found := false
	for _, command := range missing {
		if command == "postgrest" {
			found = true
		}
	}
	if !found {
		t.Fatalf("missingCommands = %v, want postgrest", missing)
	}
}
