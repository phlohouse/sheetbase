package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUIHandlerServesAppShellAndHealth(t *testing.T) {
	handler, err := newUIHandler()
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
