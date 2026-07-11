# CLI Reference

Sheetbase is a single binary that manages its own PostgreSQL and PostgREST runtime, serves a React UI, and proxies a PostgREST-style API.

## Global Flags

All commands accept these flags. Flags override the config file (`<home>/config/sheetbase.env`), and environment variables override flags.

| Flag | Env var | Default | Description |
|------|--------|--------|-------------|
| `--home` | `SHEETBASE_HOME` | `~/.sheetbase` | Sheetbase home directory |
| `-addr` | `SHEETBASE_ADDR` | `:8080` | HTTP listen address |
| `--postgres-port` | `SHEETBASE_POSTGRES_PORT` | `55432` | Managed PostgreSQL port |
| `--postgrest-port` | `SHEETBASE_POSTGREST_PORT` | `3000` | Managed PostgREST port |
| `--jwt-secret` | `SHEETBASE_JWT_SECRET` | generated on `init` | Shared JWT secret for PostgREST |
| `--postgrest-url` | `SHEETBASE_POSTGREST_URL` | `http://127.0.0.1:<postgrest-port>` | PostgREST URL for `/api` proxy |
| `--db-url` | `SHEETBASE_DB_URL` | `postgres://postgres:postgres@127.0.0.1:<postgres-port>/postgres?sslmode=disable` | PostgreSQL URL for auth |
| `--runtime` | `SHEETBASE_RUNTIME` | `native` | Runtime mode: `native` or `docker` |

Precedence: command-line flag > environment variable > config file > built-in default.

## Commands

### `init`

```sh
sheetbase init [--home DIR]
```

Create the Sheetbase home directory structure, generate a secure JWT secret, and write `config/sheetbase.env` and `config/postgrest.conf`. Run this once before `start` or `serve`.

### `serve`

```sh
sheetbase serve [--home DIR] [-addr :8080]
```

Serve the embedded React UI and the `/api` and `/internal` PostgREST proxies. Requires that PostgreSQL and PostgREST are already running (use `start` or `up` first). Refuses to start with the development JWT secret.

### `run`

```sh
sheetbase run [--home DIR] [-addr :8080]
```

Start managed services (PostgreSQL + PostgREST) and then serve the UI in the foreground. Equivalent to `start` followed by `serve`.

### `up`

```sh
sheetbase up [--home DIR] [-addr :8080]
```

Start PostgreSQL, PostgREST, and the Sheetbase web server in the background. If services are already running and healthy, reports that and exits. If the web server is running but unhealthy, restarts it.

### `down`

```sh
sheetbase down [--home DIR]
```

Stop the background web server, PostgreSQL, and PostgREST.

### `start`

```sh
sheetbase start [--home DIR]
```

Install the native runtime if missing, start PostgreSQL, apply migrations, write the PostgREST config, and start PostgREST. Does not serve the web UI.

### `stop`

```sh
sheetbase stop [--home DIR]
```

Stop managed PostgreSQL and PostgREST processes.

### `restart`

```sh
sheetbase restart [--home DIR]
```

Restart PostgreSQL and PostgREST. When Sheetbase is running through `up`, restart the background web server as well so all three processes use the current executable.

### `migrate`

```sh
sheetbase migrate [--home DIR]
```

Apply embedded database migrations in order. Idempotent — safe to run repeatedly.

### `upgrade`

```sh
sheetbase upgrade [--home DIR]
```

Alias for `migrate`. Apply migrations during an upgrade.

### `runtime install`

```sh
sheetbase runtime install [--home DIR]
```

Download and extract pinned PostgreSQL 16.14 and PostgREST 14.14 binaries into `<home>/runtime`. Verifies SHA-256 checksums. On macOS, PostgreSQL comes from EDB; on Linux, from PGDG DEB or RPM repositories. PostgREST comes from its official GitHub release.

### `runtime update`

```sh
sheetbase runtime update [--home DIR]
```

