# Sheetbase

Spreadsheet-like data entry backed by real PostgreSQL tables and exposed through a PostgREST-style API.
Stencil `.stencil.yaml` configs can be imported in the UI to seed Header Row columns.

Start with [docs/plans/PLAN.md](docs/plans/PLAN.md). For deployment, see [docs/INSTALL.md](docs/INSTALL.md).

## Development

```sh
cd ui && npm install
cd ..
make serve
```

Useful commands:

- `make ui-build`: build the React UI into `ui/dist`
- `make test`: build the UI and run Go tests
- `make db-test`: run PostgreSQL schema tests in Docker
- `make api-test`: run a PostgREST integration test in Docker
- `make app-test`: run a Docker-backed app/auth/proxy integration test
- `make managed-test`: run the `sheetbase start/status/backup/stop` Docker lifecycle
- `make build`: build `bin/sheetbase`
- `make linux`: build `bin/sheetbase-linux-amd64`
- `make release`: build `bin/release/sheetbase-linux-amd64` and its SHA-256 checksum
- `go run . serve -addr :8080 -postgrest-url http://127.0.0.1:3000`: serve the embedded UI and `/api` proxy
- `go run . init --home .sheetbase`: create a local Sheetbase home
- `go run . start --home .sheetbase`: start managed PostgreSQL and PostgREST containers
- `go run . doctor --home .sheetbase`: check required external commands
- `go run . migrate --home .sheetbase`: apply embedded database migrations
- `go run . status --home .sheetbase`: show app, PostgreSQL, and PostgREST status
- `go run . stop --home .sheetbase`: stop managed containers
- `go run . backup --home .sheetbase`: write a PostgreSQL dump under `.sheetbase/backups`
- `go run . restore --home .sheetbase --in .sheetbase/backups/sheetbase-YYYYMMDDTHHMMSSZ.dump`: restore a dump
- `go run . systemd --home /var/lib/sheetbase --bin /usr/local/bin/sheetbase`: print a systemd unit

The lifecycle commands expect Docker. Postgres and PostgREST run as managed containers.
`init` writes `.sheetbase/config/sheetbase.env`; flags and environment variables override it.
When `serve` has a `-db-url`, `/api` is protected by `POST /auth/setup`,
`POST /auth/login`, `GET /auth/me`, and `POST /auth/logout`.
