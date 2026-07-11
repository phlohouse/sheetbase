#!/usr/bin/env bash
set -euo pipefail

network="sheetbase-app-test-$$"
postgres="sheetbase-postgres-app-test-$$"
postgrest="sheetbase-postgrest-app-test-$$"
home="$(mktemp -d)"
jwt_secret="sheetbase-app-test-secret-change-me-32-bytes-minimum"

cleanup() {
  if [[ -n "${app_pid:-}" ]]; then
    kill "$app_pid" >/dev/null 2>&1 || true
    wait "$app_pid" >/dev/null 2>&1 || true
  fi
  docker rm -f "$postgrest" "$postgres" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$home"
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

postgres_ready="no"
consecutive=0
for _ in $(seq 1 40); do
  if docker exec "$postgres" pg_isready -U postgres >/dev/null 2>&1; then
    consecutive=$((consecutive + 1))
    if [[ "$consecutive" -ge 2 ]]; then postgres_ready="yes"; break; fi
  else
    consecutive=0
  fi
  sleep 0.5
done

if [[ "$postgres_ready" != "yes" ]]; then docker logs "$postgres" >&2; exit 1; fi
docker exec "$postgres" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /work/db/migrations/001_control_schema.sql >/dev/null
docker exec "$postgres" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /work/db/migrations/002_api_keys.sql >/dev/null
docker exec "$postgres" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /work/db/migrations/003_open_api_without_keys.sql >/dev/null
docker exec "$postgres" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /work/db/migrations/004_api_key_all_datasets.sql >/dev/null
docker exec "$postgres" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /work/db/migrations/005_sheet_form_lifecycle.sql >/dev/null
docker exec "$postgres" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /work/db/migrations/006_live_changes.sql >/dev/null

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

postgrest_port="$(docker port "$postgrest" 3000/tcp | head -n 1 | sed 's/.*://')"
db_port="$(docker port "$postgres" 5432/tcp | head -n 1 | sed 's/.*://')"

for _ in $(seq 1 80); do
  if curl --fail --silent "http://127.0.0.1:${postgrest_port}/" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

go run . serve \
  --home "$home" \
  -addr 127.0.0.1:18080 \
  -postgrest-url "http://127.0.0.1:${postgrest_port}" \
  -jwt-secret "$jwt_secret" \
  -db-url "postgres://postgres:postgres@127.0.0.1:${db_port}/postgres?sslmode=disable" >/tmp/sheetbase-app-test.log 2>&1 &
app_pid="$!"

for _ in $(seq 1 80); do
  if curl --fail --silent "http://127.0.0.1:18080/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

unauth_status="$(curl --silent --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:18080/internal/sheet_forms")"
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

form_json="$(curl --fail --silent \
  --cookie "$cookie_file" \
  --header 'Content-Type: application/json' \
  --header 'Prefer: return=representation' \
  --data '{"name":"Auth Companies","headers":["Company","Domain"]}' \
  "http://127.0.0.1:18080/internal/rpc/create_sheet_form")"

generated_table="$(printf '%s' "$form_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["generated_table_name"])')"
slug="$(printf '%s' "$form_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["slug"])')"
form_id="$(printf '%s' "$form_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
second_form_json="$(curl --fail --silent --cookie "$cookie_file" --header 'Content-Type: application/json' --header 'Prefer: return=representation' --data '{"name":"Auth Contacts","headers":["Name"]}' "http://127.0.0.1:18080/internal/rpc/create_sheet_form")"
second_form_id="$(printf '%s' "$second_form_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
second_slug="$(printf '%s' "$second_form_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["slug"])')"

cookie_api_status="$(curl --silent --output /dev/null --write-out '%{http_code}' --cookie "$cookie_file" "http://127.0.0.1:18080/api/$slug?limit=1")"
if [[ "$cookie_api_status" != "200" ]]; then
  echo "Expected public API to be open before the first key, got $cookie_api_status" >&2
  exit 1
fi

api_key_json="$(curl --fail --silent \
  --cookie "$cookie_file" \
  --header 'Content-Type: application/json' \
  --data "{\"name\":\"Test integration\",\"sheet_form_ids\":[\"$form_id\",\"$second_form_id\"],\"can_write\":true,\"all_sheet_forms\":true}" \
  "http://127.0.0.1:18080/admin/api-keys")"
api_key="$(printf '%s' "$api_key_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')"
api_key_id="$(printf '%s' "$api_key_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
permission_count="$(printf '%s' "$api_key_json" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["permissions"]))')"
if [[ "$permission_count" != "2" ]]; then echo "Expected API key to cover two datasets, got $permission_count" >&2; exit 1; fi

curl --fail --silent --header "X-API-Key: $api_key" "http://127.0.0.1:18080/api/$slug?limit=1" >/dev/null
curl --fail --silent --header "X-API-Key: $api_key" "http://127.0.0.1:18080/api/$second_slug?limit=1" >/dev/null

