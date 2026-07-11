# Sheetbase

Spreadsheet-like data entry backed by real PostgreSQL tables and exposed through a PostgREST-style API.

Define fields in a Header Row, type records into cells, and immediately have a database-backed resource with a full REST API. No spreadsheets to upload, no custom app to build.

## Quick Start

```sh
cd ui && npm install
cd ..
make serve
```

`make serve` uses `.sheetbase` in the repository as its development home. On first use it downloads pinned PostgreSQL 16.14 and PostgREST 14.14 binaries, starts them, applies migrations, then serves the app at `http://127.0.0.1:8080`. Override ports with `SHEETBASE_DEV_POSTGRES_PORT` and `SHEETBASE_DEV_POSTGREST_PORT`.

Open the app, create the first admin user, then create a Sheet Form.

## Documentation

| Document | Description |
|----------|-------------|
| [docs/INSTALL.md](docs/INSTALL.md) | Deployment guide — build, install, systemd, backup/restore |
| [docs/USAGE.md](docs/USAGE.md) | First use — creating Sheet Forms, entering data, using the API |
| [docs/CLI.md](docs/CLI.md) | Full CLI reference — every command, flag, and env var |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture — components, request flow, data model, auth |
| [docs/API.md](docs/API.md) | API reference — auth endpoints, API keys, PostgREST query syntax |
| [docs/plans/PLAN.md](docs/plans/PLAN.md) | Product plan and architecture decisions |
| [docs/plans/SPEC.md](docs/plans/SPEC.md) | Full specification and user stories |
| [docs/plans/ROADMAP.md](docs/plans/ROADMAP.md) | Implementation phases |
| [DESIGN.md](DESIGN.md) | UI design system — palette, typography, components |
| [PRODUCT.md](PRODUCT.md) | Product brief — users, purpose, principles |

## Development

### Make Targets

| Target | Description |
|--------|-------------|
| `make ui-build` | Build the React UI into `ui/dist` |
| `make dev-services` | Start PostgreSQL and PostgREST without the web app |
| `make serve` | Build UI, start services, serve the app at `:8080` |
| `make up` | Start PostgreSQL, PostgREST, and Sheetbase in the background |
| `make down` | Stop all three background processes |
| `make test` | Build UI and run Go tests |
| `make verify` | Run unit, Docker, app/auth, managed lifecycle, and release smoke checks |
| `make db-test` | Run PostgreSQL schema tests in Docker |
| `make api-test` | Run a PostgREST integration test in Docker |
| `make app-test` | Run a Docker-backed app/auth/proxy integration test |
| `make managed-test` | Run the legacy Docker lifecycle integration test |
| `make build` | Build `bin/sheetbase` |
| `make linux` | Cross-compile `bin/sheetbase-linux-amd64` |
| `make release` | Build release binary and SHA-256 checksum |
| `make release-smoke` | Build release binary and smoke-test its embedded UI |

### UI Smoke Tests

```sh
cd ui && npm run smoke:browser
```

Runs sign-in, Sheet Form save, and API query browser smoke tests against a running app.

## Deployment

See [docs/INSTALL.md](docs/INSTALL.md) for the full deployment guide. Quick summary:

```sh
make release                    # build bin/release/sheetbase-linux-amd64
# copy to server as /usr/local/bin/sheetbase
sheetbase runtime install --home /var/lib/sheetbase
sheetbase init --home /var/lib/sheetbase
sheetbase start --home /var/lib/sheetbase
sheetbase serve --home /var/lib/sheetbase -addr :8080
```

For systemd:

```sh
sheetbase systemd --home /var/lib/sheetbase --bin /usr/local/bin/sheetbase > sheetbase.service
sudo cp sheetbase.service /etc/systemd/system/
sudo systemctl enable --now sheetbase
```

## How It Works

Sheetbase is a single Go binary that manages three things:

1. **PostgreSQL** — stores Sheet Form metadata (Control Tables) and user data (one Generated Table per Sheet Form)
2. **PostgREST** — exposes PostgreSQL as a REST API with filtering, pagination, and RPC
3. **React UI** — an embedded spreadsheet-like interface for defining forms and entering data

The binary serves the UI, authenticates users with session cookies, issues scoped API keys, and proxies both browser and API requests to PostgREST with injected JWTs. Row Level Security in PostgreSQL enforces access control per user and per API key.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full architecture.

## Key Concepts

- **Sheet Form**: A user-created data-entry form whose columns map to a real PostgreSQL table
- **Header Row**: The first row of the UI; type column names there to define fields
- **Generated Table**: The PostgreSQL table created from a Sheet Form
- **Control Tables**: PostgreSQL tables storing Sheet Form metadata, users, permissions, and API keys
- **Type Tightening**: Converting a `text` column to a stricter type after all existing values validate
- **Stencil Config Import**: Optional `.stencil.yaml` import to seed Header Row fields from an existing schema

## Authentication

Sheetbase has two independent auth systems:

- **Admin sessions** (browser): email/password sign-in with a signed `sheetbase_session` cookie. Endpoints: `POST /auth/setup`, `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`
- **API keys** (programmatic): scoped to selected datasets or all current and future datasets, read or read+write. Send via `X-API-Key` or `Authorization: Bearer`. Manage them from the dedicated Access page.

The browser uses a private `/internal` proxy (cookie auth). Public `/api` requests require an API key; session cookies are ignored on that route.

See [docs/API.md](docs/API.md) for the full API reference.

## Runtime

Native mode is the default on macOS and Linux. PostgreSQL comes from EDB on macOS and PGDG DEB/RPM repositories on Linux. PostgREST comes from its official GitHub release. Downloads are pinned, SHA-256 verified, and cached under `<home>/runtime/downloads`.

Use `--runtime docker` or `SHEETBASE_RUNTIME=docker` for the legacy Docker container mode.

See [docs/CLI.md](docs/CLI.md) for the full CLI reference.

## Tech Stack

- **Server**: Go 1.23, single binary, embedded UI
- **Database**: PostgreSQL 16.14
- **API**: PostgREST 14.14
- **UI**: React 19, Vite 7, Tailwind CSS 4, Handsontable 18
- **Auth**: bcrypt, HMAC-SHA256 session tokens, HS256 JWTs
