# API Reference

Sheetbase exposes a PostgREST-style API at `/api/*` for programmatic access and a private `/internal/*` proxy for the browser UI. Both are reverse-proxied to PostgREST with an injected JWT.

## Authentication

### Admin Session Endpoints

These endpoints manage browser sessions for the Sheetbase UI. They are not used for API access.

#### `POST /auth/setup`

Create the first admin user. Only works if no users exist yet.

```sh
curl -X POST http://localhost:8080/auth/setup \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"secure-password"}'
```

Response: `200 OK`
```json
{"email": "admin@example.com"}
```

Sets a `sheetbase_session` cookie (24h expiry, HttpOnly, SameSite=Lax).

Returns `409 Conflict` if an admin user already exists.

#### `POST /auth/login`

Sign in an existing user.

```sh
curl -X POST http://localhost:8080/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"secure-password"}'
```

Response: `200 OK`
```json
{"email": "admin@example.com"}
```

Sets a `sheetbase_session` cookie. Returns `401 Unauthorized` on invalid credentials.

#### `POST /auth/logout`

Sign out and revoke the current session.

```sh
curl -X POST http://localhost:8080/auth/logout \
  -b 'sheetbase_session=...'
```

Response: `204 No Content`. Clears the session cookie.

#### `GET /auth/me`

Check if the current session is valid.

```sh
curl http://localhost:8080/auth/me \
  -b 'sheetbase_session=...'
```

Response: `200 OK`
```json
{"authenticated": true}
```

Returns `401 Unauthorized` if not authenticated.

### API Key Management

All endpoints require a valid `sheetbase_session` cookie.

#### `GET /admin/api-keys`

List all API keys for Sheet Forms the current user administers.

```sh
curl http://localhost:8080/admin/api-keys \
  -b 'sheetbase_session=...'
```

Response: `200 OK`
```json
[
  {
    "id": "uuid",
    "name": "Production read-only",
    "token_prefix": "sbk_abcdef12",
    "sheet_form_id": "uuid",
    "sheet_form_name": "Companies",
    "can_read": true,
    "can_write": false,
    "created_at": "2025-01-01T00:00:00Z",
    "last_used_at": "2025-01-02T12:00:00Z",
    "revoked_at": null
  }
]
```

#### `POST /admin/api-keys`

Create a new API key. The full token is returned only once.

```sh
curl -X POST http://localhost:8080/admin/api-keys \
  -H 'Content-Type: application/json' \
  -b 'sheetbase_session=...' \
  -d '{
    "name": "Production read-only",
    "sheet_form_id": "uuid",
    "can_read": true,
    "can_write": false
  }'
```

Response: `201 Created`
```json
{
  "id": "uuid",
  "name": "Production read-only",
  "token_prefix": "sbk_abcdef12",
  "sheet_form_id": "uuid",
  "sheet_form_name": "Companies",
  "can_read": true,
  "can_write": false,
  "created_at": "2025-01-01T00:00:00Z",
  "last_used_at": null,
  "revoked_at": null,
  "token": "sbk_abcdef1234567890..."
}
```

Requires admin access to the specified Sheet Form. If `can_write` is true, `can_read` is forced to true.

#### `DELETE /admin/api-keys/:id`

Revoke an API key. Takes effect on the next API request.

```sh
curl -X DELETE http://localhost:8080/admin/api-keys/uuid \
  -b 'sheetbase_session=...'
```

Response: `204 No Content`. Returns `404 Not Found` if the key does not exist or is already revoked.

## Data API (`/api/*`)

Public API requests require a scoped API key. Send it in either header:

```
X-API-Key: sbk_abcdef1234567890...
```

or

```
Authorization: Bearer sbk_abcdef1234567890...
```

Sheetbase cookies are ignored on `/api` routes. The key is validated, a short-lived JWT is issued, and the request is proxied to PostgREST with standard PostgREST query syntax.

### Querying Generated Tables

Generated Tables are named after the Sheet Form's slug (e.g., `sheet_companies`):

