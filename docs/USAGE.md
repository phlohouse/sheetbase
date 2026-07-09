# Use Sheetbase

## First Run

```sh
sheetbase init --home /var/lib/sheetbase
sheetbase start --home /var/lib/sheetbase
sheetbase serve -addr :8080
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

- Add a field with the `+` button in the filter bar, then save.
- Hide a field with the header hide button. Data stays in PostgreSQL.
- Change a saved field type with the header type selector. Sheetbase rejects unsafe conversions.
- Import a `.stencil.yaml` config to seed Header Row fields without importing workbook data.

## Use The API

The UI shows the generated endpoint for the active Sheet Form, for example:

```txt
/api/sheet_companies
```

Use the browser session cookie or an authenticated client request against the same app server:

```sh
curl --cookie cookies.txt 'http://SERVER:8080/api/sheet_forms?select=name,generated_table_name'
curl --cookie cookies.txt 'http://SERVER:8080/api/sheet_companies?select=*&limit=20'
curl --cookie cookies.txt 'http://SERVER:8080/api/sheet_companies?company=eq.Acme%20Labs'
```

The `/api` paths are proxied to PostgREST, so standard PostgREST filters, ordering, pagination, and `select` parameters apply.
