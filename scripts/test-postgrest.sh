#!/usr/bin/env bash
set -euo pipefail

network="sheetbase-postgrest-test-$$"
postgres="sheetbase-postgres-api-test-$$"
postgrest="sheetbase-postgrest-api-test-$$"

cleanup() {
  docker rm -f "$postgrest" "$postgres" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$network" >/dev/null

docker run \
  --detach \
  --name "$postgres" \
  --network "$network" \
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
  --env PGRST_OPENAPI_MODE="follow-privileges" \
  postgrest/postgrest:v12.2.8 >/dev/null

host_port="$(docker port "$postgrest" 3000/tcp | head -n 1 | sed 's/.*://')"
base_url="http://127.0.0.1:${host_port}"

ready="no"
for _ in $(seq 1 80); do
  if curl --fail --silent "$base_url/" >/dev/null 2>&1; then
    ready="yes"
    break
  fi
  sleep 0.25
done
if [[ "$ready" != "yes" ]]; then
  docker logs "$postgrest" >&2 || true
  echo "PostgREST did not become ready at $base_url" >&2
  exit 1
fi

form_json="$(
  curl --fail --silent \
    --header 'Content-Type: application/json' \
    --header 'Prefer: return=representation' \
    --data '{"name":"API Companies","headers":["Company","Domain","Score"]}' \
    "$base_url/rpc/create_sheet_form"
)"

generated_table="$(printf '%s' "$form_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["generated_table_name"])')"
form_id="$(printf '%s' "$form_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"

if [[ ! "$generated_table" =~ ^sheet_[0-9a-f_]+$ ]]; then
  echo "Generated table was not exposed in expected shape: $generated_table" >&2
  exit 1
fi

for _ in $(seq 1 80); do
  if curl --fail --silent "$base_url/$generated_table?limit=1" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

curl --fail --silent \
  --header 'Content-Type: application/json' \
  --header 'Prefer: return=representation' \
  --data '[{"company":"Vercel","domain":"vercel.com","score":"Excellent"},{"company":"GitHub","domain":"github.com","score":"Good"},{"company":"Slack","domain":"slack.com","score":"Low"}]' \
  "$base_url/$generated_table" >/dev/null

filtered="$(
  curl --fail --silent \
    "$base_url/$generated_table?score=eq.Good&select=company,domain,score"
)"
filtered_company="$(printf '%s' "$filtered" | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["company"])')"
if [[ "$filtered_company" != "GitHub" ]]; then
  echo "Filtering failed: $filtered" >&2
  exit 1
fi

ordered="$(
  curl --fail --silent \
    "$base_url/$generated_table?select=company&order=company.desc&limit=1"
)"
ordered_company="$(printf '%s' "$ordered" | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["company"])')"
if [[ "$ordered_company" != "Vercel" ]]; then
  echo "Ordering/limit failed: $ordered" >&2
  exit 1
fi

metadata="$(
  curl --fail --silent \
    "$base_url/sheet_fields?sheet_form_id=eq.$form_id&select=name,column_name,position&order=position.asc"
)"
metadata_count="$(printf '%s' "$metadata" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')"
if [[ "$metadata_count" != "3" ]]; then
  echo "Metadata discovery failed: $metadata" >&2
  exit 1
fi

echo "PostgREST API test passed for $generated_table"
