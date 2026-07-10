#!/usr/bin/env bash
set -euo pipefail

network="sheetbase-postgrest-test-$$"
postgres="sheetbase-postgres-api-test-$$"
postgrest="sheetbase-postgrest-api-test-$$"
jwt_secret="sheetbase-dev-secret-change-me-32-bytes-minimum"
user_id="00000000-0000-0000-0000-000000000001"
other_user_id="00000000-0000-0000-0000-000000000002"

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

postgres_ready="no"
for _ in $(seq 1 40); do
  if docker exec "$postgres" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c 'select 1' >/dev/null 2>&1; then
    postgres_ready="yes"
    break
  fi
  sleep 0.5
done
if [[ "$postgres_ready" != "yes" ]]; then
  docker logs "$postgres" >&2 || true
  echo "Postgres did not become query-ready" >&2
  exit 1
fi

docker exec "$postgres" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c 'select 1' >/dev/null
docker exec "$postgres" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /work/db/migrations/001_control_schema.sql >/dev/null
docker exec "$postgres" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
  "insert into users (id, email, password_hash) values ('$user_id', 'api@example.com', 'hash')" >/dev/null

docker run \
  --detach \
  --name "$postgrest" \
  --network "$network" \
  --publish 3000 \
  --env PGRST_DB_URI="postgres://postgres:postgres@$postgres:5432/postgres" \
  --env PGRST_DB_SCHEMAS="public" \
  --env PGRST_DB_ANON_ROLE="sheetbase_api" \
  --env PGRST_JWT_SECRET="$jwt_secret" \
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

jwt_for_user() {
  python3 - "$jwt_secret" "$1" <<'PY'
import base64, hashlib, hmac, json, sys, time

secret, user_id = sys.argv[1], sys.argv[2]

def enc(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()

header = enc(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
payload = enc(json.dumps({"sub": user_id, "role": "sheetbase_api", "exp": int(time.time()) + 900}, separators=(",", ":")).encode())
unsigned = f"{header}.{payload}"
signature = enc(hmac.new(secret.encode(), unsigned.encode(), hashlib.sha256).digest())
print(f"{unsigned}.{signature}")
PY
}

jwt="$(jwt_for_user "$user_id")"
auth_header="Authorization: Bearer $jwt"
other_auth_header="Authorization: Bearer $(jwt_for_user "$other_user_id")"

form_json="$(
  curl --fail --silent \
    --header "$auth_header" \
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
  if curl --fail --silent --header "$auth_header" "$base_url/$generated_table?limit=1" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

curl --fail --silent \
  --header "$auth_header" \
  --header 'Content-Type: application/json' \
  --header 'Prefer: return=representation' \
  --data '[{"company":"Vercel","domain":"vercel.com","score":"Excellent"},{"company":"GitHub","domain":"github.com","score":"Good"},{"company":"Slack","domain":"slack.com","score":"Low"}]' \
  "$base_url/$generated_table" >/dev/null

filtered="$(
  curl --fail --silent \
    --header "$auth_header" \
    "$base_url/$generated_table?score=eq.Good&select=company,domain,score"
)"
filtered_company="$(printf '%s' "$filtered" | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["company"])')"
if [[ "$filtered_company" != "GitHub" ]]; then
  echo "Filtering failed: $filtered" >&2
  exit 1
fi

ordered="$(
  curl --fail --silent \
    --header "$auth_header" \
    "$base_url/$generated_table?select=company&order=company.desc&limit=1"
)"
ordered_company="$(printf '%s' "$ordered" | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["company"])')"
if [[ "$ordered_company" != "Vercel" ]]; then
  echo "Ordering/limit failed: $ordered" >&2
  exit 1
fi

metadata="$(
  curl --fail --silent \
    --header "$auth_header" \
    "$base_url/sheet_fields?sheet_form_id=eq.$form_id&select=name,column_name,position&order=position.asc"
)"
metadata_count="$(printf '%s' "$metadata" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')"
if [[ "$metadata_count" != "3" ]]; then
  echo "Metadata discovery failed: $metadata" >&2
  exit 1
fi

other_rows="$(
  curl --fail --silent \
    --header "$other_auth_header" \
    "$base_url/$generated_table?select=company"
)"
other_count="$(printf '%s' "$other_rows" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')"
if [[ "$other_count" != "0" ]]; then
  echo "Unauthorized user saw generated rows: $other_rows" >&2
  exit 1
fi

other_metadata="$(
  curl --fail --silent \
    --header "$other_auth_header" \
    "$base_url/sheet_fields?sheet_form_id=eq.$form_id&select=name"
)"
other_metadata_count="$(printf '%s' "$other_metadata" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')"
if [[ "$other_metadata_count" != "0" ]]; then
  echo "Unauthorized user saw metadata: $other_metadata" >&2
  exit 1
fi

if curl --fail --silent \
  --header "$other_auth_header" \
  --header 'Content-Type: application/json' \
  --data '[{"company":"Intruder"}]' \
  "$base_url/$generated_table" >/dev/null; then
  echo "Unauthorized user inserted a generated row" >&2
  exit 1
fi

echo "PostgREST API test passed for $generated_table"
