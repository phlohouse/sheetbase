# Sheetbase

Spreadsheet-like data entry backed by real PostgreSQL tables and exposed through a PostgREST-style API.
Stencil `.stencil.yaml` configs can be imported in the UI to seed Header Row columns.

Start with [docs/plans/PLAN.md](docs/plans/PLAN.md). For deployment, see [docs/INSTALL.md](docs/INSTALL.md). For first use and API examples, see [docs/USAGE.md](docs/USAGE.md).

## Development

```sh
cd ui && npm install
cd ..
make serve
```

`make serve` uses `.sheetbase` in the repository as its development home. On first use it downloads pinned PostgreSQL and PostgREST binaries into `.sheetbase/runtime`, starts them on ports `55532` and `3010`, applies migrations, then serves the app at `http://127.0.0.1:8080`. Override the ports with `SHEETBASE_DEV_POSTGRES_PORT` and `SHEETBASE_DEV_POSTGREST_PORT`.

Useful commands:

- `make ui-build`: build the React UI into `ui/dist`
- `make dev-services`: start or repair the project-local PostgreSQL and PostgREST services without starting the web app
- `make up`: start PostgreSQL, PostgREST, and Sheetbase in the background
- `make down`: stop all three background processes
- `make test`: build the UI and run Go tests
- `make verify`: run unit, Docker, app/auth, managed lifecycle, and release smoke checks
- `make db-test`: run PostgreSQL schema tests in Docker
- `make api-test`: run a PostgREST integration test in Docker
- `make app-test`: run a Docker-backed app/auth/proxy integration test
- `make managed-test`: run the legacy Docker lifecycle integration test
- `cd ui && npm run smoke:browser`: run the sign-in, Sheet Form save, and API query browser smoke against a running app
- `make build`: build `bin/sheetbase`
- `make linux`: build `bin/sheetbase-linux-amd64`
- `make release`: build `bin/release/sheetbase-linux-amd64` and its SHA-256 checksum
- `make release-smoke`: build the release binary and smoke-test its embedded UI
- `go run . serve --home .sheetbase -addr :8080`: serve the embedded UI and `/api` proxy
- `go run . init --home .sheetbase`: create a local Sheetbase home
- `go run . runtime install --home .sheetbase`: download or refresh the pinned native runtime
- `go run . start --home .sheetbase`: install if needed and start native PostgreSQL and PostgREST
- `go run . up --home .sheetbase`: start PostgreSQL, PostgREST, and the web app in the background
- `go run . down --home .sheetbase`: stop all three background processes
- `go run . doctor --home .sheetbase`: check required external commands
- `go run . migrate --home .sheetbase`: apply embedded database migrations
- `go run . upgrade --home .sheetbase`: apply embedded database migrations during upgrade
- `go run . status --home .sheetbase`: show app, PostgreSQL, and PostgREST status
- `go run . stop --home .sheetbase`: stop managed processes
- `go run . backup --home .sheetbase`: write a PostgreSQL dump under `.sheetbase/backups`
- `go run . export --home .sheetbase`: write app metadata and a PostgreSQL dump under `.sheetbase/backups`
- `go run . restore --home .sheetbase --in .sheetbase/backups/sheetbase-YYYYMMDDTHHMMSSZ.dump`: restore a dump
- `go run . systemd --home /var/lib/sheetbase --bin /usr/local/bin/sheetbase`: print a systemd unit

Native mode is the default on macOS and Linux. PostgreSQL comes from EDB on macOS and official PGDG DEB/RPM repositories on Linux; PostgREST comes from its official GitHub release. Downloads are pinned and cached under `<home>/runtime/downloads`. Use `--runtime docker` or `SHEETBASE_RUNTIME=docker` for the legacy container mode.
`init` writes `.sheetbase/config/sheetbase.env`; flags and environment variables override it.
Sheetbase administration and API authentication are independent. The browser uses a private `/internal` proxy protected by the `sheetbase_session` cookie. Public `/api` requests require a scoped API key in `X-API-Key` or `Authorization: Bearer …`; Sheetbase cookies are ignored on that route. Create and revoke keys from the API panel. Admin sign-in uses `POST /auth/setup`, `POST /auth/login`, `GET /auth/me`, and `POST /auth/logout`.
