# Sheetbase

Spreadsheet-like data entry backed by real PostgreSQL tables and exposed through a PostgREST-style API.

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
