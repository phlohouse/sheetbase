#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
goos="${1:-${GOOS:-$(go env GOOS)}}"
goarch="${2:-${GOARCH:-$(go env GOARCH)}}"
out="${3:-$root/bin/release}"

case "$goos/$goarch" in
  linux/amd64|linux/arm64|darwin/amd64|darwin/arm64)
    ;;
  *)
    echo "unsupported release target: $goos/$goarch" >&2
    exit 1
    ;;
esac

mkdir -p "$out"

(cd "$root/ui" && npm run build >&2)

binary="$out/sheetbase-${goos}-${goarch}"
GOOS="$goos" GOARCH="$goarch" CGO_ENABLED=0 \
  go build -trimpath -ldflags="-s -w" -o "$binary" "$root"

checksum="$binary.sha256"
if command -v sha256sum >/dev/null 2>&1; then
  hash="$(sha256sum "$binary" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  hash="$(shasum -a 256 "$binary" | awk '{print $1}')"
else
  echo "neither sha256sum nor shasum is available" >&2
  exit 1
fi

printf '%s  %s\n' "$hash" "$(basename "$binary")" > "$checksum"

if command -v sha256sum >/dev/null 2>&1; then
  printf '%s  %s\n' "$hash" "$(basename "$binary")" | (cd "$(dirname "$binary")" && sha256sum --check --status -)
else
  actual="$(shasum -a 256 "$binary" | awk '{print $1}')"
  test "$actual" = "$hash"
fi

printf '%s\n' "$binary"
