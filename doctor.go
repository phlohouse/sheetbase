package main

import (
	"fmt"
	"os/exec"
	"strings"
)

func doctorApp(args []string) error {
	if _, err := parseAppConfig("doctor", args); err != nil {
		return err
	}
	missing := missingCommands()
	if len(missing) > 0 {
		return fmt.Errorf("missing required commands: %s", strings.Join(missing, ", "))
	}
	if err := runCommand("", "docker", "info"); err != nil {
		return fmt.Errorf("docker daemon is not available: %w", err)
	}
	fmt.Println("all required commands found")
	return nil
}

func missingCommands() []string {
	var missing []string
	if _, err := exec.LookPath("docker"); err != nil {
		missing = append(missing, "docker")
	}
	return missing
}
