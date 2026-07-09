# Sheetbase

Spreadsheet-like data entry backed by real PostgreSQL tables and exposed through a PostgREST-style API.
Stencil `.stencil.yaml` configs can be imported in the UI to seed Header Row columns.

Start with [docs/plans/PLAN.md](docs/plans/PLAN.md).

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
- `make build`: build `bin/sheetbase`
- `go run . serve -addr :8080`: serve the embedded UI
- `go run . init --home .sheetbase`: create a local Sheetbase home
- `go run . start --home .sheetbase`: start managed PostgreSQL and PostgREST processes
- `go run . status --home .sheetbase`: show managed process status
- `go run . stop --home .sheetbase`: stop managed processes

The lifecycle commands expect `initdb`, `pg_ctl`, and `psql` on `PATH` or via
`--postgres-bin`, and `postgrest` on `PATH` or via `--postgrest-bin`.
