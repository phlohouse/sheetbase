package main

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGeneratedAPIKeysArePrefixedAndStoredAsHashes(t *testing.T) {
	token, hash, prefix, err := generateAPIKey()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(token, "sbk_") || len(token) < 40 {
		t.Fatalf("token has unexpected format")
	}
	if prefix != token[:12] {
		t.Fatalf("prefix = %q", prefix)
	}
	if hash != hashAPIKey(token) || strings.Contains(hash, token) {
		t.Fatalf("API key hash is incorrect")
	}
	second, _, _, err := generateAPIKey()
	if err != nil {
		t.Fatal(err)
	}
	if second == token {
		t.Fatal("generated duplicate API keys")
	}
}

func TestAPIKeyCanUseBearerHeader(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/example", nil)
	request.Header.Set("Authorization", "Bearer sbk_secret")
	if got := apiKeyFromRequest(request); got != "sbk_secret" {
		t.Fatalf("token = %q", got)
	}
}
