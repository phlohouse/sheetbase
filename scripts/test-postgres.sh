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

ready="no"
consecutive=0
for _ in $(seq 1 40); do
  if docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c 'select 1' >/dev/null 2>&1; then
    consecutive=$((consecutive + 1))
    if [[ "$consecutive" -ge 2 ]]; then
      ready="yes"
      break
    fi
  else
    consecutive=0
  fi
  sleep 0.5
done
if [[ "$ready" != "yes" ]]; then
  docker logs "$container" >&2 || true
  echo "Postgres did not become query-ready" >&2
  exit 1
fi

docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /work/db/tests/control_schema_test.sql
