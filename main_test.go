package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUIHandlerServesAppShellAndHealth(t *testing.T) {
	handler, err := newUIHandler("http://127.0.0.1:3000")
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

	handler, err := newUIHandler(backend.URL)
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