```sh
# List all rows
curl -H "X-API-Key: $KEY" 'http://localhost:8080/api/sheet_companies'

# Select specific columns
curl -H "X-API-Key: $KEY" 'http://localhost:8080/api/sheet_companies?select=name,website'

# Filter
curl -H "X-API-Key: $KEY" 'http://localhost:8080/api/sheet_companies?name=eq.Acme%20Labs'

# Paginate
curl -H "X-API-Key: $KEY" 'http://localhost:8080/api/sheet_companies?limit=20&offset=40'

# Order
curl -H "X-API-Key: $KEY" 'http://localhost:8080/api/sheet_companies?order=created_at.desc'
```

### Querying Control Tables

Sheet Form metadata is also available through the API:

```sh
# List Sheet Forms
curl -H "X-API-Key: $KEY" 'http://localhost:8080/api/sheet_forms?select=id,name,slug,generated_table_name'

# List fields for a Sheet Form
curl -H "X-API-Key: $KEY" 'http://localhost:8080/api/sheet_fields?sheet_form_id=eq.uuid'
```

### RPC (Database Functions)

Schema-changing operations are exposed as PostgREST RPC endpoints:

```sh
# Create a Sheet Form
curl -X POST http://localhost:8080/api/rpc/create_sheet_form \
  -H "X-API-Key: $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Companies","headers":["Name","Website","Employees"]}'

# Add a field
curl -X POST http://localhost:8080/api/rpc/add_sheet_field \
  -H "X-API-Key: $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"sheet_form_id":"uuid","name":"Revenue"}'

# Tighten a field type
curl -X POST http://localhost:8080/api/rpc/tighten_sheet_field_type \
  -H "X-API-Key: $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"sheet_form_id":"uuid","field_id":"uuid","target_type":"integer"}'
```

### Inserting and Updating Rows

```sh
# Insert a row
curl -X POST http://localhost:8080/api/sheet_companies \
  -H "X-API-Key: $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Acme Labs","website":"https://acme.example.com","employees":"50"}'

# Update a row
curl -X PATCH http://localhost:8080/api/sheet_companies?id=eq.uuid \
  -H "X-API-Key: $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"employees":"51"}'

# Delete a row (requires write access)
curl -X DELETE http://localhost:8080/api/sheet_companies?id=eq.uuid \
  -H "X-API-Key: $KEY"
```

For the full PostgREST query syntax (filters, ordering, pagination, embeddings, etc.), see the [PostgREST documentation](https://postgrest.org/en/stable/api.html).

## Internal Proxy (`/internal/*`)

The `/internal/*` proxy is for the browser UI only. It uses the `sheetbase_session` cookie for authentication and injects a user JWT. This route is not intended for programmatic access and does not accept API keys.

## Health Check

```sh
curl http://localhost:8080/healthz
```

Response: `200 OK` — body is `ok\n`. No authentication required.

## Admin Export

```sh
curl -OJ http://localhost:8080/admin/export \
  -b 'sheetbase_session=...'
```

Downloads a `sheetbase-export.tar.gz` containing the Sheetbase config and PostgreSQL dump. Requires a valid session cookie.

## Response Format

All data API responses use standard PostgREST conventions:

- `GET` returns a JSON array (or single object with `Prefer: return=representation`)
- `POST` returns `201 Created` (or the created object with `Prefer: return=representation`)
- `PATCH` returns `204 No Content` (or the updated object with `Prefer: return=representation`)
- `DELETE` returns `204 No Content`
- Error responses follow PostgREST's JSON error format with `code`, `message`, and `details`

## Rate Limiting and Security

- API keys are scoped to a single Sheet Form
- Read keys can only `GET`; write keys can `GET`, `POST`, `PATCH`, and `DELETE`
- The `sheetbase_api` role has `SELECT`, `INSERT`, `UPDATE`, `DELETE` on Generated Tables only
- RLS policies are enforced on every query — a key cannot access Sheet Forms it is not scoped to
- Users and roles tables are not exposed to `sheetbase_api`
- The JWT secret is generated on `init` and stored in `config/sheetbase.env` with `0600` permissions