future_form_json="$(curl --fail --silent --cookie "$cookie_file" --header 'Content-Type: application/json' --header 'Prefer: return=representation' --data '{"name":"Future dataset","headers":["Value"]}' "http://127.0.0.1:18080/internal/rpc/create_sheet_form")"
future_form_id="$(printf '%s' "$future_form_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
future_slug="$(printf '%s' "$future_form_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["slug"])')"
curl --fail --silent --header "X-API-Key: $api_key" "http://127.0.0.1:18080/api/$future_slug?limit=1" >/dev/null
curl --fail --silent --request PATCH --cookie "$cookie_file" --header 'Content-Type: application/json' \
  --data "{\"sheet_form_ids\":[\"$form_id\",\"$second_form_id\",\"$future_form_id\"],\"can_write\":true}" \
  "http://127.0.0.1:18080/admin/api-keys/$api_key_id" >/dev/null
curl --fail --silent --header "X-API-Key: $api_key" "http://127.0.0.1:18080/api/$future_slug?limit=1" >/dev/null

forms="$(curl --fail --silent --cookie "$cookie_file" "http://127.0.0.1:18080/internal/sheet_forms?select=name")"
if [[ "$forms" != *"Auth Companies"* ]]; then
  echo "Authenticated API did not return created form: $forms" >&2
  exit 1
fi

metadata="$(curl --fail --silent --cookie "$cookie_file" "http://127.0.0.1:18080/internal/sheet_fields?sheet_form_id=eq.$form_id&select=id,name,column_name&order=position.asc")"
if [[ "$metadata" != *"Company"* || "$metadata" != *"Domain"* ]]; then
  echo "Authenticated API did not return form fields: $metadata" >&2
  exit 1
fi
company_field_id="$(printf '%s' "$metadata" | python3 -c 'import json,sys; print(next(field["id"] for field in json.load(sys.stdin) if field["name"] == "Company"))')"
domain_field_id="$(printf '%s' "$metadata" | python3 -c 'import json,sys; print(next(field["id"] for field in json.load(sys.stdin) if field["name"] == "Domain"))')"

curl --fail --silent \
  --cookie "$cookie_file" \
  --header 'Content-Type: application/json' \
  --header 'Prefer: return=representation' \
  --data '[{"company":"Acme Labs","domain":"acme.test"},{"company":"Vercel","domain":"vercel.com"}]' \
  "http://127.0.0.1:18080/internal/$generated_table" >/dev/null

filtered="$(curl --fail --silent --cookie "$cookie_file" "http://127.0.0.1:18080/internal/$generated_table?domain=eq.acme.test&select=company,domain")"
filtered_company="$(printf '%s' "$filtered" | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["company"])')"
if [[ "$filtered_company" != "Acme Labs" ]]; then
  echo "Authenticated API did not return inserted row: $filtered" >&2
  exit 1
fi

public_filtered="$(curl --fail --silent --header "X-API-Key: $api_key" "http://127.0.0.1:18080/api/$slug?domain=eq.acme.test&select=company")"
if [[ "$public_filtered" != *"Acme Labs"* ]]; then echo "API key could not read rows: $public_filtered" >&2; exit 1; fi

curl --fail --silent \
  --header "X-API-Key: $api_key" \
  --header 'Content-Type: application/json' \
  --data '[{"company":"API Writer","domain":"api.test"}]' \
  "http://127.0.0.1:18080/api/$slug" >/dev/null

read_key_json="$(curl --fail --silent --cookie "$cookie_file" --header 'Content-Type: application/json' \
  --data "{\"name\":\"Read only\",\"sheet_form_ids\":[\"$form_id\"],\"can_write\":false}" \
  "http://127.0.0.1:18080/admin/api-keys")"
read_key="$(printf '%s' "$read_key_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')"
read_key_id="$(printf '%s' "$read_key_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
read_write_status="$(curl --silent --output /dev/null --write-out '%{http_code}' --header "X-API-Key: $read_key" \
  --header 'Content-Type: application/json' --data '[{"company":"Denied"}]' "http://127.0.0.1:18080/api/$slug")"
if [[ "$read_write_status" =~ ^2 ]]; then echo "Read-only API key wrote a row" >&2; exit 1; fi
curl --fail --silent --request DELETE --cookie "$cookie_file" "http://127.0.0.1:18080/admin/api-keys/$read_key_id" >/dev/null

added_field="$(curl --fail --silent \
  --cookie "$cookie_file" \
  --header 'Content-Type: application/json' \
  --header 'Prefer: return=representation' \
  --data "{\"sheet_form_id\":\"$form_id\",\"name\":\"Rows\"}" \
  "http://127.0.0.1:18080/internal/rpc/add_sheet_field")"
rows_column="$(printf '%s' "$added_field" | python3 -c 'import json,sys; print(json.load(sys.stdin)["column_name"])')"
rows_field_id="$(printf '%s' "$added_field" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"

