package main

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type appConfig struct {
	home          string
	postgresPort  string
	postgrestPort string
	appAddr       string
	jwtSecret     string
	postgrestURL  string
	dbURL         string
	backupOut     string
	restoreIn     string
}

type appPaths struct {
	home            string
	backups         string
	config          string
	logs            string
	appLog          string
	postgresData    string
	postgrestConfig string
	sheetbaseConfig string
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
	if err := writeSheetbaseConfig(paths, cfg, false); err != nil {
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
	if err := startPostgres(paths, cfg); err != nil {
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

func migrateApp(args []string) error {
	cfg, err := parseAppConfig("migrate", args)
	if err != nil {
		return err
	}
	if err := applyMigrations(newAppPaths(cfg.home), cfg); err != nil {
		return err
	}
	fmt.Println("migrations applied")
	return nil
}

func stopApp(args []string) error {
	cfg, err := parseAppConfig("stop", args)
	if err != nil {
		return err
	}
	paths := newAppPaths(cfg.home)
	if err := dockerRm(containerName("postgrest", paths)); err != nil {
		return err
	}
	if err := dockerRm(containerName("postgres", paths)); err != nil {
		return err
	}
	_ = runCommand("", "docker", "network", "rm", networkName(paths))
	fmt.Printf("stopped Sheetbase services from %s\n", paths.home)
	return nil
}

func statusApp(args []string) error {
	cfg, err := parseAppConfig("status", args)
	if err != nil {
		return err
	}
	paths := newAppPaths(cfg.home)
	postgres := containerStatus(containerName("postgres", paths))
	postgrest := containerStatus(containerName("postgrest", paths))
	fmt.Printf("home: %s\n", paths.home)
	fmt.Printf("app: %s\n", statusText(httpHealthy(cfg.appAddr)))
	fmt.Printf("postgres: %s\n", postgres.Line())
	fmt.Printf("postgrest: %s\n", postgrest.Line())
	fmt.Printf("logs: %s\n", paths.logs)
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
	flags.StringVar(&cfg.appAddr, "addr", envOrDefault("SHEETBASE_ADDR", ":8080"), "Sheetbase HTTP listen address")
	flags.StringVar(&cfg.postgresPort, "postgres-port", envOrDefault("SHEETBASE_POSTGRES_PORT", "55432"), "managed PostgreSQL port")
	flags.StringVar(&cfg.postgrestPort, "postgrest-port", envOrDefault("SHEETBASE_POSTGREST_PORT", "3000"), "managed PostgREST port")
	flags.StringVar(&cfg.jwtSecret, "jwt-secret", envOrDefault("SHEETBASE_JWT_SECRET", defaultJWTSecret), "PostgREST JWT secret")
	flags.StringVar(&cfg.postgrestURL, "postgrest-url", envOrDefault("SHEETBASE_POSTGREST_URL", ""), "PostgREST URL for /api proxy")
	flags.StringVar(&cfg.dbURL, "db-url", envOrDefault("SHEETBASE_DB_URL", ""), "PostgreSQL URL for auth; empty disables auth")
	flags.StringVar(&cfg.backupOut, "out", "", "backup file path")
	flags.StringVar(&cfg.restoreIn, "in", "", "backup file path")
	if err := flags.Parse(args); err != nil {
		return appConfig{}, err
	}
	visited := map[string]bool{}
	flags.Visit(func(flag *flag.Flag) {
		visited[flag.Name] = true
	})
	cfg.home = filepath.Clean(cfg.home)
	cfg = mergeFileConfig(cfg, readConfigFile(newAppPaths(cfg.home).sheetbaseConfig), visited)
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
		backups:         filepath.Join(home, "backups"),
		config:          filepath.Join(home, "config"),
		logs:            filepath.Join(home, "logs"),
		appLog:          filepath.Join(home, "logs", "sheetbase.log"),
		postgresData:    filepath.Join(home, "data", "postgres"),
		postgrestConfig: filepath.Join(home, "config", "postgrest.conf"),
		sheetbaseConfig: filepath.Join(home, "config", "sheetbase.env"),
	}
}

func ensureAppHome(paths appPaths) error {
	for _, dir := range []string{paths.backups, paths.config, paths.logs, paths.postgresData} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("create %s: %w", dir, err)
		}
	}
	return nil
}

