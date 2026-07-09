package main

import (
	"context"
	"crypto/hmac"
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
	"sync"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"golang.org/x/crypto/bcrypt"
)

type authService struct {
	store     userStore
	jwtSecret string
	sessions  map[string]sessionRecord
	mu        sync.Mutex
}

type sessionRecord struct {
	userID  string
	expires time.Time
}

type userStore interface {
	createFirstUser(ctx context.Context, email, passwordHash string) (string, error)
	userByEmail(ctx context.Context, email string) (userRecord, error)
}

type userRecord struct {
	ID           string
	Email        string
	PasswordHash string
}

func newAuthService(dbURL, jwtSecret string) (*authService, error) {
	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		return nil, fmt.Errorf("open auth database: %w", err)
	}
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("connect auth database: %w", err)
	}
	return &authService{store: sqlUserStore{db: db}, jwtSecret: jwtSecret, sessions: map[string]sessionRecord{}}, nil
}

func (a *authService) handleSetup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	email := strings.TrimSpace(strings.ToLower(body.Email))
	if email == "" || len(body.Password) < 8 {
		http.Error(w, "email and 8 character password required", http.StatusBadRequest)
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, "hash password", http.StatusInternalServerError)
		return
	}
	id, err := a.store.createFirstUser(r.Context(), email, string(hash))
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	a.setSession(w, id)
	writeJSON(w, map[string]string{"email": email})
}

func (a *authService) handleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	user, err := a.store.userByEmail(r.Context(), strings.TrimSpace(strings.ToLower(body.Email)))
	if err != nil || bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(body.Password)) != nil {
		http.Error(w, "invalid email or password", http.StatusUnauthorized)
		return
	}
	a.setSession(w, user.ID)
	writeJSON(w, map[string]string{"email": user.Email})
}

func (a *authService) handleLogout(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("sheetbase_session")
	if err == nil {
		a.mu.Lock()
		delete(a.sessions, cookie.Value)
		a.mu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: "sheetbase_session", Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	w.WriteHeader(http.StatusNoContent)
}

func (a *authService) handleMe(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.userID(r); !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	writeJSON(w, map[string]bool{"authenticated": true})
}

func (a *authService) userID(r *http.Request) (string, bool) {
	cookie, err := r.Cookie("sheetbase_session")
	if err != nil {
		return "", false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	session, ok := a.sessions[cookie.Value]
	if !ok {
		return "", false
	}
	if time.Now().After(session.expires) {
		delete(a.sessions, cookie.Value)
		return "", false
	}
	return session.userID, true
}

func (a *authService) setSession(w http.ResponseWriter, userID string) {
	token := randomToken()
	expires := time.Now().Add(24 * time.Hour)
	a.mu.Lock()
	a.sessions[token] = sessionRecord{userID: userID, expires: expires}
	a.mu.Unlock()
	http.SetCookie(w, &http.Cookie{
		Name:     "sheetbase_session",
		Value:    token,
		Path:     "/",
		Expires:  expires,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func randomToken() string {
	var bytes [32]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(bytes[:])
}

func (a *authService) jwt(userID string) string {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payload, _ := json.Marshal(map[string]any{
		"sub":  userID,
		"role": "sheetbase_api",
		"exp":  time.Now().Add(15 * time.Minute).Unix(),
	})
	unsigned := header + "." + base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, []byte(a.jwtSecret))
	_, _ = mac.Write([]byte(unsigned))
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}

type sqlUserStore struct {
	db *sql.DB
}

func (s sqlUserStore) createFirstUser(ctx context.Context, email, passwordHash string) (string, error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{})
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	var exists bool
	if err := tx.QueryRowContext(ctx, "select exists (select 1 from users)").Scan(&exists); err != nil {
		return "", err
	}
	if exists {
		return "", errors.New("admin user already exists")
	}

	var id string
	if err := tx.QueryRowContext(ctx, "insert into users (email, password_hash) values ($1, $2) returning id", email, passwordHash).Scan(&id); err != nil {
		return "", err
	}
	return id, tx.Commit()
}

func (s sqlUserStore) userByEmail(ctx context.Context, email string) (userRecord, error) {
	var user userRecord
	err := s.db.QueryRowContext(ctx, "select id, email, password_hash from users where email = $1", email).Scan(&user.ID, &user.Email, &user.PasswordHash)
	return user, err
}
