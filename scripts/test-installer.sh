#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release_dir="${SHEETBASE_RELEASE_DIR:-$root/release}"
test_home="$(mktemp -d)"
server_log="$test_home/server.log"
install_dir="$test_home/bin"
runtime_home="$test_home/home/.sheetbase"
runtime_started=false

free_port() {
  python3 - <<'PY'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
}

port="$(free_port)"
native_os="$(uname -s)"
native_arch="$(uname -m)"
case "$native_os/$native_arch" in
  Linux/x86_64|Linux/amd64) native_target=linux/amd64 ;;
  Linux/arm64|Linux/aarch64) native_target=linux/arm64 ;;
  Darwin/x86_64|Darwin/amd64) native_target=darwin/amd64 ;;
  Darwin/arm64|Darwin/aarch64) native_target=darwin/arm64 ;;
  *) native_target= ;;
esac

cleanup() {
  if [[ "$runtime_started" == true && -n "${native_binary:-}" ]]; then
    "$native_binary" down \
      --home "$runtime_home" \
      -addr "127.0.0.1:${app_port:-18082}" \
      --postgres-port "${postgres_port:-55432}" \
      --postgrest-port "${postgrest_port:-3000}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${server_pid:-}" ]]; then
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" >/dev/null 2>&1 || true
  fi
  rm -rf "$test_home"
}
trap cleanup EXIT

installer="$release_dir/install.sh"
test -x "$installer"
for archive in "$release_dir"/sheetbase-*.tar.gz; do
  test -f "$archive"
  test -f "$archive.sha256"
done

(cd "$release_dir" && python3 -m http.server "$port" --bind 127.0.0.1 >"$server_log" 2>&1) &
server_pid=$!
for _ in $(seq 1 40); do
  if curl --fail --silent "http://127.0.0.1:$port/" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
curl --fail --silent "http://127.0.0.1:$port/" >/dev/null

for target in linux/amd64 linux/arm64 darwin/amd64 darwin/arm64; do
  case "$target" in
    linux/amd64) test_os=Linux; test_arch=x86_64 ;;
    linux/arm64) test_os=Linux; test_arch=aarch64 ;;
    darwin/amd64) test_os=Darwin; test_arch=x86_64 ;;
    darwin/arm64) test_os=Darwin; test_arch=arm64 ;;
  esac

  fake_bin="$test_home/fake-uname-${target//\//-}"
  target_install="$install_dir/${target//\//-}"
  mkdir -p "$fake_bin"
  printf '%s\n' \
    '#!/bin/sh' \
    'case "${1:-}" in' \
    '  -s) printf "%s\\n" "$SHEETBASE_TEST_UNAME_S" ;;' \
    '  -m) printf "%s\\n" "$SHEETBASE_TEST_UNAME_M" ;;' \
    '  *) exec /usr/bin/uname "$@" ;;' \
    'esac' >"$fake_bin/uname"
  chmod 755 "$fake_bin/uname"

  SHEETBASE_RELEASE_BASE_URL="http://127.0.0.1:$port" \
  SHEETBASE_INSTALL_DIR="$target_install" \
  SHEETBASE_TEST_UNAME_S="$test_os" \
  SHEETBASE_TEST_UNAME_M="$test_arch" \
  PATH="$fake_bin:$PATH" \
    "$installer"

  test -x "$target_install/sheetbase"
  if [[ "$target" == "$native_target" ]]; then
    native_binary="$target_install/sheetbase"
    "$native_binary" help >/dev/null
  fi
done

test -n "${native_binary:-}"
app_port="$(free_port)"
postgres_port="$(free_port)"
postgrest_port="$(free_port)"

runtime_started=true
"$native_binary" up \
  --home "$runtime_home" \
  -addr "127.0.0.1:$app_port" \
  --postgres-port "$postgres_port" \
  --postgrest-port "$postgrest_port"

curl --fail --silent "http://127.0.0.1:$app_port/healthz" | grep -q '^ok$'
test -f "$runtime_home/config/sheetbase.env"
test -f "$runtime_home/data/postgres/PG_VERSION"
test -f "$runtime_home/data/postgres/postgresql.conf"
grep -Fq "$runtime_home/data/postgres" "$runtime_home/data/postgres/postmaster.opts"

"$native_binary" down \
  --home "$runtime_home" \
  -addr "127.0.0.1:$app_port" \
  --postgres-port "$postgres_port" \
  --postgrest-port "$postgrest_port"
runtime_started=false

echo "installer smoke passed for all release targets and a clean native first run"
