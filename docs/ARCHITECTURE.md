# Architecture

Sheetbase is a single Go binary that serves a React UI, manages a PostgreSQL database and PostgREST API sidecar, and proxies authenticated requests between them.

## Components

```
                 sheetbase binary
  +-----------------------------------------------------------+
  |                                                           |
  |  React UI        Auth service       API key store         |
  |  (embedded)      (sessions,         (create, list,        |
  |                  JWT, bcrypt)        revoke)              |
  |       |               |                  |                |
  |       v               v                  v                |
  |  +-----------------------------------------------+        |
  |  |            HTTP handler / router              |        |
  |  |  /auth/*  /admin/api-keys  /api/*  /internal/*|        |
  |  |  /healthz  /admin/export  static UI           |        |
  |  +------+------------------------+--------------+        |
  |         |                        |                        |
  |         v                        v                        |
  |  +-----------+          +---------------+                 |
  |  | PostgreSQL|<--proxy->|  PostgREST    |                 |
  |  |  16.14    |          |  14.14        |                 |
  |  | (native or|          | (native or    |                 |
  |  |  docker)  |          |  docker)      |                 |
  |  +-----------+          +---------------+                 |
  +-----------------------------------------------------------+
```

### Go Binary

The `sheetbase` binary (`main.go`) is the only deployable artifact. It:

- Serves the embedded React build (`ui/dist/`) via `embed.FS`
- Manages PostgreSQL and PostgREST as native processes or Docker containers
- Applies SQL migrations from embedded `db/migrations/*.sql`
- Authenticates admin users with bcrypt + signed session cookies
- Issues short-lived JWTs for PostgREST (user sessions and API keys)
- Proxies `/api` and `/internal` requests to PostgREST with injected JWTs
- Manages scoped API keys (create, list, revoke, authenticate)
- Provides backup, restore, export, status, and systemd generation commands

### PostgreSQL

PostgreSQL 16.14 is the system of record. It stores:

- **Control Tables** — product metadata (Sheet Forms, fields, views, users, permissions, API keys)
- **Generated Tables** — one real PostgreSQL table per Sheet Form, holding user-entered rows

Row Level Security (RLS) policies enforce per-user and per-API-key access on every table. The `sheetbase_api` role is the only role granted to PostgREST.

### PostgREST

PostgREST 14.14 exposes PostgreSQL tables and functions as a REST API. The Go binary generates `postgrest.conf` with the database URI, JWT secret, and `sheetbase_api` anon role. PostgREST auto-reloads its schema cache when notified via `pg_notify('pgrst', 'reload schema')`.

### React UI

The UI is a React 19 + Vite + Tailwind 4 app built into `ui/dist/` and embedded into the Go binary. It communicates with the Go server through `/internal` (browser session auth) and `/api` (API key auth) proxies. The UI uses Handsontable for the spreadsheet grid and follows an Attio-style design system (see [DESIGN.md](../DESIGN.md)).

## Request Flow

### Browser Session (UI)

1. User signs in via `POST /auth/login` (or `POST /auth/setup` for first-run)
2. Go server validates bcrypt hash, sets a signed `sheetbase_session` cookie (24h expiry)
3. UI sends requests to `/internal/*` with the session cookie
4. Go server validates the cookie, issues a 15-minute JWT with `kind=user`, replaces the `Authorization` header, and proxies to PostgREST
5. PostgREST validates the JWT and applies RLS policies based on `request.jwt.claim.sub`

### API Key (programmatic)

1. Admin creates an API key via `POST /admin/api-keys` (scoped to one Sheet Form, read or read+write)
2. Go server returns the full `sbk_...` token once (stored as SHA-256 hash)
3. Client sends requests to `/api/*` with `X-API-Key: sbk_...` or `Authorization: Bearer sbk_...`
4. Go server hashes the token, looks up the key ID, issues a 15-minute JWT with `kind=api_key`, strips the original key and cookie headers, and proxies to PostgREST
5. PostgREST validates the JWT and applies RLS policies based on `request.jwt.claim.sub` (the API key ID) and `request.jwt.claim.kind`

### Static Assets

Requests for files that exist in `ui/dist/` are served directly. All other paths fall through to `index.html` (SPA routing).

### Health Check

`GET /healthz` returns `200 ok` without authentication. Used by `up` and `status` for liveness checks.

## Database Schema

### Control Tables

| Table | Purpose |
|-------|---------|
| `sheet_forms` | Sheet Form metadata: id, slug, name, generated_table_name, timestamps |
| `sheet_fields` | Field definitions: id, sheet_form_id, name, column_name, type, position, hidden, timestamps |
| `sheet_views` | UI view state: frozen rows/columns, column widths, sort/filter state |
| `users` | Admin users: id, email, password_hash, timestamps |
| `roles` | Role definitions for permission assignment |
| `permissions` | Per-user/per-role access to Sheet Forms: can_read, can_write, can_admin |
| `api_keys` | API key records: name, token_hash, token_prefix, timestamps, revoked_at |
| `api_key_permissions` | API key scope: one row per key+Sheet Form with can_read, can_write |