Reinstall the pinned runtime versions, replacing existing binaries.

### `doctor`

```sh
sheetbase doctor [--home DIR]
```

Check that the managed runtime is available. In native mode, verifies that PostgreSQL and PostgREST binaries are installed. In Docker mode, checks that the Docker daemon is reachable.

### `status`

```sh
sheetbase status [--home DIR]
```

Print the status of the Sheetbase web server, PostgreSQL, and PostgREST, including PIDs, versions, and ports.

### `backup`

```sh
sheetbase backup [--home DIR] [--out FILE]
```

Write a PostgreSQL custom-format dump. Defaults to `<home>/backups/sheetbase-YYYYMMDDTHHMMSSZ.dump`.

### `export`

```sh
sheetbase export [--home DIR] [--out FILE]
```

Write a `.tar.gz` archive containing `config/sheetbase.env`, `config/postgrest.conf`, and `postgres.dump`. Defaults to `<home>/backups/sheetbase-export-YYYYMMDDTHHMMSSZ.tar.gz`.

### `restore`

```sh
sheetbase restore [--home DIR] --in FILE
```

Restore a PostgreSQL custom-format dump. Uses `pg_restore --clean --if-exists --no-owner`.

### `systemd`

```sh
sheetbase systemd [--home DIR] [--bin /usr/local/bin/sheetbase] [-addr :8080]
```

Print a systemd service unit that runs `sheetbase run` and stops with `sheetbase stop`. Pipe the output to a file and copy it to `/etc/systemd/system/`.

### `help`

```sh
sheetbase help
sheetbase -h
sheetbase --help
```

Print usage information.

## Home Directory Layout

```
<home>/
├── backups/              # backup and export files
├── config/
│   ├── sheetbase.env     # Sheetbase configuration (flags, ports, JWT secret)
│   └── postgrest.conf    # generated PostgREST configuration
├── data/
│   └── postgres/         # PostgreSQL data directory
├── logs/
│   ├── sheetbase.log     # app structured log
│   ├── sheetbase-server.log  # background web server stdout/stderr
│   ├── postgres.log      # PostgreSQL log
│   └── postgrest.log     # PostgREST log
├── run/
│   ├── postgres.pid      # PostgreSQL PID file
│   ├── postgrest.pid     # PostgREST PID file
│   ├── sheetbase.pid     # background web server PID file
│   └── lifecycle.lock    # process lock for lifecycle commands
└── runtime/
    ├── downloads/        # cached download artifacts
    ├── postgres/16.14/   # extracted PostgreSQL binaries
    └── postgrest/14.14/  # extracted PostgREST binary
```

## Runtime Modes

### Native (default)

Downloads pinned PostgreSQL and PostgREST binaries directly into `<home>/runtime`. The binary manages the processes directly via PID files. No Docker required.

**macOS**: PostgreSQL from EDB binaries, PostgREST from GitHub releases.

**Linux**: PostgreSQL from PGDG DEB (Debian/Ubuntu) or RPM (RHEL/Rocky/Alma) repositories, PostgREST from GitHub releases. Requires `dpkg-deb` or `rpm2cpio` + `cpio` for extraction.

### Docker (legacy)

Use `--runtime docker` or `SHEETBASE_RUNTIME=docker`. Runs PostgreSQL 16 and PostgREST in Docker containers. Requires a running Docker daemon.

## Configuration

`init` writes `<home>/config/sheetbase.env` with the resolved configuration. Subsequent commands read this file unless flags or environment variables override it. The JWT secret is generated randomly on first `init` and persisted.

```sh
# Example sheetbase.env
SHEETBASE_ADDR=:8080
SHEETBASE_POSTGRES_PORT=55432
SHEETBASE_POSTGREST_PORT=3000
SHEETBASE_JWT_SECRET=<random 48-byte base64>
SHEETBASE_RUNTIME=native
SHEETBASE_POSTGREST_URL=
SHEETBASE_DB_URL=
```
