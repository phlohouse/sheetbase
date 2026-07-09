package main

import (
	"net/http"
	"net/http/httptest"
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
		filepath.Join(home, "backups"),
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
	if !strings.Contains(text, "postgres://postgres:postgres@sheetbase-postgres-") {
		t.Fatalf("config does not contain Docker postgres host: %s", text)
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

	appConfig, err := os.ReadFile(filepath.Join(home, "config", "sheetbase.env"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(appConfig), "SHEETBASE_POSTGRES_PORT=55433") {
		t.Fatalf("app config does not contain postgres port: %s", appConfig)
	}
}

func TestHTTPHealthyChecksHealthz(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/healthz" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	addr := strings.TrimPrefix(server.URL, "http://")
	if !httpHealthy(addr) {
		t.Fatal("httpHealthy = false, want true")
	}
}

func TestParseAppConfigUsesEnvironmentDefaults(t *testing.T) {
	t.Setenv("SHEETBASE_HOME", filepath.Join(t.TempDir(), "sheetbase"))
	t.Setenv("SHEETBASE_POSTGRES_PORT", "55444")
	t.Setenv("SHEETBASE_POSTGREST_PORT", "3002")
	t.Setenv("SHEETBASE_JWT_SECRET", "test-secret")

	cfg, err := parseAppConfig("status", nil)
	if err != nil {
		t.Fatal(err)
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

func TestParseAppConfigReadsFileButKeepsFlagPrecedence(t *testing.T) {
	home := t.TempDir()
	if err := os.MkdirAll(filepath.Join(home, "config"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, "config", "sheetbase.env"), []byte("SHEETBASE_ADDR=:9999\nSHEETBASE_POSTGRES_PORT=55555\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	cfg, err := parseAppConfig("status", []string{"--home", home, "--addr", ":7777"})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.appAddr != ":7777" {
		t.Fatalf("appAddr = %q, want flag value", cfg.appAddr)
	}
	if cfg.postgresPort != "55555" {
		t.Fatalf("postgresPort = %q, want file value", cfg.postgresPort)
	}
}
