package main

import (
	"fmt"
	"os/exec"
	"strings"
)

func doctorApp(args []string) error {
	cfg, err := parseAppConfig("doctor", args)
	if err != nil {
		return err
	}
	if cfg.runtimeMode == "native" {
		paths := newAppPaths(cfg.home)
		if _, err := resolveNativeRuntime(paths); err != nil {
			return fmt.Errorf("%w; install it with `sheetbase runtime install --home %s`", err, paths.home)
		}
		fmt.Println("native PostgreSQL and PostgREST runtime found")
		return nil
	}
	if err := requireDockerDaemon(); err != nil {
		return err
	}
	fmt.Println("Docker runtime is available")
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
