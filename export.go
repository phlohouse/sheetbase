package main

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

func exportApp(args []string) error {
	cfg, err := parseAppConfig("export", args)
	if err != nil {
		return err
	}
	if err := requireDockerDaemon(); err != nil {
		return err
	}
	paths := newAppPaths(cfg.home)
	target := cfg.backupOut
	if target == "" {
		target = filepath.Join(paths.backups, "sheetbase-export-"+time.Now().UTC().Format("20060102T150405Z")+".tar.gz")
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}

	dump, err := os.CreateTemp("", "sheetbase-*.dump")
	if err != nil {
		return err
	}
	defer os.Remove(dump.Name())
	_ = dump.Close()

	if err := dockerExecToFile(dump.Name(), "exec", containerName("postgres", paths), "pg_dump", "-U", "postgres", "-d", "postgres", "-Fc"); err != nil {
		return err
	}
	if err := writeExportArchive(target, paths, dump.Name()); err != nil {
		return err
	}
	fmt.Printf("export written to %s\n", target)
	return nil
}

func writeExportArchive(target string, paths appPaths, dumpPath string) error {
	file, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()

	gz := gzip.NewWriter(file)
	defer gz.Close()
	tw := tar.NewWriter(gz)
	defer tw.Close()

	for _, item := range []struct {
		name string
		path string
	}{
		{name: "config/sheetbase.env", path: paths.sheetbaseConfig},
		{name: "config/postgrest.conf", path: paths.postgrestConfig},
		{name: "postgres.dump", path: dumpPath},
	} {
		if err := addFileToTar(tw, item.name, item.path); err != nil {
			return err
		}
	}
	return nil
}

func addFileToTar(tw *tar.Writer, name string, path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if err := tw.WriteHeader(&tar.Header{Name: name, Mode: 0o600, Size: info.Size()}); err != nil {
		return err
	}
	_, err = io.Copy(tw, file)
	return err
}
