#!/usr/bin/env bash
set -euo pipefail

home="$(mktemp -d)"

free_port() {
  python3 - <<'PY'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
}

postgres_port="$(free_port)"
postgrest_port="$(free_port)"

cleanup() {
  go run . stop --home "$home" --postgres-port "$postgres_port" --postgrest-port "$postgrest_port" >/dev/null 2>&1 || true
  rm -rf "$home"
}
trap cleanup EXIT

go run . init --home "$home" --postgres-port "$postgres_port" --postgrest-port "$postgrest_port" >/dev/null
go run . start --home "$home" --postgres-port "$postgres_port" --postgrest-port "$postgrest_port" >/dev/null

status="$(go run . status --home "$home" --postgres-port "$postgres_port" --postgrest-port "$postgrest_port")"
if [[ "$status" != *"postgres: running image=postgres:16-alpine"* ||
      "$status" != *"postgrest: running image=postgrest/postgrest:v12.2.8"* ||
      "$status" != *"$postgres_port"* ||
      "$status" != *"$postgrest_port"* ||
      "$status" != *"logs: $home/logs"* ]]; then
  echo "$status" >&2
  exit 1
fi

curl --fail --silent "http://127.0.0.1:${postgrest_port}/" >/dev/null

go run . restart --home "$home" --postgres-port "$postgres_port" --postgrest-port "$postgrest_port" >/dev/null
status="$(go run . status --home "$home" --postgres-port "$postgres_port" --postgrest-port "$postgrest_port")"
if [[ "$status" != *"postgres: running image=postgres:16-alpine"* ||
      "$status" != *"postgrest: running image=postgrest/postgrest:v12.2.8"* ]]; then
  echo "$status" >&2
  exit 1
fi
curl --fail --silent "http://127.0.0.1:${postgrest_port}/" >/dev/null

backup="$home/backups/test.dump"
go run . backup --home "$home" --postgres-port "$postgres_port" --out "$backup" >/dev/null
test -s "$backup"

export_archive="$home/backups/export.tar.gz"
go run . export --home "$home" --postgres-port "$postgres_port" --out "$export_archive" >/dev/null
test -s "$export_archive"
tar -tzf "$export_archive" | grep -q "postgres.dump"
tar -tzf "$export_archive" | grep -q "config/sheetbase.env"

go run . stop --home "$home" --postgres-port "$postgres_port" --postgrest-port "$postgrest_port" >/dev/null

status="$(go run . status --home "$home" --postgres-port "$postgres_port" --postgrest-port "$postgrest_port")"
if [[ "$status" != *"postgres: stopped"* || "$status" != *"postgrest: stopped"* ]]; then
  echo "$status" >&2
  exit 1
fi

echo "Sheetbase managed Docker test passed"
