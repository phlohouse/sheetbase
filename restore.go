package main

import (
	"errors"
	"fmt"
)

func restoreApp(args []string) (err error) {
	cfg, err := parseAppConfig("restore", args)
	if err != nil {
		return err
	}
	paths := newAppPaths(cfg.home)
	if err := setupAppLogging(paths); err != nil {
		return err
	}
	defer beginCommandLog("restore", paths)(&err)
	if cfg.restoreIn == "" {
		return errors.New("restore requires --in FILE")
	}
	if err := requireDockerDaemon(); err != nil {
		return err
	}
	if err := dockerExecFromFile(cfg.restoreIn, "exec", "-i", containerName("postgres", paths), "pg_restore", "-U", "postgres", "-d", "postgres", "--clean", "--if-exists", "--no-owner"); err != nil {
		return err
	}
	fmt.Printf("restored backup from %s\n", cfg.restoreIn)
	return nil
}
