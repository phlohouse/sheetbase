package main

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestUIHandlerServesAppShellAndHealth(t *testing.T) {
	handler, err := newUIHandler("http://127.0.0.1:3000", nil)
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("GET / status = %d, want %d", res.Code, http.StatusOK)
	}
	if !strings.Contains(res.Body.String(), "Sheetbase") {
		t.Fatalf("GET / body does not contain app shell marker")
	}

	req = httptest.NewRequest(http.MethodGet, "/healthz", nil)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("GET /healthz status = %d, want %d", res.Code, http.StatusOK)
	}
	if strings.TrimSpace(res.Body.String()) != "ok" {
		t.Fatalf("GET /healthz body = %q, want ok", res.Body.String())
	}
}

func TestUIHandlerProxiesInternalRequestsToPostgREST(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.String() != "/sheet_forms?select=*" {
			t.Fatalf("proxied URL = %q", r.URL.String())
		}
		_, _ = w.Write([]byte(`[{"name":"Companies"}]`))
	}))
	defer backend.Close()

	handler, err := newUIHandler(backend.URL, nil)
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/internal/sheet_forms?select=*", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("GET /internal/sheet_forms status = %d, want %d", res.Code, http.StatusOK)
	}
	if strings.TrimSpace(res.Body.String()) != `[{"name":"Companies"}]` {
		t.Fatalf("proxied body = %q", res.Body.String())
	}
}

func TestSheetbaseSessionProtectsOnlyInternalProxy(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			t.Fatalf("missing bearer token: %q", r.Header.Get("Authorization"))
		}
		_, _ = w.Write([]byte(`[]`))
	}))
	defer backend.Close()

	auth := &authService{store: &fakeUserStore{}, apiKeys: &fakeAPIKeyStore{active: true}, jwtSecret: defaultJWTSecret, sessions: map[string]sessionRecord{}}
	handler, err := newUIHandler(backend.URL, auth)
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/internal/sheet_forms", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated internal status = %d, want %d", res.Code, http.StatusUnauthorized)
	}

	login := httptest.NewRequest(http.MethodPost, "/auth/setup", strings.NewReader(`{"email":"admin@example.com","password":"long-enough-password"}`))
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, login)
	if res.Code != http.StatusOK {
		t.Fatalf("setup status = %d, want %d: %s", res.Code, http.StatusOK, res.Body.String())
	}
	sessionCookie := res.Result().Cookies()[0]

	req = httptest.NewRequest(http.MethodGet, "/internal/sheet_forms", nil)
	req.AddCookie(sessionCookie)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("authenticated internal status = %d, want %d", res.Code, http.StatusOK)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/sheet_forms", nil)
	req.AddCookie(sessionCookie)
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("Sheetbase cookie authorized public API: status %d", res.Code)
	}
}

func TestAPIKeyAuthenticatesPublicProxyWithoutSheetbaseSession(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			t.Fatalf("missing PostgREST JWT")
		}
		_, _ = w.Write([]byte(`[]`))
	}))
	defer backend.Close()
	auth := &authService{apiKeys: &fakeAPIKeyStore{authenticatedID: "00000000-0000-0000-0000-000000000123"}, jwtSecret: defaultJWTSecret, sessions: map[string]sessionRecord{}}
	handler, err := newUIHandler(backend.URL, auth)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/sheet_forms", nil)
	req.Header.Set("X-API-Key", "sbk_test-token")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("API key status = %d: %s", res.Code, res.Body.String())
	}
}

func TestPublicProxyIsOpenWhenNoAPIKeysExist(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			t.Fatal("missing public PostgREST JWT")
		}
		_, _ = w.Write([]byte(`[]`))
	}))
	defer backend.Close()
	auth := &authService{apiKeys: &fakeAPIKeyStore{}, jwtSecret: defaultJWTSecret, sessions: map[string]sessionRecord{}}
	handler, err := newUIHandler(backend.URL, auth)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/sheet_forms", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("open API status = %d: %s", res.Code, res.Body.String())
	}
}

