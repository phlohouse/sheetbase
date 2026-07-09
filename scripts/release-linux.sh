#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$root/bin/release"
binary="$out/sheetbase-linux-amd64"

mkdir -p "$out"
cd "$root/ui"
npm run build

cd "$root"
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o "$binary" .
sha256sum "$binary" > "$binary.sha256"

echo "$binary"
