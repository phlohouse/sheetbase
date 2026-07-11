package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type apiKeyStore interface {
	create(ctx context.Context, userID, name, tokenHash, tokenPrefix, sheetFormID string, canRead, canWrite bool) (apiKeyRecord, error)
	list(ctx context.Context, userID string) ([]apiKeyRecord, error)
	revoke(ctx context.Context, userID, id string) error
	authenticate(ctx context.Context, tokenHash string) (string, error)
}

type apiKeyRecord struct {
	ID            string     `json:"id"`
	Name          string     `json:"name"`
	TokenPrefix   string     `json:"token_prefix"`
	SheetFormID   string     `json:"sheet_form_id"`
	SheetFormName string     `json:"sheet_form_name"`
	CanRead       bool       `json:"can_read"`
	CanWrite      bool       `json:"can_write"`
	CreatedAt     time.Time  `json:"created_at"`
	LastUsedAt    *time.Time `json:"last_used_at"`
	RevokedAt     *time.Time `json:"revoked_at"`
}

type sqlAPIKeyStore struct{ db *sql.DB }

func (s sqlAPIKeyStore) create(ctx context.Context, userID, name, tokenHash, tokenPrefix, sheetFormID string, canRead, canWrite bool) (apiKeyRecord, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return apiKeyRecord{}, err
	}
	defer tx.Rollback()
	var canManage bool
	if err := tx.QueryRowContext(ctx, `select exists (select 1 from permissions where user_id = $1 and sheet_form_id = $2 and can_admin)`, userID, sheetFormID).Scan(&canManage); err != nil {
		return apiKeyRecord{}, err
	}
	if !canManage {
		return apiKeyRecord{}, errors.New("Sheet Form admin access is required")
	}
	var key apiKeyRecord
	err = tx.QueryRowContext(ctx, `insert into api_keys (name, token_hash, token_prefix)
values ($1, $2, $3) returning id, name, token_prefix, created_at`, name, tokenHash, tokenPrefix).
		Scan(&key.ID, &key.Name, &key.TokenPrefix, &key.CreatedAt)
	if err != nil {
		return apiKeyRecord{}, err
	}
	if _, err := tx.ExecContext(ctx, `insert into api_key_permissions (api_key_id, sheet_form_id, can_read, can_write)
values ($1, $2, $3, $4)`, key.ID, sheetFormID, canRead, canWrite); err != nil {
		return apiKeyRecord{}, err
	}
	if err := tx.QueryRowContext(ctx, `select name from sheet_forms where id = $1`, sheetFormID).Scan(&key.SheetFormName); err != nil {
		return apiKeyRecord{}, err
	}
	key.SheetFormID, key.CanRead, key.CanWrite = sheetFormID, canRead, canWrite
	return key, tx.Commit()
}

