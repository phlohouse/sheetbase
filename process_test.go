package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInitAppCreatesHomeLayoutAndPostgRESTConfig(t *testing.T) {
	home := t.TempDir()

	if err := initApp([]string{"--home", home, "--postgres-port", "55433", "--postgrest-port", "3301"}); err != nil {
		t.Fatal(err)
	}

	for _, path := range []string{
		filepath.Join(home, "bin"),
		filepath.Join(home, "config"),
		filepath.Join(home, "logs"),
		filepath.Join(home, "data", "postgres"),
	} {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatalf("stat %s: %v", path, err)
		}
		if !info.IsDir() {
			t.Fatalf("%s is not a directory", path)
		}
	}

	config, err := os.ReadFile(filepath.Join(home, "config", "postgrest.conf"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(config)
	if !strings.Contains(text, "127.0.0.1:55433") {
		t.Fatalf("config does not contain postgres port: %s", text)
	}
	if !strings.Contains(text, "server-port = 3301") {
		t.Fatalf("config does not contain postgrest port: %s", text)
	}
	if !strings.Contains(text, `db-anon-role = "sheetbase_api"`) {
		t.Fatalf("config does not contain API role: %s", text)
	}
	if !strings.Contains(text, `jwt-secret = "`) {
		t.Fatalf("config does not contain JWT secret: %s", text)
	}
}

func TestParseAppConfigUsesEnvironmentDefaults(t *testing.T) {
	t.Setenv("SHEETBASE_HOME", filepath.Join(t.TempDir(), "sheetbase"))
	t.Setenv("SHEETBASE_POSTGRES_BIN", "/opt/postgres/bin")
	t.Setenv("SHEETBASE_POSTGREST_BIN", "/opt/postgrest")
	t.Setenv("SHEETBASE_POSTGRES_PORT", "55444")
	t.Setenv("SHEETBASE_POSTGREST_PORT", "3002")
	t.Setenv("SHEETBASE_JWT_SECRET", "test-secret")

	cfg, err := parseAppConfig("status", nil)
	if err != nil {
		t.Fatal(err)
	}

	if cfg.postgresBin != "/opt/postgres/bin" {
		t.Fatalf("postgresBin = %q", cfg.postgresBin)
	}
	if cfg.postgrestBin != "/opt/postgrest" {
		t.Fatalf("postgrestBin = %q", cfg.postgrestBin)
	}
	if cfg.postgresPort != "55444" {
		t.Fatalf("postgresPort = %q", cfg.postgresPort)
	}
	if cfg.postgrestPort != "3002" {
		t.Fatalf("postgrestPort = %q", cfg.postgrestPort)
	}
	if cfg.jwtSecret != "test-secret" {
		t.Fatalf("jwtSecret = %q", cfg.jwtSecret)
	}
}
