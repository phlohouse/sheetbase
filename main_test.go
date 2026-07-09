package main

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
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

func TestUIHandlerProxiesAPIToPostgREST(t *testing.T) {
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

	req := httptest.NewRequest(http.MethodGet, "/api/sheet_forms?select=*", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("GET /api/sheet_forms status = %d, want %d", res.Code, http.StatusOK)
	}
	if strings.TrimSpace(res.Body.String()) != `[{"name":"Companies"}]` {
		t.Fatalf("proxied body = %q", res.Body.String())
	}
}

func TestAuthProtectsAPIProxy(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			t.Fatalf("missing bearer token: %q", r.Header.Get("Authorization"))
		}
		_, _ = w.Write([]byte(`[]`))
	}))
	defer backend.Close()

	auth := &authService{store: &fakeUserStore{}, jwtSecret: defaultJWTSecret, sessions: map[string]string{}}
	handler, err := newUIHandler(backend.URL, auth)
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/sheet_forms", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated API status = %d, want %d", res.Code, http.StatusUnauthorized)
	}

	login := httptest.NewRequest(http.MethodPost, "/auth/setup", strings.NewReader(`{"email":"admin@example.com","password":"long-enough-password"}`))
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, login)
	if res.Code != http.StatusOK {
		t.Fatalf("setup status = %d, want %d: %s", res.Code, http.StatusOK, res.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/sheet_forms", nil)
	req.AddCookie(res.Result().Cookies()[0])
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("authenticated API status = %d, want %d", res.Code, http.StatusOK)
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

	if !strings.Contains(output.String(), "sheetbase migrate") {
		t.Fatalf("usage missing migrate:\n%s", output.String())
	}
}

type fakeUserStore struct {
	user userRecord
}

func (s *fakeUserStore) createFirstUser(_ context.Context, email, passwordHash string) (string, error) {
	s.user = userRecord{ID: "user-1", Email: email, PasswordHash: passwordHash}
	return s.user.ID, nil
}

func (s *fakeUserStore) userByEmail(_ context.Context, email string) (userRecord, error) {
	return s.user, nil
}