func startPostgres(paths appPaths, cfg appConfig) error {
	if containerRunning(containerName("postgres", paths)) {
		return nil
	}
	_ = runCommand("", "docker", "network", "create", networkName(paths))
	if err := runCommand("", "docker", "run",
		"--detach",
		"--name", containerName("postgres", paths),
		"--network", networkName(paths),
		"--publish", cfg.postgresPort+":5432",
		"--env", "POSTGRES_PASSWORD=postgres",
		"--volume", paths.postgresData+":/var/lib/postgresql/data",
		"postgres:16-alpine",
	); err != nil {
		return err
	}
	for range 80 {
		if runCommand("", "docker", "exec", containerName("postgres", paths), "pg_isready", "-U", "postgres") == nil {
			time.Sleep(time.Second)
			if runCommand("", "docker", "exec", containerName("postgres", paths), "pg_isready", "-U", "postgres") == nil {
				return nil
			}
		}
		time.Sleep(250 * time.Millisecond)
	}
	return errors.New("postgres did not become ready")
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
		cmd := exec.Command("docker", "exec", "-i", containerName("postgres", paths), "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres")
		cmd.Stdin = strings.NewReader(string(sql))
		output, err := cmd.CombinedOutput()
		if err != nil {
			return fmt.Errorf("apply migration %s: %w\n%s", entry.Name(), err, strings.TrimSpace(string(output)))
		}
	}
	return nil
}

func writePostgRESTConfig(paths appPaths, cfg appConfig) error {
	config := fmt.Sprintf(`db-uri = "postgres://postgres:postgres@%s:5432/postgres"
db-schemas = "public"
db-anon-role = "sheetbase_api"
server-host = "127.0.0.1"
server-port = %s
openapi-mode = "follow-privileges"
jwt-secret = "%s"
`, containerName("postgres", paths), cfg.postgrestPort, cfg.jwtSecret)
	return os.WriteFile(paths.postgrestConfig, []byte(config), 0o644)
}

func writeSheetbaseConfig(paths appPaths, cfg appConfig, overwrite bool) error {
	if _, err := os.Stat(paths.sheetbaseConfig); err == nil && !overwrite {
		return nil
	}
	config := fmt.Sprintf(`SHEETBASE_ADDR=%s
SHEETBASE_POSTGRES_PORT=%s
SHEETBASE_POSTGREST_PORT=%s
SHEETBASE_JWT_SECRET=%s
`, cfg.appAddr, cfg.postgresPort, cfg.postgrestPort, cfg.jwtSecret)
	return os.WriteFile(paths.sheetbaseConfig, []byte(config), 0o600)
}

func readConfigFile(path string) map[string]string {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	values := map[string]string{}
	for _, line := range strings.Split(string(data), "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), "=")
		if ok && key != "" && !strings.HasPrefix(key, "#") {
			values[key] = value
		}
	}
	return values
}

func mergeFileConfig(cfg appConfig, values map[string]string, visited map[string]bool) appConfig {
	if values == nil {
		return cfg
	}
	if !visited["addr"] && os.Getenv("SHEETBASE_ADDR") == "" && values["SHEETBASE_ADDR"] != "" {
		cfg.appAddr = values["SHEETBASE_ADDR"]
	}
	if !visited["postgres-port"] && os.Getenv("SHEETBASE_POSTGRES_PORT") == "" && values["SHEETBASE_POSTGRES_PORT"] != "" {
		cfg.postgresPort = values["SHEETBASE_POSTGRES_PORT"]
	}
	if !visited["postgrest-port"] && os.Getenv("SHEETBASE_POSTGREST_PORT") == "" && values["SHEETBASE_POSTGREST_PORT"] != "" {
		cfg.postgrestPort = values["SHEETBASE_POSTGREST_PORT"]
	}
	if !visited["jwt-secret"] && os.Getenv("SHEETBASE_JWT_SECRET") == "" && values["SHEETBASE_JWT_SECRET"] != "" {
		cfg.jwtSecret = values["SHEETBASE_JWT_SECRET"]
	}
	if !visited["postgrest-url"] && os.Getenv("SHEETBASE_POSTGREST_URL") == "" && values["SHEETBASE_POSTGREST_URL"] != "" {
		cfg.postgrestURL = values["SHEETBASE_POSTGREST_URL"]
	}
	if !visited["db-url"] && os.Getenv("SHEETBASE_DB_URL") == "" && values["SHEETBASE_DB_URL"] != "" {
		cfg.dbURL = values["SHEETBASE_DB_URL"]
	}
	return cfg
}