saved_view="$(curl --fail --silent \
  --cookie "$cookie_file" \
  --header 'Content-Type: application/json' \
  --header 'Prefer: return=representation' \
  --data "{\"sheet_form_id\":\"$form_id\",\"widths\":{\"company\":260,\"$rows_column\":180}}" \
  "http://127.0.0.1:18080/internal/rpc/update_sheet_view_widths")"
company_width="$(printf '%s' "$saved_view" | python3 -c 'import json,sys; print(json.load(sys.stdin)["column_widths"]["company"])')"
if [[ "$company_width" != "260" ]]; then
  echo "View widths did not persist: $saved_view" >&2
  exit 1
fi

saved_order="$(curl --fail --silent \
  --cookie "$cookie_file" \
  --header 'Content-Type: application/json' \
  --header 'Prefer: return=representation' \
  --data "{\"sheet_form_id\":\"$form_id\",\"column_order\":[\"$rows_column\",\"company\"]}" \
  "http://127.0.0.1:18080/internal/rpc/update_sheet_view_column_order")"
first_column="$(printf '%s' "$saved_order" | python3 -c 'import json,sys; print(json.load(sys.stdin)["sort_filter_state"]["column_order"][0])')"
if [[ "$first_column" != "$rows_column" ]]; then
  echo "View order did not persist: $saved_order" >&2
  exit 1
fi

curl --fail --silent \
  --cookie "$cookie_file" \
  --request PATCH \
  --header 'Content-Type: application/json' \
  --header 'Prefer: return=representation' \
  --data "{\"$rows_column\":\"42\"}" \
  "http://127.0.0.1:18080/internal/$generated_table?domain=eq.acme.test" >/dev/null

typed_field="$(curl --fail --silent \
  --cookie "$cookie_file" \
  --header 'Content-Type: application/json' \
  --header 'Prefer: return=representation' \
  --data "{\"sheet_form_id\":\"$form_id\",\"field_id\":\"$rows_field_id\",\"target_type\":\"integer\"}" \
  "http://127.0.0.1:18080/internal/rpc/tighten_sheet_field_type")"
typed_value="$(printf '%s' "$typed_field" | python3 -c 'import json,sys; print(json.load(sys.stdin)["type"])')"
if [[ "$typed_value" != "integer" ]]; then
  echo "Type tightening did not return integer field: $typed_field" >&2
  exit 1
fi

unsafe_status="$(curl --silent --output /tmp/sheetbase-unsafe-tighten.txt --write-out '%{http_code}' \
  --cookie "$cookie_file" \
  --header 'Content-Type: application/json' \
  --data "{\"sheet_form_id\":\"$form_id\",\"field_id\":\"$company_field_id\",\"target_type\":\"integer\"}" \
  "http://127.0.0.1:18080/internal/rpc/tighten_sheet_field_type")"
if [[ "$unsafe_status" == "200" ]]; then
  echo "Unsafe type tightening unexpectedly succeeded" >&2
  exit 1
fi

hidden_field="$(curl --fail --silent \
  --cookie "$cookie_file" \
  --header 'Content-Type: application/json' \
  --header 'Prefer: return=representation' \
  --data "{\"sheet_form_id\":\"$form_id\",\"field_id\":\"$domain_field_id\"}" \
  "http://127.0.0.1:18080/internal/rpc/hide_sheet_field")"
hidden_value="$(printf '%s' "$hidden_field" | python3 -c 'import json,sys; print(json.load(sys.stdin)["hidden"])')"
if [[ "$hidden_value" != "True" ]]; then
  echo "Hide field did not return hidden=true: $hidden_field" >&2
  exit 1
fi

visible_metadata="$(curl --fail --silent --cookie "$cookie_file" "http://127.0.0.1:18080/internal/sheet_fields?sheet_form_id=eq.$form_id&hidden=eq.false&select=name")"
if [[ "$visible_metadata" == *"Domain"* ]]; then
  echo "Hidden field still appears in default visible metadata: $visible_metadata" >&2
  exit 1
fi

guard_key_json="$(curl --fail --silent --cookie "$cookie_file" --header 'Content-Type: application/json' \
  --data "{\"name\":\"Revocation guard\",\"sheet_form_ids\":[\"$form_id\"],\"can_write\":false}" \
  "http://127.0.0.1:18080/admin/api-keys")"
guard_key_id="$(printf '%s' "$guard_key_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
curl --fail --silent --request DELETE --cookie "$cookie_file" "http://127.0.0.1:18080/admin/api-keys/$api_key_id" >/dev/null
revoked_status="$(curl --silent --output /dev/null --write-out '%{http_code}' --header "X-API-Key: $api_key" "http://127.0.0.1:18080/api/$slug?limit=1")"
if [[ "$revoked_status" != "401" ]]; then echo "Revoked API key returned $revoked_status" >&2; exit 1; fi
curl --fail --silent --request DELETE --cookie "$cookie_file" "http://127.0.0.1:18080/admin/api-keys/$guard_key_id" >/dev/null

echo "Sheetbase app auth/proxy test passed"
