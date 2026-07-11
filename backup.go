package main

import (
	"fmt"
	"path/filepath"
	"time"
)

func backupApp(args []string) (err error) {
	cfg, err := parseAppConfig("backup", args)
	if err != nil {
		return err
	}
	paths := newAppPaths(cfg.home)
	if err := setupAppLogging(paths); err != nil {
		return err
	}
	defer beginCommandLog("backup", paths)(&err)
	if err := ensureAppHome(paths); err != nil {
		return err
	}
	target := cfg.backupOut
	if target == "" {
		target = defaultBackupPath(paths, time.Now().UTC())
	}
	if err := databaseDump(paths, cfg, target); err != nil {
		return err
	}
	fmt.Printf("backup written to %s\n", target)
	return nil
}

func defaultBackupPath(paths appPaths, now time.Time) string {
	return filepath.Join(paths.backups, "sheetbase-"+now.UTC().Format("20060102T150405Z")+".dump")
}
