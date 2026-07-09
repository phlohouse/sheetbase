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
	if err := requireDockerDaemon(); err != nil {
		return err
	}
	fmt.Println("all required commands found")
	return nil
}

func requireDockerDaemon() error {
	return dockerPrereqError(missingCommands(), runCommand("", "docker", "info"))
}

func dockerPrereqError(missing []string, daemonErr error) error {
	if len(missing) > 0 {
		return fmt.Errorf("missing required commands: %s", strings.Join(missing, ", "))
	}
	if daemonErr != nil {
		return fmt.Errorf("docker daemon is not available: %w", daemonErr)
	}
	return nil
}

func missingCommands() []string {
	var missing []string
	if _, err := exec.LookPath("docker"); err != nil {
		missing = append(missing, "docker")
	}
	return missing
}