func (s sqlAPIKeyStore) list(ctx context.Context, userID string) ([]apiKeyRecord, error) {
	rows, err := s.db.QueryContext(ctx, `select k.id, k.name, k.token_prefix, p.sheet_form_id, sf.name,
p.can_read, p.can_write, k.created_at, k.last_used_at, k.revoked_at
from api_keys k join api_key_permissions p on p.api_key_id = k.id
join sheet_forms sf on sf.id = p.sheet_form_id
join permissions manager on manager.sheet_form_id = p.sheet_form_id and manager.user_id = $1 and manager.can_admin
order by k.created_at desc`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := []apiKeyRecord{}
	for rows.Next() {
		var key apiKeyRecord
		if err := rows.Scan(&key.ID, &key.Name, &key.TokenPrefix, &key.SheetFormID, &key.SheetFormName, &key.CanRead, &key.CanWrite, &key.CreatedAt, &key.LastUsedAt, &key.RevokedAt); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, rows.Err()
}

func (s sqlAPIKeyStore) revoke(ctx context.Context, userID, id string) error {
	result, err := s.db.ExecContext(ctx, `update api_keys k set revoked_at = now()
where k.id = $1 and k.revoked_at is null and exists (
  select 1 from api_key_permissions p join permissions manager on manager.sheet_form_id = p.sheet_form_id
  where p.api_key_id = k.id and manager.user_id = $2 and manager.can_admin
)`, id, userID)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return errors.New("API key not found or already revoked")
	}
	return nil
}

func (s sqlAPIKeyStore) authenticate(ctx context.Context, tokenHash string) (string, error) {
	var id string
	err := s.db.QueryRowContext(ctx, `update api_keys set last_used_at = now()
where token_hash = $1 and revoked_at is null returning id`, tokenHash).Scan(&id)
	return id, err
}

func generateAPIKey() (token, hash, prefix string, err error) {
	secret := make([]byte, 32)
	if _, err = rand.Read(secret); err != nil {
		return "", "", "", err
	}
	token = "sbk_" + base64.RawURLEncoding.EncodeToString(secret)
	digest := sha256.Sum256([]byte(token))
	hash = hex.EncodeToString(digest[:])
	prefix = token[:12]
	return token, hash, prefix, nil
}

func hashAPIKey(token string) string {
	digest := sha256.Sum256([]byte(token))
	return hex.EncodeToString(digest[:])
}

func apiKeyFromRequest(r *http.Request) string {
	if token := strings.TrimSpace(r.Header.Get("X-API-Key")); token != "" {
		return token
	}
	authorization := strings.TrimSpace(r.Header.Get("Authorization"))
	if strings.HasPrefix(strings.ToLower(authorization), "bearer ") {
		return strings.TrimSpace(authorization[7:])
	}
	return ""
}

func (a *authService) authenticateAPIKey(r *http.Request) (string, bool) {
	if a.apiKeys == nil {
		return "", false
	}
	token := apiKeyFromRequest(r)
	if !strings.HasPrefix(token, "sbk_") {
		return "", false
	}
	id, err := a.apiKeys.authenticate(r.Context(), hashAPIKey(token))
	return id, err == nil && id != ""
}

func handleAPIKeys(auth *authService, w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.userID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if auth.apiKeys == nil {
		http.Error(w, "API key storage is unavailable", http.StatusServiceUnavailable)
		return
	}
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/admin/api-keys":
		keys, err := auth.apiKeys.list(r.Context(), userID)
		if err != nil {
			http.Error(w, "list API keys", http.StatusInternalServerError)
			return
		}
		writeJSON(w, keys)
	case r.Method == http.MethodPost && r.URL.Path == "/admin/api-keys":
		var body struct {
			Name        string `json:"name"`
			SheetFormID string `json:"sheet_form_id"`
			CanRead     bool   `json:"can_read"`
			CanWrite    bool   `json:"can_write"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		body.Name = strings.TrimSpace(body.Name)
		if body.Name == "" || body.SheetFormID == "" {
			http.Error(w, "name and Sheet Form are required", http.StatusBadRequest)
			return
		}
		if body.CanWrite {
			body.CanRead = true
		}
		if !body.CanRead {
			http.Error(w, "choose read or read and write access", http.StatusBadRequest)
			return
		}
		token, hash, prefix, err := generateAPIKey()
		if err != nil {
			http.Error(w, "generate API key", http.StatusInternalServerError)
			return
		}
		key, err := auth.apiKeys.create(r.Context(), userID, body.Name, hash, prefix, body.SheetFormID, body.CanRead, body.CanWrite)
		if err != nil {
			http.Error(w, fmt.Sprintf("create API key: %v", err), http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		writeJSON(w, struct {
			apiKeyRecord
			Token string `json:"token"`
		}{key, token})
	case r.Method == http.MethodDelete && strings.HasPrefix(r.URL.Path, "/admin/api-keys/"):
		id := strings.TrimPrefix(r.URL.Path, "/admin/api-keys/")
		if id == "" || strings.Contains(id, "/") {
			http.NotFound(w, r)
			return
		}
		if err := auth.apiKeys.revoke(r.Context(), userID, id); err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.NotFound(w, r)
	}
}
