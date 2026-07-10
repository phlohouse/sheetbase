#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
binary="$("$root/scripts/release-linux.sh")"

if [[ "$(uname -s)" != "Linux" && "$(uname -s)" != "Darwin" ]]; then
  echo "release smoke only runs on Linux or Darwin" >&2
  exit 0
fi

if [[ "$(uname -s)" == "Darwin" ]]; then
  binary="$root/bin/sheetbase"
  (cd "$root" && go build -trimpath -ldflags="-s -w" -o "$binary" .)
fi

home="$(mktemp -d)"
log="$(mktemp)"
cleanup() {
  if [[ -n "${app_pid:-}" ]]; then
    kill "$app_pid" >/dev/null 2>&1 || true
    wait "$app_pid" >/dev/null 2>&1 || true
  fi
  rm -rf "$home" "$log"
}
trap cleanup EXIT

"$binary" serve --home "$home" -addr 127.0.0.1:18082 -postgrest-url http://127.0.0.1:1 -db-url= >"$log" 2>&1 &
app_pid="$!"

for _ in $(seq 1 80); do
  if curl --fail --silent http://127.0.0.1:18082/healthz >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

curl --fail --silent http://127.0.0.1:18082/healthz | grep -q '^ok$'
curl --fail --silent http://127.0.0.1:18082/ | grep -q 'Sheetbase'
test -s "$home/logs/sheetbase.log"

echo "release smoke passed: $binary"
