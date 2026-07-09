package main

import (
	"errors"
	"fmt"
)

func restoreApp(args []string) error {
	cfg, err := parseAppConfig("restore", args)
	if err != nil {
		return err
	}
	if cfg.restoreIn == "" {
		return errors.New("restore requires --in FILE")
	}
	paths := newAppPaths(cfg.home)
	if err := runCommand(
		cfg.postgresBin,
		"pg_restore",
		"-h", paths.home,
		"-p", cfg.postgresPort,
		"-U", "postgres",
		"-d", "postgres",
		"--clean",
		"--if-exists",
		"--no-owner",
		cfg.restoreIn,
	); err != nil {
		return err
	}
	fmt.Printf("restored backup from %s\n", cfg.restoreIn)
	return nil
}
