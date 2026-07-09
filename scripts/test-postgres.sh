#!/usr/bin/env bash
set -euo pipefail

container="sheetbase-postgres-test-$$"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run \
  --detach \
  --name "$container" \
  --env POSTGRES_PASSWORD=postgres \
  --volume "$PWD:/work:ro" \
  postgres:16-alpine >/dev/null

for _ in $(seq 1 40); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

docker exec "$container" pg_isready -U postgres >/dev/null
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /work/db/tests/control_schema_test.sql