func startPostgREST(paths appPaths, cfg appConfig) error {
	if containerRunning(containerName("postgrest", paths)) {
		return nil
	}
	if err := runCommand("", "docker", "run",
		"--detach",
		"--name", containerName("postgrest", paths),
		"--network", networkName(paths),
		"--publish", cfg.postgrestPort+":3000",
		"--env", "PGRST_DB_URI=postgres://postgres:postgres@"+containerName("postgres", paths)+":5432/postgres",
		"--env", "PGRST_DB_SCHEMAS=public",
		"--env", "PGRST_DB_ANON_ROLE=sheetbase_api",
		"--env", "PGRST_JWT_SECRET="+cfg.jwtSecret,
		"--env", "PGRST_OPENAPI_MODE=follow-privileges",
		"postgrest/postgrest:v12.2.8",
	); err != nil {
		return err
	}
	if err := waitForPort("127.0.0.1:"+cfg.postgrestPort, 5*time.Second); err != nil {
		return fmt.Errorf("wait for PostgREST: %w", err)
	}
	return nil
}

func runCommand(_ string, name string, args ...string) error {
	cmd := exec.Command(name, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %s: %w\n%s", name, strings.Join(args, " "), err, strings.TrimSpace(string(output)))
	}
	return nil
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

func dockerRm(name string) error {
	_ = runCommand("", "docker", "rm", "-f", name)
	return nil
}

func containerRunning(name string) bool {
	return containerStatus(name).Running
}

type dockerContainerStatus struct {
	Running bool
	Image   string
	ID      string
	Ports   string
}

func (s dockerContainerStatus) Line() string {
	if !s.Running {
		return "stopped"
	}
	parts := []string{"running"}
	if s.Image != "" {
		parts = append(parts, "image="+s.Image)
	}
	if s.ID != "" {
		parts = append(parts, "id="+s.ID)
	}
	if s.Ports != "" {
		parts = append(parts, "ports="+s.Ports)
	}
	return strings.Join(parts, " ")
}

func containerStatus(name string) dockerContainerStatus {
	cmd := exec.Command("docker", "inspect", "-f", "{{.State.Running}}\t{{.Config.Image}}\t{{.Id}}\t{{range $p, $bindings := .NetworkSettings.Ports}}{{$p}}->{{range $bindings}}{{.HostIp}}:{{.HostPort}}{{end}} {{end}}", name)
	output, err := cmd.Output()
	if err != nil {
		return dockerContainerStatus{}
	}
	parts := strings.Split(strings.TrimSpace(string(output)), "\t")
	if len(parts) < 4 || parts[0] != "true" {
		return dockerContainerStatus{}
	}
	id := parts[2]
	if len(id) > 12 {
		id = id[:12]
	}
	return dockerContainerStatus{
		Running: true,
		Image:   parts[1],
		ID:      id,
		Ports:   strings.TrimSpace(parts[3]),
	}
}

func containerName(kind string, paths appPaths) string {
	sum := sha1.Sum([]byte(paths.home))
	return "sheetbase-" + kind + "-" + hex.EncodeToString(sum[:])[:12]
}

func networkName(paths appPaths) string {
	sum := sha1.Sum([]byte(paths.home))
	return "sheetbase-" + hex.EncodeToString(sum[:])[:12]
}

func dockerExecToFile(target string, args ...string) error {
	file, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()
	cmd := exec.Command("docker", args...)
	cmd.Stdout = file
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("docker %s: %w\n%s", strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
	}
	return nil
}

func dockerExecFromFile(source string, args ...string) error {
	file, err := os.Open(source)
	if err != nil {
		return err
	}
	defer file.Close()
	cmd := exec.Command("docker", args...)
	cmd.Stdin = file
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("docker %s: %w\n%s", strings.Join(args, " "), err, strings.TrimSpace(string(output)))
	}
	return nil
}

func httpHealthy(addr string) bool {
	if strings.HasPrefix(addr, ":") {
		addr = "127.0.0.1" + addr
	}
	client := http.Client{Timeout: 500 * time.Millisecond}
	res, err := client.Get("http://" + addr + "/healthz")
	if err != nil {
		return false
	}
	defer res.Body.Close()
	return res.StatusCode == http.StatusOK
}
