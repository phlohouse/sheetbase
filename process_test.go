package main

import (
	"encoding/xml"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
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
		filepath.Join(home, "runtime"),
		filepath.Join(home, "run"),
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
	if !strings.Contains(text, "postgres://postgres:postgres@127.0.0.1:55433/postgres") {
		t.Fatalf("config does not contain native postgres address: %s", text)
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
	configInfo, err := os.Stat(filepath.Join(home, "config", "postgrest.conf"))
	if err != nil {
		t.Fatal(err)
	}
	if configInfo.Mode().Perm() != 0o600 {
		t.Fatalf("postgrest config mode = %o", configInfo.Mode().Perm())
	}

	appConfig, err := os.ReadFile(filepath.Join(home, "config", "sheetbase.env"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(appConfig), "SHEETBASE_POSTGRES_PORT=55433") {
		t.Fatalf("app config does not contain postgres port: %s", appConfig)
	}
}

func TestRuntimeArtifactForPostgREST(t *testing.T) {
	artifact, err := postgrestArtifact("darwin", "arm64")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(artifact.URL, "PostgREST/postgrest/releases/download/") || !strings.Contains(artifact.URL, "macos-aarch64") {
		t.Fatalf("unexpected artifact: %+v", artifact)
	}
	if len(artifact.SHA256) != 64 {
		t.Fatalf("checksum = %q", artifact.SHA256)
	}
}

func TestRuntimeArtifactRejectsUnsupportedPlatform(t *testing.T) {
	if _, err := postgrestArtifact("windows", "amd64"); err == nil {
		t.Fatal("expected unsupported platform error")
	}
}

func TestVerifySHA256(t *testing.T) {
	path := filepath.Join(t.TempDir(), "artifact")
	if err := os.WriteFile(path, []byte("sheetbase"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := verifySHA256(path, "eae3aa98bb91d5b23e81e31a4dc598189dacb0f69cab39dba7d10382f74026fe"); err != nil {
		t.Fatal(err)
	}
	if err := verifySHA256(path, strings.Repeat("0", 64)); err == nil {
		t.Fatal("expected checksum mismatch")
	}
}

func TestNativeProcessStatusRejectsStalePID(t *testing.T) {
	pidFile := filepath.Join(t.TempDir(), "service.pid")
	if err := os.WriteFile(pidFile, []byte("99999999\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := nativeProcessStatus(pidFile); got.Running {
		t.Fatalf("status = %+v", got)
	}
}

func TestRPMMetadataModelsAndSelection(t *testing.T) {
	var metadata rpmRepoMetadata
	if err := xml.Unmarshal([]byte(`<repomd><data type="primary"><checksum type="sha256">abc123</checksum><location href="repodata/primary.xml.gz"/></data></repomd>`), &metadata); err != nil {
		t.Fatal(err)
	}
	if len(metadata.Data) != 1 || metadata.Data[0].Checksum.Value != "abc123" || metadata.Data[0].Location.Href != "repodata/primary.xml.gz" {
		t.Fatalf("metadata = %+v", metadata)
	}
	var index rpmPackageIndex
	if err := xml.Unmarshal([]byte(`<metadata><package><name>postgresql16-server</name><arch>x86_64</arch><version ver="16.14" rel="1PGDG.rhel9"/><checksum type="sha256">deadbeef</checksum><location href="postgresql16-server.rpm"/></package></metadata>`), &index); err != nil {
		t.Fatal(err)
	}
	entry, ok := newestRPMPackage(index.Packages, "postgresql16-server", "x86_64")
	if !ok || entry.Checksum.Value != "deadbeef" || entry.Location.Href != "postgresql16-server.rpm" {
		t.Fatalf("entry = %+v, ok = %v", entry, ok)
	}
}

func TestDebianPackageSelectionAllowsIndependentLibpqVersion(t *testing.T) {
	entries := []map[string]string{
		{"Package": "libpq5", "Architecture": "arm64", "Version": "18.4-1", "Filename": "libpq5_18.4_arm64.deb"},
		{"Package": "postgresql-16", "Architecture": "arm64", "Version": "16.14-1", "Filename": "postgresql-16_16.14_arm64.deb"},
	}
	libpq, ok := newestDebianPackage(entries, "libpq5", "arm64", "")
	if !ok || libpq["Version"] != "18.4-1" {
		t.Fatalf("libpq = %+v, ok = %v", libpq, ok)
	}
	postgres, ok := newestDebianPackage(entries, "postgresql-16", "arm64", postgresVersion)
	if !ok || postgres["Version"] != "16.14-1" {
		t.Fatalf("postgres = %+v, ok = %v", postgres, ok)
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

func TestDisplayAppURL(t *testing.T) {
	for input, want := range map[string]string{
		":8080":          "http://127.0.0.1:8080",
		"127.0.0.1:9000": "http://127.0.0.1:9000",
	} {
		if got := displayAppURL(input); got != want {
			t.Fatalf("displayAppURL(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestBackgroundAppStatusIdentifiesUnmanagedServer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" {
			w.WriteHeader(http.StatusOK)
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	cfg := appConfig{appAddr: strings.TrimPrefix(server.URL, "http://")}
	if got := backgroundAppStatus(newAppPaths(t.TempDir()), cfg); !strings.HasPrefix(got, "running unmanaged") {
		t.Fatalf("status = %q", got)
	}
}

func TestBackgroundServeArgsPreserveExplicitEmptyDBURL(t *testing.T) {
	paths := newAppPaths(t.TempDir())
	args := backgroundServeArgs(paths, appConfig{}, []string{"--db-url", ""})
	want := []string{"serve", "--home", paths.home, "--db-url", ""}
	if strings.Join(args, "\x00") != strings.Join(want, "\x00") {
		t.Fatalf("args = %#v, want %#v", args, want)
	}
}

func TestSheetbaseChildEnvironmentRemovesConfigurationOverrides(t *testing.T) {
	t.Setenv("SHEETBASE_ADDR", ":9999")
	t.Setenv("UNRELATED_VALUE", "kept")
	env := strings.Join(sheetbaseChildEnvironment(), "\n")
	if strings.Contains(env, "SHEETBASE_ADDR=") {
		t.Fatalf("environment leaked Sheetbase override:\n%s", env)
	}
	if !strings.Contains(env, "UNRELATED_VALUE=kept") {
		t.Fatalf("environment removed unrelated value:\n%s", env)
	}
}

func TestAcquireProcessLockRejectsConcurrentLifecycle(t *testing.T) {
	path := filepath.Join(t.TempDir(), "run", "lifecycle.lock")
	release, err := acquireProcessLock(path)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if _, err := acquireProcessLock(path); err == nil {
		t.Fatal("expected concurrent lock to fail")
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

func TestSecureJWTSecretReplacesDevelopmentDefault(t *testing.T) {
	cfg, err := withSecureJWTSecret(appConfig{jwtSecret: defaultJWTSecret})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.jwtSecret == defaultJWTSecret || len(cfg.jwtSecret) < 48 {
		t.Fatalf("generated secret is not secure")
	}
}

func TestParseAppConfigReadsFileButKeepsFlagPrecedence(t *testing.T) {
	home := t.TempDir()
	if err := os.MkdirAll(filepath.Join(home, "config"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, "config", "sheetbase.env"), []byte("SHEETBASE_ADDR=:9999\nSHEETBASE_POSTGRES_PORT=55555\nSHEETBASE_POSTGREST_URL=http://postgrest.test\n"), 0o600); err != nil {
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
	if cfg.postgrestURL != "http://postgrest.test" {
		t.Fatalf("postgrestURL = %q, want file value", cfg.postgrestURL)
	}
}

func TestDockerContainerStatusLine(t *testing.T) {
	stopped := dockerContainerStatus{}
	if stopped.Line() != "stopped" {
		t.Fatalf("stopped line = %q", stopped.Line())
	}

	running := dockerContainerStatus{
		Running: true,
		Image:   "postgres:16-alpine",
		ID:      "123456789abc",
		Ports:   "5432/tcp->0.0.0.0:55432",
	}
	if got := running.Line(); got != "running image=postgres:16-alpine id=123456789abc ports=5432/tcp->0.0.0.0:55432" {
		t.Fatalf("running line = %q", got)
	}
}

func TestContainerPublishesPort(t *testing.T) {
	status := dockerContainerStatus{
		Running: true,
		Ports:   "5432/tcp->0.0.0.0:55432",
	}
	if !containerPublishesPort(status, "5432/tcp", "55432") {
		t.Fatal("expected matching published port")
	}
	if containerPublishesPort(status, "5432/tcp", "55433") {
		t.Fatal("unexpected match for a different host port")
	}
	if containerPublishesPort(status, "3000/tcp", "55432") {
		t.Fatal("unexpected match for a different container port")
	}
}

func TestParseAppConfigCanonicalizesRelativeHome(t *testing.T) {
	cfg, err := parseAppConfig("test", []string{"--home", "relative-sheetbase-home"})
	if err != nil {
		t.Fatal(err)
	}
	want, err := filepath.Abs("relative-sheetbase-home")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.home != want {
		t.Fatalf("home = %q, want %q", cfg.home, want)
	}
}

func TestWaitForPostgRESTRejectsUnrelatedHTTPService(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	if err := waitForPostgREST(server.URL, 150*time.Millisecond); err == nil {
		t.Fatal("expected an unrelated HTTP service to fail readiness")
	}
}

func TestWaitForPostgRESTAcceptsOpenAPIResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/openapi+json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	if err := waitForPostgREST(server.URL, time.Second); err != nil {
		t.Fatal(err)
	}
}

func TestStatusWritesOperatorLog(t *testing.T) {
	home := t.TempDir()

	if err := statusApp([]string{"--home", home, "--addr", "127.0.0.1:1"}); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(filepath.Join(home, "logs", "sheetbase.log"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	for _, want := range []string{`msg="command started"`, "command=status", `msg="command completed"`} {
		if !strings.Contains(text, want) {
			t.Fatalf("operator log missing %q:\n%s", want, text)
		}
	}
}
