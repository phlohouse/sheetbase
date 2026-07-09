package main

import (
	"embed"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path"
	"strings"
)

//go:embed ui/dist/*
var uiDist embed.FS

//go:embed db/migrations/*.sql
var migrationFiles embed.FS

const defaultJWTSecret = "sheetbase-dev-secret-change-me-32-bytes-minimum"

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		return serve(args)
	}

	switch args[0] {
	case "init":
		return initApp(args[1:])
	case "serve":
		return serve(args[1:])
	case "start":
		return startApp(args[1:])
	case "stop":
		return stopApp(args[1:])
	case "restart":
		if err := stopApp(args[1:]); err != nil {
			return err
		}
		return startApp(args[1:])
	case "status":
		return statusApp(args[1:])
	case "systemd":
		return systemdApp(args[1:])
	case "help", "-h", "--help":
		printUsage()
		return nil
	default:
		return fmt.Errorf("unknown command %q\n\nRun `sheetbase help` for usage.", args[0])
	}
}

func serve(args []string) error {
	flags := flag.NewFlagSet("serve", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	addr := flags.String("addr", ":8080", "HTTP listen address")
	postgrestURL := flags.String("postgrest-url", envOrDefault("SHEETBASE_POSTGREST_URL", "http://127.0.0.1:3000"), "PostgREST URL for /api proxy")
	dbURL := flags.String("db-url", envOrDefault("SHEETBASE_DB_URL", "postgres://postgres@127.0.0.1:55432/postgres?sslmode=disable"), "PostgreSQL URL for auth; empty disables auth")
	jwtSecret := flags.String("jwt-secret", envOrDefault("SHEETBASE_JWT_SECRET", defaultJWTSecret), "JWT secret shared with PostgREST")
	if err := flags.Parse(args); err != nil {
		return err
	}

	var auth *authService
	if *dbURL != "" {
		var err error
		auth, err = newAuthService(*dbURL, *jwtSecret)
		if err != nil {
			return err
		}
	}

	handler, err := newUIHandler(*postgrestURL, auth)
	if err != nil {
		return err
	}

	slog.Info("serving Sheetbase", "addr", *addr)
	err = http.ListenAndServe(*addr, handler)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func printUsage() {
	fmt.Println(`Sheetbase

Usage:
  sheetbase init [--home DIR]
  sheetbase serve [-addr :8080] [-postgrest-url http://127.0.0.1:3000] [-db-url postgres://...]
  sheetbase start [--home DIR]
  sheetbase stop [--home DIR]
  sheetbase restart [--home DIR]
  sheetbase status [--home DIR]
  sheetbase systemd [--home DIR] [--bin /usr/local/bin/sheetbase]

Commands:
  init    Create the Sheetbase home directory and config
  serve   Serve the embedded UI
  start   Start managed PostgreSQL and PostgREST processes
  stop    Stop managed PostgreSQL and PostgREST processes
  status  Show managed process status
  systemd Print a systemd service unit
  help    Show this help`)
}

func newUIHandler(postgrestURL string, auth *authService) (http.Handler, error) {
	dist, err := fs.Sub(uiDist, "ui/dist")
	if err != nil {
		return nil, fmt.Errorf("load embedded UI: %w", err)
	}

	fileServer := http.FileServer(http.FS(dist))
	apiProxy, err := newAPIProxy(postgrestURL)
	if err != nil {
		return nil, err
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("ok\n"))
			return
		}

		if auth != nil && strings.HasPrefix(r.URL.Path, "/auth/") {
			handleAuth(auth, w, r)
			return
		}

		if r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/") {
			if auth != nil {
				userID, ok := auth.userID(r)
				if !ok {
					http.Error(w, "unauthorized", http.StatusUnauthorized)
					return
				}
				r.Header.Set("Authorization", "Bearer "+auth.jwt(userID))
			}
			apiProxy.ServeHTTP(w, r)
			return
		}

		if _, err := fs.Stat(dist, cleanAssetPath(r.URL.Path)); err == nil {
			fileServer.ServeHTTP(w, r)
			return
		}

		r.URL.Path = "/"
		fileServer.ServeHTTP(w, r)
	}), nil
}

func handleAuth(auth *authService, w http.ResponseWriter, r *http.Request) {
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/auth/setup":
		auth.handleSetup(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/auth/login":
		auth.handleLogin(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/auth/logout":
		auth.handleLogout(w, r)
	case r.Method == http.MethodGet && r.URL.Path == "/auth/me":
		auth.handleMe(w, r)
	default:
		http.NotFound(w, r)
	}
}

func newAPIProxy(rawURL string) (http.Handler, error) {
	target, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("parse PostgREST URL: %w", err)
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Director = func(r *http.Request) {
		r.URL.Scheme = target.Scheme
		r.URL.Host = target.Host
		r.URL.Path = strings.TrimPrefix(r.URL.Path, "/api")
		if r.URL.Path == "" {
			r.URL.Path = "/"
		}
		r.Host = target.Host
	}
	return proxy, nil
}

func cleanAssetPath(urlPath string) string {
	if urlPath == "" || urlPath == "/" {
		return "index.html"
	}
	return strings.TrimPrefix(path.Clean("/"+urlPath), "/")
}
