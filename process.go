package main

import (
	"bytes"
	"context"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type appConfig struct {
	home          string
	postgresBin   string
	postgrestBin  string
	postgresPort  string
	postgrestPort string
	jwtSecret     string
}

type appPaths struct {
	home            string
	bin             string
	config          string
	logs            string
	postgresData    string
	postgresLog     string
	postgrestConfig string
	postgrestLog    string
	postgrestPid    string
}

func initApp(args []string) error {
	cfg, err := parseAppConfig("init", args)
	if err != nil {
		return err
	}
	paths := newAppPaths(cfg.home)
	if err := ensureAppHome(paths); err != nil {
		return err
	}
	if err := writePostgRESTConfig(paths, cfg); err != nil {
		return err
	}
	fmt.Printf("initialized Sheetbase home at %s\n", paths.home)
	return nil
}

func startApp(args []string) error {
	cfg, err := parseAppConfig("start", args)
	if err != nil {
		return err
	}
	paths := newAppPaths(cfg.home)
	if err := ensureAppHome(paths); err != nil {
		return err
	}
	if err := ensurePostgres(paths, cfg); err != nil {
		return err
	}
	if err := applyMigrations(paths, cfg); err != nil {
		return err
	}
	if err := writePostgRESTConfig(paths, cfg); err != nil {
		return err
	}
	if err := startPostgREST(paths, cfg); err != nil {
		return err
	}
	fmt.Printf("started Sheetbase services from %s\n", paths.home)
	return nil
}

func stopApp(args []string) error {
	cfg, err := parseAppConfig("stop", args)
	if err != nil {
		return err
	}
	paths := newAppPaths(cfg.home)
	if err := stopPostgREST(paths); err != nil {
		return err
	}
	if err := runCommand(cfg.postgresBin, "pg_ctl", "-D", paths.postgresData, "stop", "-m", "fast"); err != nil && !strings.Contains(err.Error(), "PID file") {
		return err
	}
	fmt.Printf("stopped Sheetbase services from %s\n", paths.home)
	return nil
}

func statusApp(args []string) error {
	cfg, err := parseAppConfig("status", args)
	if err != nil {
		return err
	}
	paths := newAppPaths(cfg.home)
	fmt.Printf("home: %s\n", paths.home)
	fmt.Printf("postgres: %s\n", statusText(runCommand(cfg.postgresBin, "pg_ctl", "-D", paths.postgresData, "status") == nil))
	fmt.Printf("postgrest: %s\n", statusText(isRunning(paths.postgrestPid)))
	return nil
}

func parseAppConfig(name string, args []string) (appConfig, error) {
	defaultHome, err := defaultAppHome()
	if err != nil {
		return appConfig{}, err
	}

	flags := flag.NewFlagSet(name, flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	cfg := appConfig{}
	flags.StringVar(&cfg.home, "home", defaultHome, "Sheetbase home directory")
	flags.StringVar(&cfg.postgresBin, "postgres-bin", envOrDefault("SHEETBASE_POSTGRES_BIN", ""), "directory containing initdb, pg_ctl, and psql")
	flags.StringVar(&cfg.postgrestBin, "postgrest-bin", envOrDefault("SHEETBASE_POSTGREST_BIN", "postgrest"), "postgrest executable path")
	flags.StringVar(&cfg.postgresPort, "postgres-port", envOrDefault("SHEETBASE_POSTGRES_PORT", "55432"), "managed PostgreSQL port")
	flags.StringVar(&cfg.postgrestPort, "postgrest-port", envOrDefault("SHEETBASE_POSTGREST_PORT", "3000"), "managed PostgREST port")
	flags.StringVar(&cfg.jwtSecret, "jwt-secret", envOrDefault("SHEETBASE_JWT_SECRET", defaultJWTSecret), "PostgREST JWT secret")
	if err := flags.Parse(args); err != nil {
		return appConfig{}, err
	}
	cfg.home = filepath.Clean(cfg.home)
	return cfg, nil
}

func defaultAppHome() (string, error) {
	if value := os.Getenv("SHEETBASE_HOME"); value != "" {
		return value, nil
	}
	if runtime.GOOS == "linux" {
		if value := os.Getenv("XDG_DATA_HOME"); value != "" {
			return filepath.Join(value, "sheetbase"), nil
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("find home directory: %w", err)
	}
	return filepath.Join(home, ".local", "share", "sheetbase"), nil
}

func newAppPaths(home string) appPaths {
	return appPaths{
		home:            home,
		bin:             filepath.Join(home, "bin"),
		config:          filepath.Join(home, "config"),
		logs:            filepath.Join(home, "logs"),
		postgresData:    filepath.Join(home, "data", "postgres"),
		postgresLog:     filepath.Join(home, "logs", "postgres.log"),
		postgrestConfig: filepath.Join(home, "config", "postgrest.conf"),
		postgrestLog:    filepath.Join(home, "logs", "postgrest.log"),
		postgrestPid:    filepath.Join(home, "postgrest.pid"),
	}
}

func ensureAppHome(paths appPaths) error {
	for _, dir := range []string{paths.bin, paths.config, paths.logs, paths.postgresData} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("create %s: %w", dir, err)
		}
	}
	return nil
}

func ensurePostgres(paths appPaths, cfg appConfig) error {
	if _, err := os.Stat(filepath.Join(paths.postgresData, "PG_VERSION")); errors.Is(err, os.ErrNotExist) {
		if err := runCommand(cfg.postgresBin, "initdb", "-D", paths.postgresData, "--auth-local=trust", "--auth-host=trust"); err != nil {
			return err
		}
	}

	if runCommand(cfg.postgresBin, "pg_ctl", "-D", paths.postgresData, "status") == nil {
		return nil
	}

	return runCommand(
		cfg.postgresBin,
		"pg_ctl",
		"-D", paths.postgresData,
		"-l", paths.postgresLog,
		"-o", fmt.Sprintf("-p %s -k %s", cfg.postgresPort, paths.home),
		"start",
	)
}

func applyMigrations(paths appPaths, cfg appConfig) error {
	entries, err := fs.ReadDir(migrationFiles, "db/migrations")
	if err != nil {
		return fmt.Errorf("read migrations: %w", err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		sql, err := migrationFiles.ReadFile(filepath.Join("db/migrations", entry.Name()))
		if err != nil {
			return fmt.Errorf("read migration %s: %w", entry.Name(), err)
		}
		cmd := exec.Command(commandPath(cfg.postgresBin, "psql"), "-v", "ON_ERROR_STOP=1", "-h", paths.home, "-p", cfg.postgresPort, "-U", "postgres", "-d", "postgres")
		cmd.Stdin = bytes.NewReader(sql)
		output, err := cmd.CombinedOutput()
		if err != nil {
			return fmt.Errorf("apply migration %s: %w\n%s", entry.Name(), err, strings.TrimSpace(string(output)))
		}
	}
	return nil
}

func writePostgRESTConfig(paths appPaths, cfg appConfig) error {
	config := fmt.Sprintf(`db-uri = "postgres://postgres@127.0.0.1:%s/postgres"
db-schemas = "public"
db-anon-role = "sheetbase_api"
server-host = "127.0.0.1"
server-port = %s
openapi-mode = "follow-privileges"
jwt-secret = "%s"
`, cfg.postgresPort, cfg.postgrestPort, cfg.jwtSecret)
	return os.WriteFile(paths.postgrestConfig, []byte(config), 0o644)
}

func startPostgREST(paths appPaths, cfg appConfig) error {
	if isRunning(paths.postgrestPid) {
		return nil
	}
	logFile, err := os.OpenFile(paths.postgrestLog, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return fmt.Errorf("open PostgREST log: %w", err)
	}
	defer logFile.Close()

	cmd := exec.Command(cfg.postgrestBin, paths.postgrestConfig)
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start PostgREST: %w", err)
	}
	if err := os.WriteFile(paths.postgrestPid, []byte(strconv.Itoa(cmd.Process.Pid)), 0o644); err != nil {
		_ = cmd.Process.Kill()
		return fmt.Errorf("write PostgREST pid: %w", err)
	}
	if err := waitForPort("127.0.0.1:"+cfg.postgrestPort, 5*time.Second); err != nil {
		return fmt.Errorf("wait for PostgREST: %w", err)
	}
	return nil
}

func stopPostgREST(paths appPaths) error {
	pid, err := readPID(paths.postgrestPid)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		return fmt.Errorf("find PostgREST process: %w", err)
	}
	_ = syscall.Kill(-pid, syscall.SIGTERM)
	_ = process.Signal(syscall.SIGTERM)
	for range 20 {
		if !processAlive(pid) {
			_ = os.Remove(paths.postgrestPid)
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	_ = syscall.Kill(-pid, syscall.SIGKILL)
	_ = process.Kill()
	_ = os.Remove(paths.postgrestPid)
	return nil
}

func runCommand(binDir, name string, args ...string) error {
	cmd := exec.Command(commandPath(binDir, name), args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %s: %w\n%s", name, strings.Join(args, " "), err, strings.TrimSpace(string(output)))
	}
	return nil
}

func commandPath(binDir, name string) string {
	if binDir == "" {
		return name
	}
	return filepath.Join(binDir, name)
}

func envOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func statusText(running bool) string {
	if running {
		return "running"
	}
	return "stopped"
}

func isRunning(pidPath string) bool {
	pid, err := readPID(pidPath)
	if err != nil {
		return false
	}
	return processAlive(pid)
}

func readPID(pidPath string) (int, error) {
	data, err := os.ReadFile(pidPath)
	if err != nil {
		return 0, err
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		return 0, fmt.Errorf("read pid %s: %w", pidPath, err)
	}
	return pid, nil
}

func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

func waitForPort(address string, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	for {
		conn, err := net.DialTimeout("tcp", address, 100*time.Millisecond)
		if err == nil {
			_ = conn.Close()
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
			time.Sleep(100 * time.Millisecond)
		}
	}
}