func TestSetupAcceptsEightCharacterPassword(t *testing.T) {
	auth := &authService{store: &fakeUserStore{}, jwtSecret: defaultJWTSecret, sessions: map[string]sessionRecord{}}
	handler, err := newUIHandler("http://127.0.0.1:3000", auth)
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/auth/setup", strings.NewReader(`{"email":"admin@example.com","password":"12345678"}`))
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("setup status = %d, want %d: %s", res.Code, http.StatusOK, res.Body.String())
	}
}

func TestUIHandlerLogsAPIRequests(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	defer slog.SetDefault(previous)
	slog.SetDefault(slog.New(slog.NewTextHandler(&output, nil)))

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`[]`))
	}))
	defer backend.Close()

	auth := &authService{apiKeys: &fakeAPIKeyStore{authenticatedID: "00000000-0000-0000-0000-000000000123"}, jwtSecret: defaultJWTSecret, sessions: map[string]sessionRecord{}}
	handler, err := newUIHandler(backend.URL, auth)
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/sheet_forms?select=*", nil)
	req.Header.Set("X-API-Key", "sbk_test-token")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	logs := output.String()
	for _, want := range []string{`msg="http request"`, "method=GET", "path=/api/sheet_forms", "status=200"} {
		if !strings.Contains(logs, want) {
			t.Fatalf("log missing %q:\n%s", want, logs)
		}
	}
}

