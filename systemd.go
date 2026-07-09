package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
)

func systemdApp(args []string) error {
	defaultHome, err := defaultAppHome()
	if err != nil {
		return err
	}
	exe, _ := os.Executable()

	flags := flag.NewFlagSet("systemd", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	home := flags.String("home", defaultHome, "Sheetbase home directory")
	bin := flags.String("bin", exe, "sheetbase binary path")
	addr := flags.String("addr", ":8080", "HTTP listen address")
	if err := flags.Parse(args); err != nil {
		return err
	}

	fmt.Print(systemdUnit(filepath.Clean(*bin), filepath.Clean(*home), *addr))
	return nil
}

func systemdUnit(bin, home, addr string) string {
	return fmt.Sprintf(`[Unit]
Description=Sheetbase
After=network.target

[Service]
Type=simple
ExecStartPre=%[1]s start --home %[2]s
ExecStart=%[1]s serve --home %[2]s -addr %[3]s
ExecStopPost=%[1]s stop --home %[2]s
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
`, bin, home, addr)
}
