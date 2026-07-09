#!/usr/bin/env bash
set -euo pipefail

network="sheetbase-app-test-$$"
postgres="sheetbase-postgres-app-test-$$"
postgrest="sheetbase-postgrest-app-test-$$"

cleanup() {
  if [[ -n "${app_pid:-}" ]]; then
    kill "$app_pid" >/dev/null 2>&1 || true
    wait "$app_pid" >/dev/null 2>&1 || true
  fi
  docker rm -f "$postgrest" "$postgres" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$network" >/dev/null

docker run \
  --detach \
  --name "$postgres" \
  --network "$network" \
  --publish 5432 \
  --env POSTGRES_PASSWORD=postgres \
  --volume "$PWD:/work:ro" \
  postgres:16-alpine >/dev/null

for _ in $(seq 1 40); do
  if docker exec "$postgres" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

docker exec "$postgres" pg_isready -U postgres >/dev/null
docker exec "$postgres" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /work/db/migrations/001_control_schema.sql >/dev/null

docker run \
  --detach \
  --name "$postgrest" \
  --network "$network" \
  --publish 3000 \
  --env PGRST_DB_URI="postgres://postgres:postgres@$postgres:5432/postgres" \
  --env PGRST_DB_SCHEMAS="public" \
  --env PGRST_DB_ANON_ROLE="sheetbase_api" \
  --env PGRST_JWT_SECRET="sheetbase-dev-secret-change-me-32-bytes-minimum" \
  --env PGRST_OPENAPI_MODE="follow-privileges" \
  postgrest/postgrest:v12.2.8 >/dev/null

postgrest_port="$(docker port "$postgrest" 3000/tcp | head -n 1 | sed 's/.*://')"
db_port="$(docker port "$postgres" 5432/tcp | head -n 1 | sed 's/.*://')"

for _ in $(seq 1 80); do
  if curl --fail --silent "http://127.0.0.1:${postgrest_port}/" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

go run . serve \
  -addr 127.0.0.1:18080 \
  -postgrest-url "http://127.0.0.1:${postgrest_port}" \
  -db-url "postgres://postgres:postgres@127.0.0.1:${db_port}/postgres?sslmode=disable" >/tmp/sheetbase-app-test.log 2>&1 &
app_pid="$!"

for _ in $(seq 1 80); do
  if curl --fail --silent "http://127.0.0.1:18080/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

unauth_status="$(curl --silent --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:18080/api/sheet_forms")"
if [[ "$unauth_status" != "401" ]]; then
  echo "Expected unauthenticated API status 401, got $unauth_status" >&2
  exit 1
fi

cookie_file="$(mktemp)"
curl --fail --silent \
  --cookie-jar "$cookie_file" \
  --header 'Content-Type: application/json' \
  --data '{"email":"admin@example.com","password":"long-enough-password"}' \
  "http://127.0.0.1:18080/auth/setup" >/dev/null

curl --fail --silent \
  --cookie "$cookie_file" \
  --header 'Content-Type: application/json' \
  --header 'Prefer: return=representation' \
  --data '{"name":"Auth Companies","headers":["Company","Domain"]}' \
  "http://127.0.0.1:18080/api/rpc/create_sheet_form" >/dev/null

forms="$(curl --fail --silent --cookie "$cookie_file" "http://127.0.0.1:18080/api/sheet_forms?select=name")"
if [[ "$forms" != *"Auth Companies"* ]]; then
  echo "Authenticated API did not return created form: $forms" >&2
  exit 1
fi

echo "Sheetbase app auth/proxy test passed"