func TestExportDownloadRequiresAuth(t *testing.T) {
	auth := &authService{store: &fakeUserStore{}, jwtSecret: defaultJWTSecret, sessions: map[string]sessionRecord{}}
	handler := withExportDownload(http.NotFoundHandler(), newAppPaths(t.TempDir()), auth)

	req := httptest.NewRequest(http.MethodGet, "/admin/export", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusUnauthorized {
		t.Fatalf("export status = %d, want %d", res.Code, http.StatusUnauthorized)
	}
}

func TestAuthRejectsExpiredSession(t *testing.T) {
	auth := &authService{
		sessions: map[string]sessionRecord{
			"expired": {userID: "user-1", expires: time.Now().Add(-time.Minute)},
		},
	}
	req := httptest.NewRequest(http.MethodGet, "/api/sheet_forms", nil)
	req.AddCookie(&http.Cookie{Name: "sheetbase_session", Value: "expired"})

	if _, ok := auth.userID(req); ok {
		t.Fatalf("expired session was accepted")
	}
	if _, ok := auth.sessions["expired"]; ok {
		t.Fatalf("expired session was not deleted")
	}
}

func TestSignedSessionSurvivesRestart(t *testing.T) {
	auth := &authService{jwtSecret: defaultJWTSecret, sessions: map[string]sessionRecord{}}
	res := httptest.NewRecorder()
	auth.setSession(res, "user-1")

	req := httptest.NewRequest(http.MethodGet, "/api/sheet_forms", nil)
	req.AddCookie(res.Result().Cookies()[0])

	restarted := &authService{jwtSecret: defaultJWTSecret, sessions: map[string]sessionRecord{}}
	userID, ok := restarted.userID(req)
	if !ok || userID != "user-1" {
		t.Fatalf("session after restart = %q, %v; want user-1, true", userID, ok)
	}
}

func TestLogoutRevokesCopiedSessionCookie(t *testing.T) {
	auth := &authService{jwtSecret: defaultJWTSecret, sessions: map[string]sessionRecord{}}
	login := httptest.NewRecorder()
	auth.setSession(login, "user-1")
	cookie := login.Result().Cookies()[0]
	request := httptest.NewRequest(http.MethodPost, "/auth/logout", nil)
	request.AddCookie(cookie)
	auth.handleLogout(httptest.NewRecorder(), request)
	copyRequest := httptest.NewRequest(http.MethodGet, "/internal/sheet_forms", nil)
	copyRequest.AddCookie(cookie)
	if _, ok := auth.userID(copyRequest); ok {
		t.Fatal("copied cookie remained valid after logout")
	}
}

func TestCleanAssetPath(t *testing.T) {
	tests := map[string]string{
		"":                      "index.html",
		"/":                     "index.html",
		"/assets/app.js":        "assets/app.js",
		"/assets/../index.html": "index.html",
	}

	for input, want := range tests {
		if got := cleanAssetPath(input); got != want {
			t.Fatalf("cleanAssetPath(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestUsageMentionsMigrate(t *testing.T) {
	var output bytes.Buffer
	stdout := os.Stdout
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = writer
	printUsage()
	_ = writer.Close()
	os.Stdout = stdout
	_, _ = output.ReadFrom(reader)

	if !strings.Contains(output.String(), "sheetbase migrate") || !strings.Contains(output.String(), "sheetbase upgrade") {
		t.Fatalf("usage missing migration commands:\n%s", output.String())
	}
}

func TestParseServeConfigReadsManagedHomeConfig(t *testing.T) {
	home := t.TempDir()
	if err := os.MkdirAll(home+"/config", 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(home+"/config/sheetbase.env", []byte("SHEETBASE_ADDR=:9090\nSHEETBASE_POSTGRES_PORT=55444\nSHEETBASE_POSTGREST_PORT=3004\nSHEETBASE_JWT_SECRET=test-secret\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	cfg, err := parseServeConfig([]string{"--home", home})
	if err != nil {
		t.Fatal(err)
	}

	if cfg.appAddr != ":9090" {
		t.Fatalf("appAddr = %q", cfg.appAddr)
	}
	if cfg.postgrestURL != "http://127.0.0.1:3004" {
		t.Fatalf("postgrestURL = %q", cfg.postgrestURL)
	}
	if cfg.dbURL != "postgres://postgres:postgres@127.0.0.1:55444/postgres?sslmode=disable" {
		t.Fatalf("dbURL = %q", cfg.dbURL)
	}
	if cfg.jwtSecret != "test-secret" {
		t.Fatalf("jwtSecret = %q", cfg.jwtSecret)
	}
}

func TestParseServeConfigKeepsExplicitURLs(t *testing.T) {
	cfg, err := parseServeConfig([]string{"-postgrest-url", "http://example.test:3000", "-db-url="})
	if err != nil {
		t.Fatal(err)
	}

	if cfg.postgrestURL != "http://example.test:3000" {
		t.Fatalf("postgrestURL = %q", cfg.postgrestURL)
	}
	if cfg.dbURL != "" {
		t.Fatalf("dbURL = %q, want auth disabled", cfg.dbURL)
	}
}

func TestSetupAppLoggingWritesUnderHome(t *testing.T) {
	paths := newAppPaths(t.TempDir())
	previous := slog.Default()
	defer slog.SetDefault(previous)

	if err := setupAppLogging(paths); err != nil {
		t.Fatal(err)
	}
	slog.Info("test log line")

	data, err := os.ReadFile(filepath.Join(paths.logs, "sheetbase.log"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "test log line") {
		t.Fatalf("log file missing message: %s", data)
	}
}

type fakeUserStore struct {
	user userRecord
}

type fakeAPIKeyStore struct {
	authenticatedID string
	active          bool
}

func (s *fakeAPIKeyStore) create(_ context.Context, _, name, _, prefix string, permissions []apiKeyPermission, allSheetForms bool) (apiKeyRecord, error) {
	return apiKeyRecord{ID: "key-1", Name: name, TokenPrefix: prefix, Permissions: permissions, AllSheetForms: allSheetForms}, nil
}
func (s *fakeAPIKeyStore) list(context.Context, string) ([]apiKeyRecord, error) {
	return []apiKeyRecord{}, nil
}
func (s *fakeAPIKeyStore) updatePermissions(context.Context, string, string, []apiKeyPermission, bool) error {
	return nil
}
func (s *fakeAPIKeyStore) revoke(context.Context, string, string) error { return nil }
func (s *fakeAPIKeyStore) authenticate(context.Context, string) (string, error) {
	if s.authenticatedID == "" {
		return "", errors.New("not found")
	}
	return s.authenticatedID, nil
}
func (s *fakeAPIKeyStore) hasActive(context.Context) (bool, error) {
	return s.active || s.authenticatedID != "", nil
}

func (s *fakeUserStore) createFirstUser(_ context.Context, email, passwordHash string) (string, error) {
	s.user = userRecord{ID: "user-1", Email: email, PasswordHash: passwordHash}
	return s.user.ID, nil
}

func (s *fakeUserStore) userByEmail(_ context.Context, email string) (userRecord, error) {
	return s.user, nil
}
