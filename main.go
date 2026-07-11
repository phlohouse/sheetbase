package main

import (
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path"
	"strings"
	"time"
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
	case "run":
		return runManagedApp(args[1:])
	case "up":
		return upApp(args[1:])
	case "down":
		return downApp(args[1:])
	case "start":
		return startApp(args[1:])
	case "stop":
		return stopApp(args[1:])
	case "restart":
		return restartApp(args[1:])
	case "migrate":
		return migrateApp(args[1:])
	case "upgrade":
		return migrateApp(args[1:])
	case "runtime":
		if len(args) < 2 || (args[1] != "install" && args[1] != "update") {
			return errors.New("usage: sheetbase runtime install [--home DIR]")
		}
		return installRuntimeApp(args[2:])
	case "doctor":
		return doctorApp(args[1:])
	case "status":
		return statusApp(args[1:])
	case "systemd":
		return systemdApp(args[1:])
	case "backup":
		return backupApp(args[1:])
	case "export":
		return exportApp(args[1:])
	case "restore":
		return restoreApp(args[1:])
	case "help", "-h", "--help":
		printUsage()
		return nil
	default:
		return fmt.Errorf("unknown command %q\n\nRun `sheetbase help` for usage.", args[0])
	}
}

func serve(args []string) error {
	cfg, err := parseServeConfig(args)
	if err != nil {
		return err
	}
	if cfg.dbURL != "" && cfg.jwtSecret == defaultJWTSecret {
		return errors.New("refusing to serve with the development JWT secret; run `sheetbase init` or `sheetbase start` first")
	}
	if err := setupAppLogging(newAppPaths(cfg.home)); err != nil {
		return err
	}

	var auth *authService
	if cfg.dbURL != "" {
		auth, err = newAuthService(cfg.dbURL, cfg.jwtSecret)
		if err != nil {
			return err
		}
	}

	handler, err := newUIHandler(cfg.postgrestURL, auth)
	if err != nil {
		return err
	}
	handler = withExportDownload(handler, newAppPaths(cfg.home), auth)

	slog.Info("serving Sheetbase", "addr", cfg.appAddr)
	err = http.ListenAndServe(cfg.appAddr, handler)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func withExportDownload(next http.Handler, paths appPaths, auth *authService) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/admin/export" {
			if auth != nil {
				if _, ok := auth.userID(r); !ok {
					http.Error(w, "unauthorized", http.StatusUnauthorized)
					return
				}
			}
			target, err := os.CreateTemp("", "sheetbase-export-*.tar.gz")
			if err != nil {
				http.Error(w, "create export", http.StatusInternalServerError)
				return
			}
			_ = target.Close()
			defer os.Remove(target.Name())
			cfg, configErr := parseAppConfig("export", []string{"--home", paths.home})
			if configErr != nil {
				http.Error(w, configErr.Error(), http.StatusInternalServerError)
				return
			}
			if err := exportToFile(paths, cfg, target.Name()); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Disposition", `attachment; filename="sheetbase-export.tar.gz"`)
			http.ServeFile(w, r, target.Name())
			return
		}
		next.ServeHTTP(w, r)
	})
}

func parseServeConfig(args []string) (appConfig, error) {
	cfg, err := parseAppConfig("serve", args)
	if err != nil {
		return appConfig{}, err
	}
	if cfg.postgrestURL == "" {
		cfg.postgrestURL = "http://127.0.0.1:" + cfg.postgrestPort
	}
	if cfg.dbURL == "" && !hasFlag(args, "db-url") {
		cfg.dbURL = "postgres://postgres:postgres@127.0.0.1:" + cfg.postgresPort + "/postgres?sslmode=disable"
	}
	return cfg, nil
}

func setupAppLogging(paths appPaths) error {
	if err := os.MkdirAll(paths.logs, 0o755); err != nil {
		return err
	}
	file, err := os.OpenFile(paths.appLog, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(file, nil)))
	return nil
}

func beginCommandLog(command string, paths appPaths) func(*error) {
	slog.Info("command started", "command", command, "home", paths.home)
	return func(err *error) {
		if err != nil && *err != nil {
			slog.Error("command failed", "command", command, "home", paths.home, "error", (*err).Error())
			return
		}
		slog.Info("command completed", "command", command, "home", paths.home)
	}
}

func hasFlag(args []string, name string) bool {
	for _, arg := range args {
		if arg == "-"+name || arg == "--"+name || strings.HasPrefix(arg, "-"+name+"=") || strings.HasPrefix(arg, "--"+name+"=") {
			return true
		}
	}
	return false
}