### Generated Tables

Each Sheet Form creates one PostgreSQL table named after the form's slug (e.g., `sheet_companies`). Every Generated Table has:

- `id` UUID primary key
- `created_at` timestamptz
- `updated_at` timestamptz
- One `text` column per field (can be tightened to `integer`, `numeric`, `boolean`, `date`, or `timestamptz`)

RLS policies on Generated Tables check `can_access_sheet_table()` which delegates to `can_access_sheet_form()` with the appropriate access level (`read`, `write`, `delete`).

### Database Functions

Schema-changing operations are implemented as PostgreSQL functions exposed through PostgREST RPC:

| Function | Purpose |
|----------|---------|
| `create_sheet_form(name, headers[])` | Create a Sheet Form + Generated Table + fields + permissions in one transaction |
| `set_sheet_form_slug(id, slug)` | Rename the API slug and underlying table |
| `rename_sheet_form(id, name)` | Update the display name |
| `add_sheet_field(form_id, name)` | Add a `text` column to an existing form |
| `rename_sheet_field(form_id, field_id, name)` | Update a field's display name |
| `hide_sheet_field(form_id, field_id)` | Hide a field from the UI (data preserved) |
| `tighten_sheet_field_type(form_id, field_id, target_type)` | Convert a column type if all existing values validate |
| `update_sheet_view_widths(form_id, widths)` | Persist column widths |
| `update_sheet_view_column_order(form_id, column_order[])` | Persist column order |

All schema functions use `SECURITY DEFINER` and check `can_access_sheet_form()` for `admin` access before mutating.

### Row Level Security

Access control is enforced entirely in PostgreSQL via RLS:

- **User sessions**: `can_access_sheet_form()` checks the `permissions` table for the JWT subject (`kind=user`)
- **API keys**: `can_access_sheet_form()` checks the `api_key_permissions` table for the JWT subject (`kind=api_key`)
- The `current_sheetbase_user_id()` function extracts the subject from `request.jwt.claim.sub`
- The `current_sheetbase_principal_kind()` function extracts the principal type from `request.jwt.claim.kind`

## Authentication

### Admin Sessions

- First-run: `POST /auth/setup` creates the single admin user and sets a session cookie
- Login: `POST /auth/login` validates bcrypt hash and sets a session cookie
- Session cookies are HMAC-SHA256 signed with the JWT secret (not a JWT — a custom signed token)
- Sessions expire after 24 hours
- Logout: `POST /auth/logout` revokes the session and clears the cookie
- Status: `GET /auth/me` returns `{"authenticated": true}`

### JWT Issuance

The Go server issues HS256 JWTs for PostgREST with:

- `sub`: user ID or API key ID
- `role`: `sheetbase_api`
- `kind`: `user` or `api_key`
- `exp`: 15 minutes from issuance

JWTs are generated per-request for `/internal` and `/api` proxy paths. They are not stored or reused.

### API Keys

- Token format: `sbk_` + 32 random bytes base64url-encoded
- Storage: SHA-256 hash only (the full token is returned once at creation)
- Scope: one Sheet Form per key, with `can_read` or `can_read + can_write`
- Authentication: `X-API-Key` header or `Authorization: Bearer` header
- Revocation: `DELETE /admin/api-keys/:id` sets `revoked_at`; takes effect on the next request
- API keys are independent from admin sessions — revoking a key does not sign anyone out of the UI

## Process Management

### Native Mode

The binary manages PostgreSQL and PostgREST as detached processes with PID files:

- `initdb` initializes the data directory on first run
- `postgres` starts with `-h 127.0.0.1 -p <port>`
- `postgrest` starts with the generated config file
- `pg_isready` polls for PostgreSQL readiness
- PostgREST readiness is checked via its OpenAPI endpoint
- `LD_LIBRARY_PATH` is set on Linux to resolve shared libraries from the extracted packages

### Docker Mode

The binary runs PostgreSQL 16 Alpine and PostgREST in Docker containers on a private network. Container names are derived from a hash of the home directory path.

### Lifecycle Lock

`up` and `down` acquire a file lock (`<home>/run/lifecycle.lock`) to prevent concurrent lifecycle commands.

## Migrations

SQL migrations are embedded in the binary at `db/migrations/*.sql` and applied in filename order via `psql -v ON_ERROR_STOP=1`. Migrations are idempotent (`create table if not exists`, `drop ... if exists`, `create or replace function`). There is no migration tracking table — running `migrate` or `upgrade` re-executes all migrations safely.

## Logging

The Go server writes structured logs (`slog` text format) to `<home>/logs/sheetbase.log`. HTTP requests to `/api`, `/internal`, `/auth/`, and `/admin/` are logged with method, path, status, and duration. Lifecycle commands log start and completion with the command name and home path.
