# Use Sheetbase

## First Run

```sh
sheetbase init --home /var/lib/sheetbase
sheetbase start --home /var/lib/sheetbase
sheetbase serve --home /var/lib/sheetbase -addr :8080
```

Open `http://SERVER:8080` and create the first admin user.

## Create A Sheet Form

1. Click `New form`.
2. Name the Sheet Form.
3. Type field names into the Header Row.
4. Type records into the cells.
5. Click `Save`.

Sheetbase creates one PostgreSQL table for the Sheet Form and stores rows there.

## Change Fields

- Add a field with `Add column`, then save.
- Hide a field with the header hide button. Data stays in PostgreSQL.
- Change a saved field type with the header type selector. Sheetbase rejects unsafe conversions.
- Import a `.stencil.yaml` config to seed Header Row fields without importing workbook data.

## Use The API

The UI shows the generated endpoint for the active Sheet Form, for example:

```txt
/api/companies
```

Create an API key from the saved Sheet Form's API panel, then send it with each request:

```sh
curl -H "X-API-Key: $SHEETBASE_API_KEY" 'http://SERVER:8080/api/sheet_forms?select=name,generated_table_name'
curl -H "X-API-Key: $SHEETBASE_API_KEY" 'http://SERVER:8080/api/companies?select=*&limit=20'
curl -H "X-API-Key: $SHEETBASE_API_KEY" 'http://SERVER:8080/api/companies?company=eq.Acme%20Labs'
```

API keys are independent from Sheetbase sign-in, stored as hashes, and can cover selected datasets or all current and future datasets. Revoking a key takes effect on its next request without signing anyone out of Sheetbase. The `/api` paths are proxied to PostgREST, so standard PostgREST filters, ordering, pagination, and `select` parameters apply.

Use a Sheet Form's sidebar menu to archive it, restore it from the Archived section, or permanently delete its table and metadata. A search field appears automatically in larger workspaces.

## See Also

- [API Reference](API.md) — full endpoint documentation with curl examples
- [CLI Reference](CLI.md) — every command, flag, and env var
- [Architecture](ARCHITECTURE.md) — system components, request flow, data model
- [Install Guide](INSTALL.md) — deployment, systemd, backup/restore
