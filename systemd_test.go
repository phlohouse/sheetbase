package main

import (
	"strings"
	"testing"
)

func TestSystemdUnitRunsManagedServicesAroundServer(t *testing.T) {
	unit := systemdUnit("/usr/local/bin/sheetbase", "/var/lib/sheetbase", ":8080")
	for _, want := range []string{
		"ExecStart=/usr/local/bin/sheetbase run --home /var/lib/sheetbase -addr :8080",
		"ExecStopPost=/usr/local/bin/sheetbase stop --home /var/lib/sheetbase",
		"Restart=on-failure",
	} {
		if !strings.Contains(unit, want) {
			t.Fatalf("unit missing %q:\n%s", want, unit)
		}
	}
}
