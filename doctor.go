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
	missing := missingCommands(cfg)
	if len(missing) > 0 {
		return fmt.Errorf("missing required commands: %s", strings.Join(missing, ", "))
	}
	fmt.Println("all required commands found")
	return nil
}

func missingCommands(cfg appConfig) []string {
	var missing []string
	for _, command := range []string{"initdb", "pg_ctl", "psql", "pg_dump", "pg_restore"} {
		if _, err := exec.LookPath(commandPath(cfg.postgresBin, command)); err != nil {
			missing = append(missing, command)
		}
	}
	if _, err := exec.LookPath(cfg.postgrestBin); err != nil {
		missing = append(missing, "postgrest")
	}
	return missing
}