func printUsage() {
	fmt.Println(`Sheetbase

Usage:
  sheetbase init [--home DIR]
  sheetbase serve [--home DIR] [-addr :8080] [-postgrest-url http://127.0.0.1:3000] [-db-url postgres://...]
  sheetbase run [--home DIR] [-addr :8080]
  sheetbase up [--home DIR] [-addr :8080]
  sheetbase down [--home DIR]
  sheetbase start [--home DIR]
  sheetbase stop [--home DIR]
  sheetbase restart [--home DIR]
  sheetbase migrate [--home DIR]
  sheetbase upgrade [--home DIR]
  sheetbase runtime install [--home DIR]
  sheetbase doctor [--home DIR]
  sheetbase status [--home DIR]
  sheetbase backup [--home DIR] [--out FILE]
  sheetbase export [--home DIR] [--out FILE]
  sheetbase restore [--home DIR] --in FILE
  sheetbase systemd [--home DIR] [--bin /usr/local/bin/sheetbase]

Commands:
  init    Create the Sheetbase home directory and config
  serve   Serve the embedded UI
  run     Start managed services and serve the UI
  up      Start PostgreSQL, PostgREST, and Sheetbase in the background
  down    Stop all three background services
  start   Start managed PostgreSQL and PostgREST processes
  stop    Stop managed PostgreSQL and PostgREST processes
  migrate Apply embedded database migrations
  upgrade Apply embedded database migrations
  runtime Download verified PostgreSQL and PostgREST binaries
  doctor  Check managed runtime requirements
  status  Show managed process status
  backup  Write a PostgreSQL custom-format dump
  export  Write app metadata and a PostgreSQL dump to a tar.gz archive
  restore Restore a PostgreSQL custom-format dump
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
		logged := strings.HasPrefix(r.URL.Path, "/api") || strings.HasPrefix(r.URL.Path, "/internal") || strings.HasPrefix(r.URL.Path, "/auth/") || strings.HasPrefix(r.URL.Path, "/admin/")
		recorder := &responseLogWriter{ResponseWriter: w, status: http.StatusOK}
		if logged {
			defer func(start time.Time) {
				slog.Info("http request",
					"method", r.Method,
					"path", r.URL.Path,
					"status", recorder.status,
					"duration_ms", time.Since(start).Milliseconds(),
				)
			}(time.Now())
			w = recorder
		}

		if r.URL.Path == "/healthz" {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("ok\n"))
			return
		}

		if auth != nil && strings.HasPrefix(r.URL.Path, "/auth/") {
			handleAuth(auth, w, r)
			return
		}
		if auth != nil && strings.HasPrefix(r.URL.Path, "/admin/api-keys") {
			handleAPIKeys(auth, w, r)
			return
		}
		if auth != nil && r.Method == http.MethodGet && r.URL.Path == "/internal/events" {
			handleChangeEvents(auth, w, r)
			return
		}

		if r.URL.Path == "/internal" || strings.HasPrefix(r.URL.Path, "/internal/") {
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

		if r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/") {
			if auth == nil {
				http.Error(w, "API key authentication is unavailable", http.StatusServiceUnavailable)
				return
			}
			active, err := auth.apiKeys.hasActive(r.Context())
			if err != nil {
				http.Error(w, "API key authentication is unavailable", http.StatusServiceUnavailable)
				return
			}
			jwt := auth.publicAPIJWT()
			if active {
				apiKeyID, ok := auth.authenticateAPIKey(r)
				if !ok {
					http.Error(w, "invalid or missing API key", http.StatusUnauthorized)
					return
				}
				jwt = auth.apiKeyJWT(apiKeyID)
			}
			r.Header.Del("X-API-Key")
			r.Header.Del("Cookie")
			r.Header.Set("Authorization", "Bearer "+jwt)
			if auth.sheetForms != nil {
				slug := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/"), "/")
				if slug != "" && !strings.Contains(slug, "/") && !isPublicMetadataResource(slug) {
					table, resolveErr := auth.sheetForms.tableNameBySlug(r.Context(), slug)
					if resolveErr != nil {
						if errors.Is(resolveErr, sql.ErrNoRows) {
							http.NotFound(w, r)
							return
						}
						http.Error(w, "API route is unavailable", http.StatusServiceUnavailable)
						return
					}
					r.URL.Path = "/api/" + table
				}
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

func isPublicMetadataResource(resource string) bool {
	switch resource {
	case "sheet_forms", "sheet_fields", "sheet_views":
		return true
	default:
		return false
	}
}

type responseLogWriter struct {
	http.ResponseWriter
	status int
}

func (w *responseLogWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *responseLogWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
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
		r.URL.Path = strings.TrimPrefix(r.URL.Path, "/internal")
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
